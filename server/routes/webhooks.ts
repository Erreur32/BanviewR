import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { okResponse } from '../../shared/api.ts';
import { webhookBody, webhookPatch, webhookRow } from '../../shared/notifications.ts';
import { audit } from '../audit.ts';
import { toIso } from '../dates.ts';
import { webhooks } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import { ADMIN_SESSION, idParams, ok } from '../http.ts';
import { send, testNotice } from '../notifications.ts';

type Webhook = typeof webhooks.$inferSelect;

// Secrets stay out: the URL path and the bot token, or the MQTT credentials (the topic is shown)
function destination(w: Webhook) {
  if (w.kind === 'telegram') return `Telegram ${w.chatId}`;
  const url = new URL(w.target);
  return w.kind === 'mqtt' ? `${url.protocol}//${url.host}${url.pathname}` : url.origin;
}

const toRow = (w: Webhook) => ({
  id: w.id,
  name: w.name,
  kind: w.kind,
  destination: destination(w),
  enabled: w.enabled,
  onBans: w.onBans,
  onActions: w.onActions,
  createdAt: w.createdAt.toISOString(),
  lastSentAt: toIso(w.lastSentAt),
  lastError: w.lastError,
});

// A signed-in admin only: a leaked token must not be able to send ban data somewhere else
export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  const { db } = app;
  const getWebhook = (id: number) => {
    const w = db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!w) throw new AppError('NOT_FOUND', 'Notification not found');
    return w;
  };
  const rowResponse = okResponse({ webhook: webhookRow });

  app.get(
    '/webhooks',
    { config: ADMIN_SESSION, schema: { response: { 200: okResponse({ webhooks: z.array(webhookRow) }) } } },
    async () => ok({ webhooks: db.select().from(webhooks).orderBy(desc(webhooks.id)).all().map(toRow) }),
  );

  app.post(
    '/webhooks',
    { config: ADMIN_SESSION, schema: { body: webhookBody, response: { 200: rowResponse } } },
    async (req) => {
      const webhook = db.insert(webhooks).values(req.body).returning().get();
      audit(req, { action: 'webhook.create', ok: true, target: webhook.name, detail: destination(webhook) });
      return ok({ webhook: toRow(webhook) });
    },
  );

  app.patch(
    '/webhooks/:id',
    { config: ADMIN_SESSION, schema: { params: idParams, body: webhookPatch, response: { 200: rowResponse } } },
    async (req) => {
      getWebhook(req.params.id);
      const webhook = db.update(webhooks).set(req.body).where(eq(webhooks.id, req.params.id)).returning().get();
      audit(req, { action: 'webhook.update', ok: true, target: webhook.name, detail: Object.keys(req.body).join(',') });
      return ok({ webhook: toRow(webhook) });
    },
  );

  app.delete(
    '/webhooks/:id',
    { config: ADMIN_SESSION, schema: { params: idParams, response: { 200: okResponse() } } },
    async (req) => {
      const webhook = getWebhook(req.params.id);
      db.delete(webhooks).where(eq(webhooks.id, webhook.id)).run();
      audit(req, { action: 'webhook.delete', ok: true, target: webhook.name });
      return ok();
    },
  );

  // Sends a sample message now, whatever the event switches, and says whether it went through
  app.post(
    '/webhooks/:id/test',
    {
      config: { ...ADMIN_SESSION, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: idParams, response: { 200: rowResponse } },
    },
    async (req) => {
      const error = await send(db, getWebhook(req.params.id), testNotice);
      const webhook = getWebhook(req.params.id);
      audit(req, { action: 'webhook.test', ok: error === '', target: webhook.name, detail: error || undefined });
      if (error) throw new AppError('UNAVAILABLE', `Sending failed: ${error}`);
      return ok({ webhook: toRow(webhook) });
    },
  );
};
