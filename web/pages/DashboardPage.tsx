import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { HealthResult } from '../../shared/api.ts';
import { api } from '../api.ts';
import { Card } from '../components/ui.tsx';

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min ${seconds % 60} s`;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResult>('/health'),
    refetchInterval: 5000,
  });

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
      <Card title={t('dashboard.server')}>
        {health.isPending && <p className="text-muted">{t('dashboard.connecting')}</p>}
        {health.isError && <p className="text-danger">{t('dashboard.serverDown')}</p>}
        {health.data && (
          <p>
            <span className="text-ok">{t('dashboard.serverOk')}</span>
            <span className="text-muted">
              {' '}
              {t('dashboard.versionUptime', { version: health.data.version, uptime: formatUptime(health.data.uptime) })}
            </span>
          </p>
        )}
      </Card>
      <p className="text-sm text-muted">{t('dashboard.instancesSoon')}</p>
    </div>
  );
}
