import { queryOptions } from '@tanstack/react-query';
import type { HostRow } from '../shared/hosts.ts';
import { api } from './api.ts';

export const hostsQuery = queryOptions({
  queryKey: ['hosts'],
  queryFn: () => api.get<{ hosts: HostRow[] }>('/hosts'),
  // Each fetch starts a fail2ban client per instance on the server
  staleTime: 30_000,
});
