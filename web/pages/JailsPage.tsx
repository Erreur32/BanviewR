import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { JailAction, JailRow, LocatedBan } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { IpOrigin } from '../components/IpOrigin.tsx';
import { Badge, Button, Card, ConfirmButton, ErrorText, SelectField, Table, TextField } from '../components/ui.tsx';
import { conflictText, errorText } from '../errors.ts';
import { notify } from '../stores/notificationStore.ts';

const REFRESH_MS = 15_000;
// fail2ban applies a ban at once but writes its database shortly after
const DB_WRITE_DELAY_MS = 1500;

const jailsKey = (hostId: number) => ['hosts', hostId, 'jails'];
export const bansKey = (hostId: number) => ['hosts', hostId, 'bans'];

function useRefreshHost(hostId: number) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: jailsKey(hostId) });
    setTimeout(() => queryClient.invalidateQueries({ queryKey: bansKey(hostId) }), DB_WRITE_DELAY_MS);
  };
}

function BanForm({ hostId, jails }: { hostId: number; jails: JailRow[] }) {
  const { t } = useTranslation();
  const refresh = useRefreshHost(hostId);
  const [jail, setJail] = useState('');
  const [target, setTarget] = useState('');
  const selected = jail || jails[0]?.name || '';

  const ban = useMutation({
    mutationFn: () => api.post(`/hosts/${hostId}/jails/${selected}/ban`, { target }),
    onSuccess: () => {
      notify('success', t('jails.banned_ok', { target, jail: selected }));
      setTarget('');
      refresh();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    ban.mutate();
  }

  return (
    <Card title={t('jails.banTitle')}>
      <form onSubmit={submit}>
        <ErrorText>{ban.error && conflictText(t, ban.error, 'jails.ownAddress')}</ErrorText>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField
            label={t('jails.target')}
            hint={t('jails.targetHint')}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            maxLength={64}
            required
          />
          <SelectField label={t('jails.jail')} value={selected} onChange={(e) => setJail(e.target.value)}>
            {jails.map((j) => (
              <option key={j.name} value={j.name}>
                {j.name}
              </option>
            ))}
          </SelectField>
        </div>
        <Button type="submit" variant="danger" disabled={ban.isPending || !selected}>
          {t('jails.banSubmit')}
        </Button>
      </form>
    </Card>
  );
}

// 600 -> 10 min, 3600 -> 1 h, 86400 -> 1 d
// Opens the address page: geo, current bans and full history
export function IpLink({ hostId, ip }: { hostId: number; ip: string }) {
  return (
    <Link to="/hosts/$hostId/ips/$ip" params={{ hostId: String(hostId), ip }} className="text-accent hover:underline">
      {ip}
    </Link>
  );
}

export function formatDuration(t: TFunction, seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '';
  if (seconds < 0) return t('jails.permanent');
  if (seconds % 86400 === 0) return t('jails.days', { count: seconds / 86400 });
  if (seconds % 3600 === 0) return t('jails.hours', { count: seconds / 3600 });
  if (seconds % 60 === 0) return t('jails.minutes', { count: seconds / 60 });
  return t('jails.seconds', { count: seconds });
}

function JailRowView({ hostId, jail, canWrite }: { hostId: number; jail: JailRow; canWrite: boolean }) {
  const { t } = useTranslation();
  const refresh = useRefreshHost(hostId);
  const act = useMutation({
    mutationFn: (action: JailAction) => api.post(`/hosts/${hostId}/jails/${jail.name}/${action}`),
    onSuccess: (_, action) => {
      notify('success', t(`jails.done.${action}`, { name: jail.name }));
      refresh();
    },
    onError: (err: Error) => notify('error', errorText(t, err)),
  });

  return (
    <tr>
      <td className="font-medium">
        {jail.name} {!jail.running && <Badge>{t('jails.stopped')}</Badge>}
      </td>
      <td>
        <Badge tone={jail.currentlyBanned > 0 ? 'danger' : 'neutral'}>{jail.currentlyBanned}</Badge>
      </td>
      <td className="text-muted">{jail.totalBanned}</td>
      <td className="text-muted">{jail.currentlyFailed}</td>
      <td className="whitespace-nowrap text-muted">{formatDuration(t, jail.config?.bantime)}</td>
      <td className="text-muted">{jail.config?.maxretry}</td>
      <td>
        {canWrite && (
          <div className="flex justify-end gap-2">
            {jail.running ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => act.mutate('reload')} disabled={act.isPending}>
                  {t('jails.reload')}
                </Button>
                {/* Only with a config: without one, a stopped jail could not come back */}
                {jail.config && (
                  <ConfirmButton
                    size="sm"
                    confirmLabel={t('common.confirm')}
                    onConfirm={() => act.mutate('stop')}
                    disabled={act.isPending}
                  >
                    {t('jails.stop')}
                  </ConfirmButton>
                )}
              </>
            ) : (
              <Button size="sm" onClick={() => act.mutate('start')} disabled={act.isPending}>
                {t('jails.start')}
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function BanRowView({ hostId, ban, canWrite }: { hostId: number; ban: LocatedBan; canWrite: boolean }) {
  const { t } = useTranslation();
  const formatDate = useFormatDateTime();
  const refresh = useRefreshHost(hostId);
  const unban = useMutation({
    mutationFn: () => api.post(`/hosts/${hostId}/jails/${ban.jail}/unban`, { target: ban.ip }),
    onSuccess: () => {
      notify('success', t('jails.unbanned', { target: ban.ip }));
      refresh();
    },
    onError: (err: Error) => notify('error', errorText(t, err)),
  });
  const expiresAt = new Date(new Date(ban.bannedAt).getTime() + ban.bantime * 1000).toISOString();

  return (
    <tr>
      <td className="font-mono text-xs">
        <IpLink hostId={hostId} ip={ban.ip} />
      </td>
      <td>
        <IpOrigin geo={ban.geo} />
      </td>
      <td>{ban.jail}</td>
      <td className="whitespace-nowrap text-muted">{formatDate(ban.bannedAt)}</td>
      <td className="whitespace-nowrap text-muted">
        {ban.bantime === -1 ? t('jails.permanent') : formatDate(expiresAt)}
      </td>
      <td className="text-muted">{ban.failures}</td>
      <td>
        {canWrite && (
          <div className="flex justify-end">
            <ConfirmButton
              size="sm"
              confirmLabel={t('common.confirm')}
              onConfirm={() => unban.mutate()}
              disabled={unban.isPending}
            >
              {t('jails.unban')}
            </ConfirmButton>
          </div>
        )}
      </td>
    </tr>
  );
}

function HostJails({ hostId, canWrite }: { hostId: number; canWrite: boolean }) {
  const { t } = useTranslation();
  const jails = useQuery({
    queryKey: jailsKey(hostId),
    queryFn: () => api.get<{ jails: JailRow[] }>(`/hosts/${hostId}/jails`),
    refetchInterval: REFRESH_MS,
  });
  const bans = useQuery({
    queryKey: bansKey(hostId),
    queryFn: () => api.get<{ bans: LocatedBan[] }>(`/hosts/${hostId}/bans`),
    refetchInterval: REFRESH_MS,
  });
  const running = jails.data?.jails.filter((j) => j.running) ?? [];

  return (
    <>
      <ErrorText>{jails.error && errorText(t, jails.error)}</ErrorText>
      {jails.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {jails.data &&
        (jails.data.jails.length === 0 ? (
          <p className="text-sm text-muted">{t('jails.empty')}</p>
        ) : (
          <Table
            columns={[
              t('jails.name'),
              t('jails.banned'),
              t('jails.totalBanned'),
              t('jails.failed'),
              t('jails.bantime'),
              t('jails.maxretry'),
              '',
            ]}
          >
            {jails.data.jails.map((jail) => (
              <JailRowView key={jail.name} hostId={hostId} jail={jail} canWrite={canWrite} />
            ))}
          </Table>
        ))}
      {canWrite && running.length > 0 && <BanForm hostId={hostId} jails={running} />}

      <h2 className="pt-2 text-base font-semibold">{t('jails.bansTitle')}</h2>
      <ErrorText>{bans.error && errorText(t, bans.error)}</ErrorText>
      {bans.data &&
        (bans.data.bans.length === 0 ? (
          <p className="text-sm text-muted">{t('jails.noBans')}</p>
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
            {bans.data.bans.map((ban) => (
              <BanRowView
                key={`${ban.jail}-${ban.ip}`}
                hostId={hostId}
                ban={ban}
                // fail2ban only unbans from a running jail
                canWrite={canWrite && running.some((j) => j.name === ban.jail)}
              />
            ))}
          </Table>
        ))}
    </>
  );
}

export function JailsPage() {
  const { t } = useTranslation();
  const canWrite = useCurrentUser().role !== 'viewer';

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('jails.title')}</h1>
      <p className="text-sm text-muted">{t('jails.intro')}</p>
      <HostSwitch>{(hostId) => <HostJails key={hostId} hostId={hostId} canWrite={canWrite} />}</HostSwitch>
    </div>
  );
}
