import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { okResponse } from '../../shared/api.ts';
import { AVATAR_MAX_BYTES, avatarUpload, userInfo } from '../../shared/auth.ts';
import { audit } from '../audit.ts';
import { toIso } from '../dates.ts';
import type { Db } from '../db/index.ts';
import { avatars, users } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ADMIN_SESSION, idParams, ok } from '../http.ts';

const UPLOAD = { access: 'read', sessionOnly: true, rateLimit: { max: 10, timeWindow: '1 minute' } } as const;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The type comes from the first bytes, whatever the client says: anything else (SVG, HTML) is refused
export function imageType(data: Buffer) {
  if (data.subarray(0, 8).equals(PNG)) return 'image/png' as const;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg' as const;
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp' as const;
  return null;
}

function setAvatar(db: Db, userId: number, picture: { type: typeof avatars.$inferInsert.type; data: Buffer } | null) {
  return db.transaction((tx) => {
    if (picture) {
      tx.insert(avatars)
        .values({ userId, ...picture })
        .onConflictDoUpdate({ target: avatars.userId, set: picture })
        .run();
    } else {
      tx.delete(avatars).where(eq(avatars.userId, userId)).run();
    }
    const user = tx
      .update(users)
      .set({ avatarAt: picture ? new Date() : null })
      .where(eq(users.id, userId))
      .returning()
      .get();
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    return user;
  });
}

const signedInUser = (req: { principal: { kind: string; id: number } | null }) => {
  if (req.principal?.kind !== 'user') throw new AppError('UNAUTHORIZED', 'Authentication required');
  return req.principal.id;
};

export const avatarRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;
  const me = okResponse({ avatarAt: userInfo.shape.avatarAt });

  app.post(
    '/auth/avatar',
    { config: UPLOAD, bodyLimit: 512 * 1024, schema: { body: avatarUpload, response: { 200: me } } },
    async (req) => {
      const data = Buffer.from(req.body.image, 'base64');
      const type = imageType(data);
      if (data.length > AVATAR_MAX_BYTES) throw new AppError('VALIDATION', 'Picture too large');
      if (!type) throw new AppError('VALIDATION', 'Only PNG, JPEG or WebP pictures');
      const user = setAvatar(db, signedInUser(req), { type, data });
      audit(req, { action: 'auth.avatar', ok: true, detail: `${type}, ${data.length} bytes` });
      return ok({ avatarAt: toIso(user.avatarAt) });
    },
  );

  app.delete('/auth/avatar', { config: UPLOAD, schema: { response: { 200: me } } }, async (req) => {
    setAvatar(db, signedInUser(req), null);
    audit(req, { action: 'auth.avatar', ok: true, detail: 'removed' });
    return ok({ avatarAt: null });
  });

  // An admin can take down someone's picture, not set one
  app.delete(
    '/users/:id/avatar',
    { config: ADMIN_SESSION, schema: { params: idParams, response: { 200: okResponse() } } },
    async (req) => {
      const user = setAvatar(db, req.params.id, null);
      audit(req, { action: 'user.avatar.delete', ok: true, target: user.username });
      return ok();
    },
  );

  // The only binary route: an <img> needs the picture itself, not the JSON envelope
  app.get('/users/:id/avatar', { config: { access: 'read' }, schema: { params: idParams } }, async (req, reply) => {
    const picture = db.select().from(avatars).where(eq(avatars.userId, req.params.id)).get();
    if (!picture) throw new AppError('NOT_FOUND', 'No picture');
    return reply
      .type(picture.type)
      .header('Cache-Control', 'private, max-age=86400')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', 'inline')
      .send(picture.data);
  });
};
