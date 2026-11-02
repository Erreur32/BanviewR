import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { webhookBody } from '../shared/notifications.ts';
import { publish } from './mqtt.ts';
import { pw } from './test-utils.ts';

let broker: Server | undefined;
afterEach(() => new Promise((resolve) => (broker ? broker.close(resolve) : resolve(null))));

// Reads an MQTT string at offset: 2-byte length, then the bytes
const readString = (buf: Buffer, at: number) => {
  const length = buf.readUInt16BE(at);
  return { value: buf.subarray(at + 2, at + 2 + length).toString('utf8'), next: at + 2 + length };
};

// Single-byte remaining length is enough for these small test packets
function parsePackets(data: Buffer) {
  const packets: { type: number; body: Buffer }[] = [];
  for (let at = 0; at < data.length; ) {
    const length = data[at + 1] ?? 0;
    packets.push({ type: data[at] ?? 0, body: data.subarray(at + 2, at + 2 + length) });
    at += 2 + length;
  }
  return packets;
}

// Answers CONNACK with `code`, records what the client sent
function startBroker(code: number) {
  const received: Buffer[] = [];
  broker = createServer((socket) => {
    socket.on('data', (data) => {
      received.push(data);
      if (data[0] === 0x10) socket.write(Buffer.from([0x20, 2, 0, code]));
    });
  });
  return new Promise<{ port: number; received: Buffer[] }>((resolve) =>
    broker?.listen(0, '127.0.0.1', () => {
      const address = broker?.address();
      resolve({ port: typeof address === 'object' && address ? address.port : 0, received });
    }),
  );
}

describe('MQTT publish', () => {
  it('connects with the credentials and publishes to the topic', async () => {
    const { port, received } = await startBroker(0);
    const secret = pw('mqtt');
    await publish(`mqtt://bvr:${secret}@127.0.0.1:${port}/banviewr/events`, '{"event":"test"}', 2000);
    await new Promise((r) => setTimeout(r, 50));
    const [connect, published, disconnect] = parsePackets(Buffer.concat(received));

    expect(connect?.type).toBe(0x10);
    const body = connect?.body ?? Buffer.alloc(0);
    expect(readString(body, 0).value).toBe('MQTT');
    // Level 4, clean session + username + password
    expect([body[6], body[7]]).toEqual([4, 0xc2]);
    const clientId = readString(body, 10);
    const username = readString(body, clientId.next);
    expect(clientId.value).toMatch(/^banviewr-/);
    expect(username.value).toBe('bvr');
    expect(readString(body, username.next).value).toBe(secret);

    expect(published?.type).toBe(0x30);
    const topic = readString(published?.body ?? Buffer.alloc(0), 0);
    expect(topic.value).toBe('banviewr/events');
    expect(published?.body.subarray(topic.next).toString()).toBe('{"event":"test"}');
    expect(disconnect?.type).toBe(0xe0);
  });

  it('reports a refusal and an unreachable broker without the URL', async () => {
    const { port } = await startBroker(5);
    await expect(publish(`mqtt://127.0.0.1:${port}/t`, 'x', 2000)).rejects.toThrow(
      'Refused: wrong credentials or not authorized',
    );
    await expect(publish('mqtt://127.0.0.1:1/t', 'x', 2000)).rejects.toThrow('ECONNREFUSED');
  });

  it('accepts only usable broker URLs', () => {
    const check = (target: string) => webhookBody.safeParse({ name: 'm', kind: 'mqtt', target }).success;
    expect(check('mqtt://broker.lan/banviewr/events')).toBe(true);
    expect(check(`mqtts://bvr:${pw('m')}@broker.lan:8883/bans`)).toBe(true);
    for (const bad of [
      'https://broker.lan/t',
      'mqtt://broker.lan',
      'mqtt://broker.lan/bans/#',
      `mqtt://:${pw('m')}@broker.lan/t`,
    ]) {
      expect(check(bad), bad).toBe(false);
    }
  });
});
