import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocatedBan } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import { CountryLabel } from '../components/IpOrigin.tsx';
import { Button, Card, ErrorText, Table } from '../components/ui.tsx';
import { errorText } from '../errors.ts';
import { hostsQuery } from '../hosts.ts';
import { BanRowView, bansKey, formatDuration } from './JailsPage.tsx';

// The API maximum: past it the page says "at least"
const HISTORY_LIMIT = 1000;
const REFRESH_MS = 15_000;
const PAGE = 50;
const route = getRouteApi('/app/hosts/$hostId/ips/$ip');

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
}

// One address on one instance: where it comes from, what is banned now, everything before
export function IpPage() {
  const { t } = useTranslation();
  const formatDate = useFormatDateTime();
  const canWrite = useCurrentUser().role !== 'viewer';
  const { hostId: hostParam, ip } = route.useParams();
  const hostId = Number(hostParam);
  const [shown, setShown] = useState(PAGE);
  const host = useQuery(hostsQuery).data?.hosts.find((h) => h.id === hostId);

  const history = useQuery({
    queryKey: ['hosts', hostId, 'history', ip],
    queryFn: () =>
      api.get<{ bans: LocatedBan[] }>(`/hosts/${hostId}/history?ip=${encodeURIComponent(ip)}&limit=${HISTORY_LIMIT}`),
    refetchInterval: REFRESH_MS,
  });
  // Same cache as the Jails page, filtered here
  const active = useQuery({
    queryKey: bansKey(hostId),
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`/hosts/${hostId}/bans`),
    refetchInterval: REFRESH_MS,
  });

  const past = history.data?.bans ?? [];
  const current = active.data?.bans.filter((b) => b.ip === ip) ?? [];
  const geo = past[0]?.geo ?? current[0]?.geo ?? null;
  const jails = [...new Set(past.map((b) => b.jail))];
  const total = past.length >= HISTORY_LIMIT ? `${HISTORY_LIMIT}+` : String(past.length);

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="break-all font-mono text-xl font-semibold">{ip}</h1>
        {host && <p className="text-sm text-muted">{t('ip.onInstance', { name: host.name })}</p>}
      </div>
      {geo && (
        <Card>
          {geo.country && <CountryLabel code={geo.country} />}
          {geo.org && (
            <p className="mt-1 text-sm text-muted">
              {geo.org}
              {geo.asn && <span className="font-mono text-xs"> · AS{geo.asn}</span>}
            </p>
          )}
        </Card>
      )}

      <ErrorText>{history.error && errorText(t, history.error)}</ErrorText>
      {history.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {history.data && past.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t('ip.totalBans')} value={total} />
          <Fact label={t('ip.jails')} value={jails.join(', ')} />
          <Fact label={t('ip.firstBan')} value={formatDate(past.at(-1)?.bannedAt ?? null)} />
          <Fact label={t('ip.lastBan')} value={formatDate(past[0]?.bannedAt ?? null)} />
        </div>
      )}

      <h2 className="pt-2 text-base font-semibold">{t('jails.bansTitle')}</h2>
      <ErrorText>{active.error && errorText(t, active.error)}</ErrorText>
      {active.data &&
        (current.length === 0 ? (
          <p className="text-sm text-muted">{t('ip.notBanned')}</p>
        ) : (
          <Table
            columns={[
              t('jails.ip'),
              t('geoip.origin'),
              t('jails.jail'),
              t('jails.bannedAt'),
              t('jails.expires'),
              t('jails.failures'),
              '',
            ]}
          >
            {current.map((ban) => (
              <BanRowView key={ban.jail} hostId={hostId} ban={ban} canWrite={canWrite} />
            ))}
          </Table>
        ))}

      <h2 className="pt-2 text-base font-semibold">{t('ip.history')}</h2>
      {history.data &&
        (past.length === 0 ? (
          <p className="text-sm text-muted">{t('ip.noHistory')}</p>
        ) : (
          <Table columns={[t('jails.bannedAt'), t('jails.jail'), t('jails.bantime'), t('jails.failures')]}>
            {past.slice(0, shown).map((ban) => (
              <tr key={`${ban.jail}-${ban.bannedAt}`}>
                <td className="whitespace-nowrap text-muted">{formatDate(ban.bannedAt)}</td>
                <td>{ban.jail}</td>
                <td className="whitespace-nowrap text-muted">{formatDuration(t, ban.bantime)}</td>
                <td className="text-muted">{ban.failures}</td>
              </tr>
            ))}
          </Table>
        ))}
      {past.length > shown && (
        <Button variant="secondary" onClick={() => setShown(shown + PAGE)}>
          {t('audit.loadMore')}
        </Button>
      )}
    </div>
  );
}
