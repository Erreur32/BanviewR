import { and, eq } from 'drizzle-orm';
import type { Caller } from './audit.ts';
import type { Db } from './db/index.ts';
import { hosts, webhooks } from './db/schema.ts';
import type { Locate } from './geoip.ts';
import { publish } from './mqtt.ts';

type Webhook = typeof webhooks.$inferSelect;

const TIMEOUT_MS = 10_000;
// Lines in a chat message, then "and N more"
const MAX_LINES = 10;
const MAX_JSON_BANS = 100;
// An older ban is a catch-up (first import, restart), not news: no message storm
export const RECENT_S = 600;

export type NewBan = { ip: string; jail: string; bannedAt: number; bantime: number; failures: number };

type Notice =
  | {
      event: 'bans';
      instance: string;
      bans: { ip: string; jail: string; bannedAt: string; bantime: number; failures: number; country: string | null }[];
    }
  | { event: 'action'; instance: string; action: string; target: string; jail: string | null; actor: string }
  | { event: 'test' };

function text(n: Notice) {
  if (n.event === 'test') return 'BanviewR: test notification';
  if (n.event === 'action')
    return `BanviewR ${n.instance}: ${n.actor} ${n.action} ${n.target}${n.jail ? ` in ${n.jail}` : ''}`;
  const lines = n.bans.slice(0, MAX_LINES).map((b) => `${b.ip}${b.country ? ` (${b.country})` : ''} in ${b.jail}`);
  if (n.bans.length > MAX_LINES) lines.push(`and ${n.bans.length - MAX_LINES} more`);
  return [`BanviewR ${n.instance}: ${n.bans.length} new ban(s)`, ...lines].join('\n');
}

// The JSON event for generic webhooks and MQTT, bans capped
const jsonBody = (n: Notice) =>
  n.event === 'bans'
    ? { ...n, bans: n.bans.slice(0, MAX_JSON_BANS), more: Math.max(0, n.bans.length - MAX_JSON_BANS) }
    : n;

function request(w: Webhook, n: Notice) {
  switch (w.kind) {
    case 'discord':
      // Names come from users and fail2ban: they must not ping anyone
      return { url: w.target, body: { content: text(n), allowed_mentions: { parse: [] } } };
    case 'telegram':
      // Plain text, no parse_mode: nothing in the message is read as markup
      return {
        url: `https://api.telegram.org/bot${w.target}/sendMessage`,
        body: { chat_id: w.chatId, text: text(n), disable_web_page_preview: true },
      };
    default:
      return { url: w.target, body: jsonBody(n) };
  }
}

// Returns '' on success, else a short reason. The reason never holds the URL: it may carry a secret.
export async function send(db: Db, w: Webhook, n: Notice) {
  const error = w.kind === 'mqtt' ? await sendMqtt(w, n) : await post(w, n);
  db.update(webhooks).set({ lastSentAt: new Date(), lastError: error }).where(eq(webhooks.id, w.id)).run();
  return error;
}

// The MQTT errors are written for this purpose: no URL, no credentials
const sendMqtt = (w: Webhook, n: Notice) =>
  publish(w.target, JSON.stringify(jsonBody(n)), TIMEOUT_MS).then(
    () => '',
    (err: Error) => err.message,
  );

async function post(w: Webhook, n: Notice) {
  const { url, body } = request(w, n);
  let error = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'BanviewR' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    error = cause ?? (err instanceof Error && err.name === 'TimeoutError' ? 'Timeout' : 'Unreachable');
  }
  return error;
}

export const testNotice: Notice = { event: 'test' };

// Fire and forget: a broken webhook never stops a sync or an action
function dispatch(db: Db, on: 'onBans' | 'onActions', n: Notice) {
  const targets = db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.enabled, true), eq(webhooks[on], true)))
    .all();
  for (const w of targets) send(db, w, n).catch(() => {});
}

const instanceName = (db: Db, hostId: number) =>
  db.select({ name: hosts.name }).from(hosts).where(eq(hosts.id, hostId)).get()?.name ?? `#${hostId}`;

export function notifyBans(db: Db, locate: Locate, hostId: number, rows: NewBan[]) {
  const since = Math.floor(Date.now() / 1000) - RECENT_S;
  const recent = rows.filter((r) => r.bannedAt >= since);
  if (recent.length === 0) return;
  dispatch(db, 'onBans', {
    event: 'bans',
    instance: instanceName(db, hostId),
    bans: recent.map((b) => ({
      ip: b.ip,
      jail: b.jail,
      bannedAt: new Date(b.bannedAt * 1000).toISOString(),
      bantime: b.bantime,
      failures: b.failures,
      country: locate(b.ip)?.country ?? null,
    })),
  });
}

export function notifyAction(
  db: Db,
  caller: Caller,
  { hostId, action, target, jail }: { hostId: number; action: string; target: string; jail: string | null },
) {
  dispatch(db, 'onActions', {
    event: 'action',
    instance: instanceName(db, hostId),
    action,
    target,
    jail,
    actor: caller.principal?.name ?? 'system',
  });
}
