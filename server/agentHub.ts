import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { z } from 'zod';
import { type AgentMethod, agentHello, agentMethods, agentReply, parseJson } from '../shared/agents.ts';
import { AppError } from './errors.ts';

const CALL_TIMEOUT_MS = 15_000;
const HELLO_TIMEOUT_MS = 10_000;
const PING_MS = 30_000;
// Calls waiting on one agent: past that, the agent is stuck or flooded
const MAX_PENDING = 64;

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };
export type AgentPresence = { version: string; write: boolean };
type Link = { socket: WebSocket; pending: Map<number, Pending>; presence: AgentPresence; alive: boolean };

type Params<M extends AgentMethod> = z.input<(typeof agentMethods)[M]['params']>;
type Result<M extends AgentMethod> = z.output<(typeof agentMethods)[M]['result']>;

// Live connections of the enrolled agents, one per instance. Everything an agent sends is checked:
// a hello first, then replies to calls this side made. onChange gets the presence, null when it leaves.
export function createAgentHub(
  log: FastifyBaseLogger,
  onChange: (hostId: number, presence: AgentPresence | null) => void,
) {
  const links = new Map<number, Link>();
  let nextId = 1;

  // A silent agent (network cut without a close) is dropped after one missed pong
  const heartbeat = setInterval(() => {
    for (const link of links.values()) {
      if (!link.alive) {
        link.socket.terminate();
        continue;
      }
      link.alive = false;
      link.socket.ping();
    }
  }, PING_MS);
  heartbeat.unref();

  function drop(hostId: number, link: Link) {
    for (const pending of link.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new AppError('UNAVAILABLE', 'Agent disconnected'));
    }
    link.pending.clear();
    if (links.get(hostId) !== link) return;
    links.delete(hostId);
    onChange(hostId, null);
    log.info({ hostId }, 'Agent disconnected');
  }

  function onReply(link: Link, data: unknown) {
    const reply = agentReply.safeParse(parseJson(data));
    if (!reply.success) {
      link.socket.close(1008, 'Invalid message');
      return;
    }
    const pending = link.pending.get(reply.data.id);
    if (!pending) return;
    link.pending.delete(reply.data.id);
    clearTimeout(pending.timer);
    if (reply.data.ok) pending.resolve(reply.data.value);
    else pending.reject(new AppError(reply.data.code, reply.data.error));
  }

  return {
    // A socket whose secret was checked: it counts once its hello arrives, and replaces an older one
    accept(hostId: number, socket: WebSocket) {
      const timer = setTimeout(() => socket.close(1008, 'Hello expected'), HELLO_TIMEOUT_MS);
      socket.once('close', () => clearTimeout(timer));
      socket.once('message', (data, isBinary) => {
        clearTimeout(timer);
        const hello = agentHello.safeParse(isBinary ? undefined : parseJson(data));
        if (!hello.success) {
          socket.close(1008, 'Hello expected');
          return;
        }
        links.get(hostId)?.socket.close(4000, 'Replaced by a newer connection');
        const link: Link = {
          socket,
          pending: new Map(),
          presence: { version: hello.data.version, write: hello.data.write },
          alive: true,
        };
        links.set(hostId, link);
        socket.on('message', (more, binary) => (binary ? socket.close(1003, 'Text only') : onReply(link, more)));
        socket.on('pong', () => {
          link.alive = true;
        });
        socket.on('close', () => drop(hostId, link));
        onChange(hostId, link.presence);
        log.info({ hostId, version: link.presence.version }, 'Agent connected');
      });
      socket.on('error', (err) => log.warn({ hostId, err }, 'Agent socket error'));
    },

    online: (hostId: number): AgentPresence | null => links.get(hostId)?.presence ?? null,

    async call<M extends AgentMethod>(hostId: number, method: M, params: Params<M>): Promise<Result<M>> {
      const link = links.get(hostId);
      if (!link) throw new AppError('UNAVAILABLE', 'Agent not connected');
      if (link.pending.size >= MAX_PENDING) throw new AppError('RATE_LIMITED', 'Agent busy, retry later');
      const id = nextId++;
      const raw = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          link.pending.delete(id);
          reject(new AppError('UNAVAILABLE', 'Agent did not answer in time'));
        }, CALL_TIMEOUT_MS);
        link.pending.set(id, { resolve, reject, timer });
        link.socket.send(JSON.stringify({ type: 'call', id, method, params }));
      });
      const result = agentMethods[method].result.safeParse(raw);
      if (!result.success) throw new AppError('UNAVAILABLE', 'Agent sent an invalid answer');
      return result.data as Result<M>;
    },

    // Its secret was replaced or its instance removed
    disconnect(hostId: number) {
      links.get(hostId)?.socket.close(4001, 'Secret revoked');
    },

    // Last seen now, then the sockets go: their close events come after the database is shut
    close() {
      clearInterval(heartbeat);
      const open = [...links];
      links.clear();
      for (const [hostId, link] of open) {
        onChange(hostId, null);
        link.socket.terminate();
      }
    },
  };
}
export type AgentHub = ReturnType<typeof createAgentHub>;
