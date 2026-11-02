import { randomBytes } from 'node:crypto';
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

// Publish-only MQTT 3.1.1 client, QoS 0: connect, publish one message, disconnect.
// A full client library would bring a dozen dependencies for these three packets.

const KEEPALIVE_S = 30;

const utf8 = (s: string) => {
  const bytes = Buffer.from(s, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
};

// Fixed header: type byte, then the remaining length, 7 bits per byte
function packet(type: number, body: Buffer) {
  const length: number[] = [];
  let n = body.length;
  do {
    const byte = n % 128;
    n = Math.floor(n / 128);
    length.push(n > 0 ? byte | 0x80 : byte);
  } while (n > 0);
  return Buffer.concat([Buffer.from([type, ...length]), body]);
}

// mqtt://user:password@broker:1883/topic, mqtts:// for TLS. The path is the topic.
export function parseMqttUrl(target: string) {
  const url = new URL(target);
  const secure = url.protocol === 'mqtts:';
  return {
    secure,
    host: url.hostname,
    port: Number(url.port) || (secure ? 8883 : 1883),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    topic: decodeURIComponent(url.pathname.slice(1)),
  };
}

export function publish(target: string, message: string, timeoutMs: number) {
  const { secure, host, port, username, password, topic } = parseMqttUrl(target);
  return new Promise<void>((resolve, reject) => {
    const socket = secure ? tlsConnect({ host, port, servername: host }) : tcpConnect({ host, port });
    const fail = (reason: string) => {
      socket.destroy();
      reject(new Error(reason));
    };
    socket.setTimeout(timeoutMs, () => fail('Timeout'));
    socket.on('error', (err: NodeJS.ErrnoException) => fail(err.code ?? 'Unreachable'));
    // Once resolved, a later reject is a no-op
    socket.on('close', () => fail('Connection closed'));

    socket.once(secure ? 'secureConnect' : 'connect', () => {
      // Clean session, then the username and password flags when given
      let flags = 0x02;
      const fields = [utf8(`banviewr-${randomBytes(4).toString('hex')}`)];
      if (username) {
        flags |= 0x80;
        fields.push(utf8(username));
        if (password) {
          flags |= 0x40;
          fields.push(utf8(password));
        }
      }
      const header = Buffer.from([4, flags, KEEPALIVE_S >> 8, KEEPALIVE_S & 0xff]);
      socket.write(packet(0x10, Buffer.concat([utf8('MQTT'), header, ...fields])));
    });

    // CONNACK: 0x20, length 2, session flag, return code
    socket.once('data', (data: Buffer) => {
      if (data[0] !== 0x20 || data.length < 4) return fail('Not an MQTT broker');
      const code = data[3];
      if (code === 4 || code === 5) return fail('Refused: wrong credentials or not authorized');
      if (code !== 0) return fail(`Refused (code ${code})`);
      const publishPacket = packet(0x30, Buffer.concat([utf8(topic), Buffer.from(message, 'utf8')]));
      socket.end(Buffer.concat([publishPacket, Buffer.from([0xe0, 0])]), () => resolve());
    });
  });
}
