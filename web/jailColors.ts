import { useQuery } from '@tanstack/react-query';
import type { BanStats } from '../shared/fail2ban.ts';
import { api } from './api.ts';
import { jailColors } from './components/charts.tsx';
import { useHost } from './components/HostSwitch.tsx';

// A colour follows its jail, never the page or the period: the palette goes to the busiest jails of the
// last year on the instance shown, the names given here only fill in what the year has not seen yet.
// shortcut: the busiest of the year can change and move a colour, rarely; pin colours per jail if it bothers
export function useJailColors(names: Iterable<string>) {
  const { hostId } = useHost();
  const ranking = useQuery({
    queryKey: ['hosts', hostId, 'jailRanking'],
    queryFn: () => api.get<{ stats: BanStats }>(`/hosts/${hostId}/stats?days=365&slots=false`),
    enabled: hostId !== undefined,
    staleTime: 5 * 60_000,
  });
  return jailColors(ranking.data?.stats.topJails.map((j) => j.jail) ?? [], names);
}
