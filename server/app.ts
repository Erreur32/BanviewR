import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { LocalDetection } from '../shared/hosts.ts';
import { type AgentHub, createAgentHub } from './agentHub.ts';
import { recordAudit } from './audit.ts';
import { registerAccessControl } from './auth/access.ts';
import { agentConnector } from './connectors/agent.ts';
import type { ConnectorFactory } from './connectors/connector.ts';
import type { Db } from './db/index.ts';
import { agents } from './db/schema.ts';
import { createEmbedded, type Embedded, type EmbeddedOptions, settingsStore } from './embedded.ts';
import { registerErrorHandling } from './errors.ts';
import type { GeoIp } from './geoip.ts';
import { notifyEmbeddedStop } from './notifications.ts';
import { registerOpenApi } from './openapi.ts';
import { agentRoutes } from './routes/agents.ts';
import { auditRoutes } from './routes/audit.ts';
import { authRoutes } from './routes/auth.ts';
import { avatarRoutes } from './routes/avatars.ts';
import { blocklistRoutes } from './routes/blocklists.ts';
import { embeddedRoutes } from './routes/embedded.ts';
import { geoipRoutes } from './routes/geoip.ts';
import { healthRoutes } from './routes/health.ts';
import { hostRoutes } from './routes/hosts.ts';
import { jailRoutes } from './routes/jails.ts';
import { mcpRoutes } from './routes/mcp.ts';
import { tokenRoutes } from './routes/tokens.ts';
import { userRoutes } from './routes/users.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { serveWebApp } from './webApp.ts';

export type AppDeps = {
  connect: ConnectorFactory;
  detection: LocalDetection;
  embedded: EmbeddedOptions;
  mcpWrite: boolean;
  geo: GeoIp;
  // Built web app folder, served when set
  webRoot?: string;
};

declare module 'fastify' {
  interface FastifyInstance extends Omit<AppDeps, 'embedded'> {
    db: Db;
    embedded: Embedded;
    agents: AgentHub;
  }
}

export async function buildApp(db: Db, deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', db);
  app.decorate(
    'agents',
    createAgentHub(app.log, (hostId, presence) => {
      const seen = { lastSeenAt: new Date() };
      const values = presence ? { ...seen, version: presence.version, writeEnabled: presence.write } : seen;
      db.update(agents).set(values).where(eq(agents.hostId, hostId)).run();
    }),
  );
  // A jail started or reloaded on the embedded fail2ban gets the base ignoreip back at once, not a minute later
  app.decorate('connect', (host) => {
    if (host.mode === 'agent') return agentConnector(app.agents, host);
    const connector = deps.connect(host);
    if (host.mode !== 'embedded') return connector;
    return {
      ...connector,
      async jailAction(jail, action) {
        await connector.jailAction(jail, action);
        await app.embedded.enforceIgnoreip();
      },
    };
  });
  app.decorate('detection', deps.detection);
  app.decorate('mcpWrite', deps.mcpWrite);
  app.decorate('geo', deps.geo);
  app.decorate(
    'embedded',
    createEmbedded({
      ...deps.embedded,
      detection: deps.detection,
      store: settingsStore(db),
      log: app.log,
      onHostStop: (found) => notifyEmbeddedStop(db, found),
      onTrialEnd: () =>
        recordAudit(
          db,
          { principal: null, ip: 'system' },
          {
            action: 'embedded.trialExpired',
            ok: true,
            target: 'embedded',
            detail: 'Trial start not confirmed in time, stopped',
          },
        ),
    }),
  );
  app.addHook('onClose', async () => {
    app.agents.close();
    // Kept enabled: it comes back with the next start
    await app.embedded.stop(true);
    db.$client.close();
  });
  registerErrorHandling(app, deps.webRoot && readFileSync(join(deps.webRoot, 'index.html'), 'utf8'));

  // The app is often reached over plain HTTP on a LAN, where upgrading would block its own assets
  await app.register(helmet, { contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } });
  // Per IP, auth routes set a stricter limit
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  // Agents send large pages of bans and firewall dumps
  await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });
  await registerAccessControl(app);
  await registerOpenApi(app);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(avatarRoutes);
      await api.register(tokenRoutes);
      await api.register(auditRoutes);
      await api.register(hostRoutes);
      await api.register(jailRoutes);
      await api.register(mcpRoutes);
      await api.register(geoipRoutes);
      await api.register(webhookRoutes);
      await api.register(blocklistRoutes);
      await api.register(embeddedRoutes);
      await api.register(agentRoutes);
    },
    { prefix: '/api' },
  );
  if (deps.webRoot) await serveWebApp(app, deps.webRoot);
  return app;
}
