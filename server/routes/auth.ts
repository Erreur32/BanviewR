import { count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { apiResponse, okResponse } from '../../shared/api.ts';
import { authStatus, credentials, password, timezone, userInfo } from '../../shared/auth.ts';
import { audit } from '../audit.ts';
import { clearSessionCookie, setSessionCookie } from '../auth/access.ts';
import { type AttemptKey, clearFailures, lockedUntil, MAX_FAILURES, recordFailure } from '../auth/bruteForce.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { createSession, deleteSession, deleteUserSessions, purgeExpiredSessions } from '../auth/sessions.ts';
import { toIso } from '../dates.ts';
import { usernameIs } from '../db/queries.ts';
import { users } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ok } from '../http.ts';

// Stricter than the global limit, on top of the per-account lockout
const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

const signedIn = okResponse({ user: userInfo });

const toUserInfo = (u: typeof users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  timezone: u.timezone,
  avatarAt: toIso(u.avatarAt),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;
  const userCount = () => db.select({ n: count() }).from(users).get()?.n ?? 0;

  app.get(
    '/auth/status',
    { config: { access: 'public' }, schema: { response: { 200: apiResponse(authStatus) } } },
    async (req) => {
      const p = req.principal;
      const me = p?.kind === 'user' ? db.select().from(users).where(eq(users.id, p.id)).get() : undefined;
      return ok({ setupRequired: userCount() === 0, user: me ? toUserInfo(me) : null });
    },
  );

  // Creates the first admin, refused once any account exists
  app.post(
    '/auth/setup',
    {
      config: { access: 'public', rateLimit: AUTH_RATE_LIMIT },
      schema: { body: credentials, response: { 200: signedIn } },
    },
    async (req, reply) => {
      const passwordHash = await hashPassword(req.body.password);
      const user = db.transaction((tx) => {
        if ((tx.select({ n: count() }).from(users).get()?.n ?? 0) > 0) return null;
        return tx.insert(users).values({ username: req.body.username, passwordHash, role: 'admin' }).returning().get();
      });
      if (!user) throw new AppError('CONFLICT', 'Setup is already done');

      setSessionCookie(req, reply, createSession(db, user.id, req.ip, req.headers['user-agent'] ?? ''));
      audit(req, { action: 'auth.setup', ok: true, actor: { type: 'user', id: user.id, name: user.username } });
      return ok({ user: toUserInfo(user) });
    },
  );

  app.post(
    '/auth/login',
    {
      config: { access: 'public', rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: z.object({ username: z.string().max(64), password: z.string().max(256) }),
        response: { 200: signedIn },
      },
    },
    async (req, reply) => {
      const { username } = req.body;
      const keys: [AttemptKey, number][] = [
        [`user:${username.toLowerCase()}`, MAX_FAILURES.user],
        [`ip:${req.ip}`, MAX_FAILURES.ip],
      ];
      const actor = { type: 'user' as const, id: null, name: username };

      const locked = keys.map(([key]) => lockedUntil(db, key)).find(Boolean);
      if (locked) {
        audit(req, { action: 'auth.login', ok: false, detail: 'locked', actor });
        const minutes = Math.ceil((locked.getTime() - Date.now()) / 60000);
        throw new AppError('LOCKED', `Too many failed attempts, retry in ${minutes} min`);
      }

      const user = db.select().from(users).where(usernameIs(username)).get();
      const valid = await verifyPassword(user?.passwordHash, req.body.password);
      if (!user || !valid) {
        for (const [key, max] of keys) recordFailure(db, key, max);
        audit(req, { action: 'auth.login', ok: false, detail: 'invalid credentials', actor });
        throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password');
      }

      for (const [key] of keys) clearFailures(db, key);
      db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).run();
      purgeExpiredSessions(db);
      // The session presented with the request (if any) is replaced, not kept alive next to the new one
      if (req.principal?.kind === 'user') deleteSession(db, req.principal.sessionId);
      setSessionCookie(req, reply, createSession(db, user.id, req.ip, req.headers['user-agent'] ?? ''));
      audit(req, { action: 'auth.login', ok: true, actor: { ...actor, id: user.id } });
      return ok({ user: toUserInfo(user) });
    },
  );

  app.patch(
    '/auth/preferences',
    {
      config: { access: 'read', sessionOnly: true },
      schema: { body: z.object({ timezone }), response: { 200: signedIn } },
    },
    async (req) => {
      const p = req.principal;
      if (p?.kind !== 'user') throw new AppError('UNAUTHORIZED', 'Authentication required');
      const user = db.update(users).set({ timezone: req.body.timezone }).where(eq(users.id, p.id)).returning().get();
      return ok({ user: toUserInfo(user) });
    },
  );

  app.post(
    '/auth/logout',
    { config: { access: 'read', sessionOnly: true }, schema: { response: { 200: okResponse() } } },
    async (req, reply) => {
      if (req.principal?.kind === 'user') deleteSession(db, req.principal.sessionId);
      clearSessionCookie(reply);
      return ok();
    },
  );

  // Signs out every other session of the user
  app.post(
    '/auth/password',
    {
      config: { access: 'read', sessionOnly: true, rateLimit: AUTH_RATE_LIMIT },
      schema: {
        body: z.object({ currentPassword: z.string().max(256), newPassword: password }),
        response: { 200: okResponse() },
      },
    },
    async (req) => {
      const p = req.principal;
      if (p?.kind !== 'user') throw new AppError('UNAUTHORIZED', 'Authentication required');
      const user = db.select().from(users).where(eq(users.id, p.id)).get();
      if (!(await verifyPassword(user?.passwordHash, req.body.currentPassword))) {
        audit(req, { action: 'auth.password', ok: false, detail: 'wrong current password' });
        throw new AppError('INVALID_CREDENTIALS', 'Current password is wrong');
      }
      const passwordHash = await hashPassword(req.body.newPassword);
      db.update(users).set({ passwordHash }).where(eq(users.id, p.id)).run();
      deleteUserSessions(db, p.id, p.sessionId);
      audit(req, { action: 'auth.password', ok: true });
      return ok();
    },
  );
};
