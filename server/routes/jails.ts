import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import {
  banStats,
  banTarget,
  jailAction,
  jailName,
  jailRow,
  jailStatus,
  locatedBan,
  threatRow,
  unbanTarget,
} from '../../shared/fail2ban.ts';
import { firewallAudit } from '../../shared/firewall.ts';
import { readBanHistory, readBanStats, readThreats } from '../banEvents.ts';
import { getHost } from '../db/queries.ts';
import { readFirewallAudit } from '../firewallAudit.ts';
import { located } from '../geoip.ts';
import { CLIENT_RATE_LIMIT, hostParams, ok } from '../http.ts';
import { changeBan, listJailRows, runJailAction } from '../jailOps.ts';

const jailParams = hostParams.extend({ jail: jailName });
const WRITE = { access: 'write', rateLimit: CLIENT_RATE_LIMIT } as const;
const READ = { access: 'read', rateLimit: CLIENT_RATE_LIMIT } as const;
// One audit starts a dozen processes
const AUDIT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

export const jailRoutes: FastifyPluginAsyncZod = async (app) => {
  const connector = (hostId: number) => app.connect(getHost(app.db, hostId));

  app.get(
    '/hosts/:hostId/jails',
    { config: READ, schema: { params: hostParams, response: { 200: okResponse({ jails: z.array(jailRow) }) } } },
    async (req) => ok({ jails: await listJailRows(connector(req.params.hostId)) }),
  );

  app.get(
    '/hosts/:hostId/jails/:jail',
    { config: READ, schema: { params: jailParams, response: { 200: okResponse({ jail: jailStatus }) } } },
    async (req) => ok({ jail: await connector(req.params.hostId).jail(req.params.jail) }),
  );

  for (const verb of ['ban', 'unban'] as const) {
    app.post(
      `/hosts/:hostId/jails/:jail/${verb}`,
      {
        config: WRITE,
        schema: {
          params: jailParams,
          body: z.object({ target: verb === 'ban' ? banTarget : unbanTarget }),
          response: { 200: okResponse() },
        },
      },
      async (req) => {
        const { hostId, jail } = req.params;
        await changeBan(app.db, req, connector(hostId), verb, { hostId, jail, target: req.body.target });
        return ok();
      },
    );
  }

  app.post(
    '/hosts/:hostId/jails/:jail/:action',
    {
      config: WRITE,
      schema: { params: jailParams.extend({ action: jailAction }), response: { 200: okResponse() } },
    },
    async (req) => {
      const { hostId, jail, action } = req.params;
      await runJailAction(app.db, req, connector(hostId), { hostId, jail, action });
      return ok();
    },
  );

  app.get(
    '/hosts/:hostId/bans',
    {
      config: READ,
      schema: {
        params: hostParams,
        // active: bans running now, otherwise the latest ones, expired or not
        querystring: z.object({
          active: z.stringbool().default(true),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        response: { 200: okResponse({ bans: z.array(locatedBan) }) },
      },
    },
    async (req) => {
      const host = connector(req.params.hostId);
      const { active, limit } = req.query;
      return ok({ bans: located(app.geo.locate, await (active ? host.activeBans() : host.recentBans(limit))) });
    },
  );

  app.get(
    '/hosts/:hostId/stats',
    {
      config: READ,
      schema: {
        params: hostParams,
        // 0 = everything
        // slots=false leaves out the hourly slots
        querystring: z.object({
          days: z.coerce.number().int().min(0).max(3650).default(30),
          slots: z.stringbool().default(true),
        }),
        response: { 200: okResponse({ stats: banStats }) },
      },
    },
    // From the local history: it outlives fail2ban's purge and needs no running fail2ban
    async (req) => {
      getHost(app.db, req.params.hostId);
      const { days, slots } = req.query;
      return ok({ stats: readBanStats(app.db, req.params.hostId, days, app.geo.locate, slots) });
    },
  );

  app.get(
    '/hosts/:hostId/history',
    {
      config: READ,
      schema: {
        params: hostParams,
        querystring: z.object({
          ip: z.union([z.ipv4(), z.ipv6()]).optional(),
          limit: z.coerce.number().int().min(1).max(1000).default(100),
        }),
        response: { 200: okResponse({ bans: z.array(locatedBan) }) },
      },
    },
    async (req) => {
      getHost(app.db, req.params.hostId);
      return ok({ bans: readBanHistory(app.db, req.params.hostId, req.query, app.geo.locate) });
    },
  );

  app.get(
    '/hosts/:hostId/threats',
    {
      config: READ,
      schema: {
        params: hostParams,
        querystring: z.object({ hours: z.coerce.number().int().min(1).max(720).default(6) }),
        response: { 200: okResponse({ threats: z.array(threatRow) }) },
      },
    },
    async (req) => {
      getHost(app.db, req.params.hostId);
      return ok({ threats: readThreats(app.db, req.params.hostId, req.query.hours, app.geo.locate) });
    },
  );

  app.get(
    '/hosts/:hostId/firewall',
    {
      config: { access: 'read', rateLimit: AUDIT_RATE_LIMIT },
      schema: { params: hostParams, response: { 200: okResponse({ audit: firewallAudit }) } },
    },
    async (req) => ok({ audit: await readFirewallAudit(connector(req.params.hostId)) }),
  );
};
