import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import {
  banRow,
  banStats,
  banTarget,
  jailAction,
  jailName,
  jailRow,
  jailStatus,
  unbanTarget,
} from '../../shared/fail2ban.ts';
import { audit } from '../audit.ts';
import { getHost } from '../db/queries.ts';
import { AppError } from '../errors.ts';
import { CLIENT_RATE_LIMIT, hostParams, ok } from '../http.ts';

const jailParams = hostParams.extend({ jail: jailName });
const WRITE = { access: 'write', rateLimit: CLIENT_RATE_LIMIT } as const;
const READ = { access: 'read', rateLimit: CLIENT_RATE_LIMIT } as const;

const idleJail = (name: string) => ({
  name,
  currentlyFailed: 0,
  totalFailed: 0,
  currentlyBanned: 0,
  totalBanned: 0,
  bannedIps: [],
  fileList: '',
});

const family = (ip: string) => (isIP(ip) === 6 ? 'ipv6' : 'ipv4');

// BlockList also matches IPv4 rules against IPv4-mapped IPv6 clients
export function covers(target: string, ip: string) {
  const [address = '', prefix] = target.split('/');
  const list = new BlockList();
  if (prefix) list.addSubnet(address, Number(prefix), family(address));
  else list.addAddress(address, family(address));
  return list.check(ip, family(ip));
}

export const jailRoutes: FastifyPluginAsyncZod = async (app) => {
  const connector = (hostId: number) => app.connect(getHost(app.db, hostId));

  // A refused or failed action is audited too, then answered as an error
  async function audited<T>(
    req: FastifyRequest,
    entry: { action: string; hostId: number; target: string; detail?: string },
    change: () => Promise<T>,
  ) {
    try {
      const result = await change();
      audit(req, { ...entry, ok: true });
      return result;
    } catch (err) {
      audit(req, { ...entry, ok: false });
      throw err;
    }
  }

  app.get(
    '/hosts/:hostId/jails',
    { config: READ, schema: { params: hostParams, response: { 200: okResponse({ jails: z.array(jailRow) }) } } },
    async (req) => {
      const host = connector(req.params.hostId);
      const [running, configs] = await Promise.all([host.listJails(), host.jailConfigs()]);
      const configOf = (name: string) => configs.find((c) => c.name === name) ?? null;
      const stopped = configs.filter((c) => c.enabled && !running.some((j) => j.name === c.name));
      return ok({
        jails: [
          ...running.map((jail) => ({ ...jail, running: true, config: configOf(jail.name) })),
          ...stopped.map((config) => ({ ...idleJail(config.name), running: false, config })),
        ],
      });
    },
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
        const { target } = req.body;
        // Whoever bans their own address loses the UI and has to fix it from the machine
        if (verb === 'ban' && covers(target, req.ip)) throw new AppError('CONFLICT', 'This would ban your own address');
        await audited(req, { action: `jail.${verb}`, hostId, target, detail: jail }, () =>
          connector(hostId)[verb](jail, target),
        );
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
      await audited(req, { action: `jail.${action}`, hostId, target: jail }, () =>
        connector(hostId).jailAction(jail, action),
      );
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
        response: { 200: okResponse({ bans: z.array(banRow) }) },
      },
    },
    async (req) => {
      const host = connector(req.params.hostId);
      const { active, limit } = req.query;
      return ok({ bans: await (active ? host.activeBans() : host.recentBans(limit)) });
    },
  );

  app.get(
    '/hosts/:hostId/stats',
    {
      config: READ,
      schema: {
        params: hostParams,
        // 0 = everything
        querystring: z.object({ days: z.coerce.number().int().min(0).max(3650).default(30) }),
        response: { 200: okResponse({ stats: banStats }) },
      },
    },
    async (req) => ok({ stats: await connector(req.params.hostId).stats(req.query.days) }),
  );
};
