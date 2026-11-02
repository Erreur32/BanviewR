import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { GeoDbStatus } from '../../../shared/geoip.ts';
import { api } from '../../api.ts';
import { useFormatDateTime } from '../../auth.ts';
import { Badge, Button, Card, ErrorText, Table } from '../../components/ui.tsx';
import { errorText } from '../../errors.ts';
import { notify } from '../../stores/notificationStore.ts';

const geoipKey = ['geoip'];

export function GeoIpPage() {
  const { t } = useTranslation();
  const formatDate = useFormatDateTime();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: geoipKey,
    queryFn: () => api.get<{ databases: GeoDbStatus[] }>('/geoip'),
  });
  const download = useMutation({
    mutationFn: () => api.post<{ databases: GeoDbStatus[] }>('/geoip/download'),
    onSuccess: (result) => {
      queryClient.setQueryData(geoipKey, result);
      // Bans and stats now carry countries
      queryClient.invalidateQueries({ queryKey: ['hosts'] });
      notify('success', t('geoip.downloaded'));
    },
    onError: (err: Error) => notify('error', errorText(t, err)),
  });

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('geoip.title')}</h1>
      <p className="text-sm text-muted">{t('geoip.intro')}</p>
      <ErrorText>{status.error && errorText(t, status.error)}</ErrorText>
      {status.data && (
        <Table columns={[t('geoip.database'), t('geoip.state'), t('geoip.type'), t('geoip.builtAt')]}>
          {status.data.databases.map((db) => (
            <tr key={db.kind}>
              <td>{t(`geoip.kind.${db.kind}`)}</td>
              <td>
                {db.loaded ? (
                  <Badge tone="ok">{t('geoip.loaded')}</Badge>
                ) : (
                  <Badge tone={db.error ? 'danger' : 'neutral'}>
                    {t(db.error ? 'geoip.unreadable' : 'geoip.missing')}
                  </Badge>
                )}
              </td>
              <td className="font-mono text-xs text-muted">{db.type ?? db.error}</td>
              <td className="whitespace-nowrap text-muted">{formatDate(db.builtAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Card title={t('geoip.downloadTitle')}>
        <p className="mb-2 text-sm text-muted">{t('geoip.downloadInfo')}</p>
        <p className="mb-4 text-sm text-muted">
          {t('geoip.license')}{' '}
          <a className="text-accent hover:underline" href="https://db-ip.com" target="_blank" rel="noreferrer">
            IP Geolocation by DB-IP
          </a>
        </p>
        <Button onClick={() => download.mutate()} disabled={download.isPending}>
          {download.isPending ? t('geoip.downloading') : t('geoip.download')}
        </Button>
      </Card>
      <Card title={t('geoip.manualTitle')}>
        <p className="text-sm text-muted">{t('geoip.manualInfo')}</p>
      </Card>
    </div>
  );
}
