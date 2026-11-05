import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Role, Scope } from '../../shared/auth.ts';
import type { Db } from '../db/index.ts';
import type { apiTokens } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { resolveApiToken } from './apiTokens.ts';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from './sessions.ts';

export type Principal =
  | {
      kind: 'user';
      id: number;
      name: string;
      role: Role;
      scopes: Scope[];
      hostIds: null;
      sessionId: string;
      confirmedAt: Date | null;
      mustChangePassword: boolean;
    }
  | { kind: 'token'; id: number; name: string; scopes: Scope[]; hostIds: number[] | null };

// 'public' routes skip authentication, the others need a principal holding the scope
export type Access = 'public' | Scope;

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
  interface FastifyContextConfig {
    // Routes without access need the admin scope: forgetting it fails closed
    access?: Access;
    // Session only: API tokens are refused (token management, password change)
    sessionOnly?: boolean;
    // Sensitive admin change: the password must have been typed in this session lately
    recentAuth?: boolean;
    // Still open while the user has to replace a password an admin chose (sign out, change it)
    passwordPending?: boolean;
  }
}

const SCOPE_RANK: Record<Scope, number> = { read: 1, write: 2, admin: 3 };
const ROLE_SCOPES: Record<Role, Scope[]> = { admin: ['admin'], operator: ['write'], viewer: ['read'] };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const RECENT_AUTH_MS = 10 * 60 * 1000;

export const hasScope = (scopes: Scope[], needed: Scope) => scopes.some((s) => SCOPE_RANK[s] >= SCOPE_RANK[needed]);

export const canAccessHost = (p: Principal, hostId: number) => p.hostIds === null || p.hostIds.includes(hostId);

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: req.protocol === 'https',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const tokenPrincipal = (token: typeof apiTokens.$inferSelect): Principal => ({
  kind: 'token',
  id: token.id,
  name: token.name,
  scopes: token.scopes,
  hostIds: token.hostIds,
});

function resolvePrincipal(db: Db, req: FastifyRequest, reply: FastifyReply): Principal | null {
  const header = req.headers.authorization;
  if (header) {
    const token = header.startsWith('Bearer ') ? resolveApiToken(db, header.slice(7).trim()) : null;
    return token && tokenPrincipal(token);
  }

  const cookieToken = req.cookies[SESSION_COOKIE];
  if (!cookieToken) return null;
  const session = resolveSession(db, cookieToken);
  if (!session) {
    clearSessionCookie(reply);
    return null;
  }
  if (session.refreshed) setSessionCookie(req, reply, cookieToken);
  const { user } = session;
  return {
    kind: 'user',
    id: user.id,
    name: user.username,
    role: user.role,
    scopes: ROLE_SCOPES[user.role],
    hostIds: null,
    sessionId: session.sessionId,
    confirmedAt: session.confirmedAt,
    mustChangePassword: user.mustChangePassword,
  };
}

// CSRF guard on top of SameSite=Strict
function assertSameOrigin(req: FastifyRequest) {
  const origin = req.headers.origin;
  const hosts = [req.headers['x-forwarded-host'], req.headers.host].filter(Boolean);
  if (!origin || !URL.canParse(origin) || !hosts.includes(new URL(origin).host)) {
    throw new AppError('FORBIDDEN', 'Cross-origin request refused');
  }
}

export async function registerAccessControl(app: FastifyInstance) {
  await app.register(cookie);
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (req, reply) => {
    // Unknown routes go to the not-found handler
    if (!req.routeOptions.url) return;
    const { access = 'admin', sessionOnly, recentAuth, passwordPending } = req.routeOptions.config;

    // Browsers attach cookies on their own: every unsafe request without a Bearer token
    // must come from our origin, including public ones (login CSRF, setup)
    if (!SAFE_METHODS.has(req.method) && !req.headers.authorization) assertSameOrigin(req);

    const principal = resolvePrincipal(app.db, req, reply);
    req.principal = principal;
    if (access === 'public') return;

    if (!principal) throw new AppError('UNAUTHORIZED', 'Authentication required');
    if (sessionOnly && principal.kind !== 'user') throw new AppError('FORBIDDEN', 'Only available to signed-in users');
    if (principal.kind === 'user' && principal.mustChangePassword && !passwordPending) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Choose a new password first');
    }
    if (!hasScope(principal.scopes, access)) throw new AppError('FORBIDDEN', `Requires the ${access} scope`);

    if (recentAuth) {
      const at = principal.kind === 'user' ? principal.confirmedAt : null;
      if (!at || Date.now() - at.getTime() > RECENT_AUTH_MS) {
        throw new AppError('REAUTH_REQUIRED', 'Type your password again to confirm');
      }
    }

    const hostId = (req.params as { hostId?: string }).hostId;
    if (hostId !== undefined && !canAccessHost(principal, Number(hostId))) {
      throw new AppError('FORBIDDEN', 'No access to this instance');
    }
  });
}
