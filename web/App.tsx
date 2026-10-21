import { useQuery } from '@tanstack/react-query';
import type { HealthResult } from '../shared/api.ts';
import { apiGet } from './api.ts';

export function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthResult>('/health'),
    refetchInterval: 5000,
  });

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">BanviewR</h1>
      <div className="rounded-md border border-border bg-bg1 p-4">
        {health.isPending && <p className="text-muted">Connexion au serveur...</p>}
        {health.isError && <p className="text-danger">Serveur injoignable</p>}
        {health.data && (
          <p>
            <span className="text-ok">Serveur OK</span>
            <span className="text-muted">
              {' '}
              v{health.data.version}, uptime {health.data.uptime}s
            </span>
          </p>
        )}
      </div>
    </main>
  );
}
