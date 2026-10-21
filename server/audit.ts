import type { FastifyRequest } from 'fastify';
import { auditLog } from './db/schema.ts';

type AuditEntry = {
  action: string;
  ok: boolean;
  hostId?: number;
  target?: string;
  detail?: string;
  // Overrides the request principal, e.g. for a failed login
  actor?: { type: 'user' | 'token' | 'system'; id: number | null; name: string };
};

export function audit(req: FastifyRequest, entry: AuditEntry) {
  const p = req.principal;
  const actor =
    entry.actor ?? (p ? { type: p.kind, id: p.id, name: p.name } : { type: 'system', id: null, name: 'system' });
  req.server.db
    .insert(auditLog)
    .values({
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      hostId: entry.hostId ?? null,
      action: entry.action,
      target: entry.target ?? null,
      ok: entry.ok,
      detail: entry.detail ?? null,
      ip: req.ip,
    })
    .run();
}
