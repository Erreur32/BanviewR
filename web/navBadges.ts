import { useQuery } from '@tanstack/react-query';
import type { LocatedBan, ThreatRow } from '../shared/fail2ban.ts';
import type { FirewallAudit } from '../shared/firewall.ts';
import { api } from './api.ts';
import { useHost } from './components/HostSwitch.tsx';
import { severityOf } from './dashboard.ts';
import { bansKey } from './pages/JailsPage.tsx';

export type NavBadge = { tone: 'danger' | 'warn' | 'ok'; count?: number };

const REFRESH_MS = 60_000;
// A ban this recent lights the Live entry
const FRESH_MS = 5 * 60_000;

// What waits on the instance chosen in the menu. Same query keys as the pages, so the cache is shared.
export function useNavBadges(): Record<string, NavBadge | undefined> {
  const { hostId = 0 } = useHost();
  const enabled = hostId > 0;
  const threats = useQuery({
    queryKey: ['hosts', hostId, 'threats', 24],
    queryFn: () => api.get<{ threats: ThreatRow[] }>(`/hosts/${hostId}/threats?hours=24`),
    refetchInterval: REFRESH_MS,
    enabled,
  });
  const bans = useQuery({
    queryKey: bansKey(hostId),
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`/hosts/${hostId}/bans`),
    refetchInterval: REFRESH_MS,
    enabled,
  });
  // The audit runs a dozen processes on the host: only what the Firewall page already fetched
  const firewall = useQuery({
    queryKey: ['hosts', hostId, 'firewall'],
    queryFn: () => api.get<{ audit: FirewallAudit }>(`/hosts/${hostId}/firewall`),
    enabled: false,
  });

  const critical = threats.data?.threats.filter((r) => severityOf(r) === 'critical').length ?? 0;
  const issues = firewall.data?.audit.issues.length ?? 0;
  const fresh = bans.data?.bans.some((b) => Date.now() - Date.parse(b.bannedAt) < FRESH_MS) ?? false;
  return {
    '/addresses': critical ? { tone: 'danger', count: critical } : undefined,
    '/firewall': issues ? { tone: 'warn', count: issues } : undefined,
    '/live': fresh ? { tone: 'ok' } : undefined,
  };
}
