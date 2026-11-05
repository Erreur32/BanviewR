import type { AgentHub } from '../agentHub.ts';
import type { hosts } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import type { Fail2banConnector } from './connector.ts';

// An instance reached through its agent's connection. Read-only for now: changes are refused here,
// before anything is sent, and the agent refuses them too.
export function agentConnector(hub: AgentHub, host: typeof hosts.$inferSelect): Fail2banConnector {
  const id = host.id;
  const readOnly = async () => {
    throw new AppError('FORBIDDEN', 'This instance is reached through a read-only agent');
  };
  return {
    status: async () => {
      if (!hub.online(id)) return { reachable: false, version: null, error: 'AGENT_OFFLINE' };
      try {
        return await hub.call(id, 'status', []);
      } catch {
        return { reachable: false, version: null, error: 'UNREACHABLE' };
      }
    },
    listJails: () => hub.call(id, 'listJails', []),
    jail: (name) => hub.call(id, 'jail', [name]),
    jailConfigs: () => hub.call(id, 'jailConfigs', []),
    activeBans: () => hub.call(id, 'activeBans', []),
    recentBans: (limit) => hub.call(id, 'recentBans', [limit]),
    bansSince: (since, limit, offset) => hub.call(id, 'bansSince', [since, limit, offset]),
    jailActions: (jail) => hub.call(id, 'jailActions', [jail]),
    actionProperty: (jail, action, property) => hub.call(id, 'actionProperty', [jail, action, property]),
    firewall: () => hub.call(id, 'firewall', []),
    ban: readOnly,
    unban: readOnly,
    jailAction: readOnly,
    loadBlocklist: readOnly,
    dropBlocklist: readOnly,
  };
}
