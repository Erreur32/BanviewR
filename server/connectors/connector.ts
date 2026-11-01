import type { HostStatus } from '../../shared/hosts.ts';
import type { hosts } from '../db/schema.ts';

// The only way routes reach an instance: local socket today, remote agent later
export interface Fail2banConnector {
  status(): Promise<HostStatus>;
}

export type ConnectorFactory = (host: typeof hosts.$inferSelect) => Fail2banConnector;
