import { count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { password, role, username, userRow } from '../../shared/auth.ts';
import { audit } from '../audit.ts';
import { hashPassword } from '../auth/password.ts';
import { deleteUserSessions } from '../auth/sessions.ts';
import { toIso } from '../dates.ts';
import type { Db } from '../db/index.ts';
import { revokeTokensCreatedBy, usernameIs } from '../db/queries.ts';
import { users } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ADMIN_SESSION, idParams, ok } from '../http.ts';

const oneUser = okResponse({ user: userRow });

const toUserRow = (u: typeof users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  timezone: u.timezone,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: toIso(u.lastLoginAt),
});

function getUser(db: Db, id: number) {
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  return user;
}

// The last admin can be neither demoted nor deleted, or nobody could manage the app
function assertNotLastAdmin(db: Db, user: typeof users.$inferSelect) {
  if (user.role !== 'admin') return;
  const admins = db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()?.n ?? 0;
  if (admins <= 1) throw new AppError('CONFLICT', 'The last admin cannot be removed or demoted');
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;

  app.get(
    '/users',
    {
      config: ADMIN_SESSION,
      schema: { response: { 200: okResponse({ users: z.array(userRow) }) } },
    },
    async () => ok({ users: db.select().from(users).orderBy(users.username).all().map(toUserRow) }),
  );

  app.post(
    '/users',
    {
      config: ADMIN_SESSION,
      schema: { body: z.object({ username, password, role }), response: { 200: oneUser } },
    },
    async (req) => {
      const { username: name, role: newRole } = req.body;
      if (db.select({ id: users.id }).from(users).where(usernameIs(name)).get()) {
        throw new AppError('CONFLICT', 'Username already taken');
      }
      const passwordHash = await hashPassword(req.body.password);
      const user = db.insert(users).values({ username: name, passwordHash, role: newRole }).returning().get();
      audit(req, { action: 'user.create', ok: true, target: name, detail: newRole });
      return ok({ user: toUserRow(user) });
    },
  );

  app.patch(
    '/users/:id',
    {
      config: ADMIN_SESSION,
      schema: {
        params: idParams,
        body: z.object({ role: role.optional(), password: password.optional() }),
        response: { 200: oneUser },
      },
    },
    async (req) => {
      const user = getUser(db, req.params.id);
      const { role: newRole, password: newPassword } = req.body;
      if (newRole && newRole !== user.role) assertNotLastAdmin(db, user);

      const changes: Partial<typeof users.$inferInsert> = {};
      if (newRole) changes.role = newRole;
      if (newPassword) changes.passwordHash = await hashPassword(newPassword);
      if (Object.keys(changes).length === 0) throw new AppError('VALIDATION', 'Nothing to update');

      const updated = db.update(users).set(changes).where(eq(users.id, user.id)).returning().get();
      // A new password or role must not keep old sessions alive
      deleteUserSessions(db, user.id);
      // Only admins create tokens: leaving the role takes them away
      const revoked = newRole && newRole !== 'admin' && user.role === 'admin' ? revokeTokensCreatedBy(db, user.id) : 0;
      audit(req, {
        action: 'user.update',
        ok: true,
        target: user.username,
        detail: Object.keys(req.body).join(',') + (revoked ? `, ${revoked} token(s) revoked` : ''),
      });
      return ok({ user: toUserRow(updated) });
    },
  );

  app.delete(
    '/users/:id',
    { config: ADMIN_SESSION, schema: { params: idParams, response: { 200: okResponse() } } },
    async (req) => {
      const user = getUser(db, req.params.id);
      if (req.principal?.kind === 'user' && req.principal.id === user.id) {
        throw new AppError('CONFLICT', 'You cannot delete your own account');
      }
      assertNotLastAdmin(db, user);
      const revoked = revokeTokensCreatedBy(db, user.id);
      db.delete(users).where(eq(users.id, user.id)).run();
      audit(req, { action: 'user.delete', ok: true, target: user.username, detail: `${revoked} token(s) revoked` });
      return ok();
    },
  );
};
