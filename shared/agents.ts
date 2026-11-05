import { z } from 'zod';
import { apiErrorCode } from './api.ts';
import { banRow, jailConfig, jailName, jailStatus } from './fail2ban.ts';
import { hostStatus } from './hosts.ts';

// Wire protocol between an agent and the central, JSON over one WebSocket the agent opens.
// The agent says hello first, then answers the central's calls. Both sides validate every message.

// What an agent sends lands in the history and in notifications (webhooks, Discord, Telegram):
// addresses must be addresses, names stay short
const ip = z.string().regex(/^[0-9a-fA-F:.]{2,45}(\/\d{1,3})?$/, 'Invalid address');
const jail = z.string().min(1).max(128);
const remoteBan = banRow.extend({ ip, jail });

const rawBan = z.object({
  ip,
  jail,
  timeofban: z.number(),
  bantime: z.number(),
  failures: z.number(),
});

const firewallDump = z.object({
  iptables: z.string().nullable(),
  ipset: z.string().nullable(),
  nft: z.string().nullable(),
});

// Calls from the central end up as fail2ban-client arguments on the agent's machine
const actionName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,127}$/, 'Invalid name');

// The connector methods an agent serves: parameters checked on the agent, results on the central.
// Writes come in a later version, behind AGENT_WRITE on the agent's machine.
export const agentMethods = {
  status: { params: z.tuple([]), result: hostStatus },
  listJails: { params: z.tuple([]), result: z.array(jailStatus) },
  jail: { params: z.tuple([jailName]), result: jailStatus },
  jailConfigs: { params: z.tuple([]), result: z.array(jailConfig) },
  activeBans: { params: z.tuple([]), result: z.array(remoteBan) },
  recentBans: { params: z.tuple([z.number().int().min(1).max(5000)]), result: z.array(remoteBan) },
  bansSince: {
    params: z.tuple([z.number().int().min(0), z.number().int().min(1).max(5000), z.number().int().min(0)]),
    result: z.array(rawBan),
  },
  jailActions: { params: z.tuple([jailName]), result: z.array(z.string().max(128)) },
  actionProperty: { params: z.tuple([jailName, actionName, actionName]), result: z.string().nullable() },
  firewall: { params: z.tuple([]), result: firewallDump },
} as const;
export type AgentMethod = keyof typeof agentMethods;
const methodName = z.enum(Object.keys(agentMethods) as [AgentMethod, ...AgentMethod[]]);

export const agentHello = z.object({
  type: z.literal('hello'),
  version: z.string().max(32),
  write: z.boolean(),
});

export const agentCall = z.object({
  type: z.literal('call'),
  id: z.number().int(),
  method: methodName,
  params: z.array(z.unknown()).max(8),
});
export type AgentCall = z.infer<typeof agentCall>;

export const agentReply = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('reply'), id: z.number().int(), ok: z.literal(true), value: z.unknown() }),
  z.object({
    type: z.literal('reply'),
    id: z.number().int(),
    ok: z.literal(false),
    code: apiErrorCode,
    error: z.string().max(500),
  }),
]);
export type AgentReply = z.infer<typeof agentReply>;

// A text frame as JSON, undefined when it is not: the schemas then refuse it
export const parseJson = (data: unknown) => {
  try {
    return JSON.parse(String(data)) as unknown;
  } catch {
    return undefined;
  }
};

export const agentBody = z.object({ name: z.string().trim().min(1).max(64) });

export const enrollResult = z.object({ hostId: z.number(), secret: z.string() });
