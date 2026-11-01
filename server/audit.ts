import type { FastifyRequest } from 'fastify';
import type { Principal } from './auth/access.ts';
import type { Db } from './db/index.ts';
import { auditLog } from './db/schema.ts';

// Who acts: an HTTP request or an MCP call
export type Caller = { principal: Principal | null; ip: string };

type AuditEntry = {
  action: string;
  ok: boolean;
  hostId?: number;
  target?: string;
  detail?: string;
  // Overrides the request principal, e.g. for a failed login
  actor?: { type: 'user' | 'token' | 'system'; id: number | null; name: string };
};

export function recordAudit(db: Db, { principal: p, ip }: Caller, entry: AuditEntry) {
  const actor =
    entry.actor ?? (p ? { type: p.kind, id: p.id, name: p.name } : { type: 'system', id: null, name: 'system' });
  db.insert(auditLog)
    .values({
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      hostId: entry.hostId ?? null,
      action: entry.action,
      target: entry.target ?? null,
      ok: entry.ok,
      detail: entry.detail ?? null,
      ip,
    })
    .run();
}

export const audit = (req: FastifyRequest, entry: AuditEntry) => recordAudit(req.server.db, req, entry);

// A refused or failed action is audited too, then answered as an error
export async function audited<T>(
  db: Db,
  caller: Caller,
  entry: Omit<AuditEntry, 'ok' | 'actor'>,
  change: () => Promise<T>,
) {
  try {
    const result = await change();
    recordAudit(db, caller, { ...entry, ok: true });
    return result;
  } catch (err) {
    recordAudit(db, caller, { ...entry, ok: false });
    throw err;
  }
}
