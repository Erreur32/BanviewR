import { z } from 'zod';

export const webhookKind = z.enum(['generic', 'discord', 'telegram', 'mqtt']);
export type WebhookKind = z.infer<typeof webhookKind>;

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const TELEGRAM_TOKEN = /^\d{5,}:[\w-]{30,}$/;
const TELEGRAM_CHAT = /^(-?\d{1,20}|@\w{5,32})$/;

// mqtt://user:password@broker:1883/topic or mqtts://: a host, a topic without wildcards,
// and a password only with a username (MQTT 3.1.1)
function mqttProblem(target: string) {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return 'Must be an mqtt:// or mqtts:// URL';
  }
  if (!['mqtt:', 'mqtts:'].includes(url.protocol) || !url.hostname) return 'Must be an mqtt:// or mqtts:// URL';
  const topic = decodeURIComponent(url.pathname.slice(1));
  // A raw # or ? would be read as a URL fragment or query and cut from the topic
  if (!topic || /[+#?]/.test(topic) || /[#?]/.test(target)) return 'The path must be a topic, without +, # or ?';
  if (url.password && !url.username) return 'A password needs a username';
  return null;
}

// target: the URL for generic, Discord and MQTT, the bot token for Telegram. Never sent back by the API.
export const webhookBody = z
  .object({
    name: z.string().trim().min(1).max(64),
    kind: webhookKind,
    target: z.string().trim().min(1).max(2048),
    chatId: z.string().trim().max(40).nullable().default(null),
    enabled: z.boolean().default(true),
    onBans: z.boolean().default(true),
    onActions: z.boolean().default(false),
  })
  .superRefine((w, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (w.kind === 'telegram') {
      if (!TELEGRAM_TOKEN.test(w.target)) fail('target', 'Invalid Telegram bot token');
      if (!w.chatId || !TELEGRAM_CHAT.test(w.chatId)) fail('chatId', 'Invalid Telegram chat id');
    } else if (w.kind === 'mqtt') {
      const problem = mqttProblem(w.target);
      if (problem) fail('target', problem);
    } else if (!httpUrl.safeParse(w.target).success) {
      fail('target', 'Must be an http or https URL');
    }
  });
export type WebhookBody = z.input<typeof webhookBody>;

// To change the destination, delete and recreate: the secret part is never edited in place
export const webhookPatch = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
  onBans: z.boolean().optional(),
  onActions: z.boolean().optional(),
});

export const webhookRow = z.object({
  id: z.number(),
  name: z.string(),
  kind: webhookKind,
  // Where it goes, without the secret part: the URL origin, or the Telegram chat
  destination: z.string(),
  enabled: z.boolean(),
  onBans: z.boolean(),
  onActions: z.boolean(),
  createdAt: z.string(),
  lastSentAt: z.string().nullable(),
  // null: never sent, '': last send worked, otherwise why it failed
  lastError: z.string().nullable(),
});
export type WebhookRow = z.infer<typeof webhookRow>;
