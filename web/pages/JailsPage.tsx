import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BanRow, JailStatus } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import { Badge, Button, Card, ConfirmButton, ErrorText, SelectField, Table, TextField } from '../components/ui.tsx';
import { conflictText, errorText } from '../errors.ts';
import { hostsQuery } from '../hosts.ts';
import { notify } from '../stores/notificationStore.ts';

const REFRESH_MS = 15_000;
// fail2ban applies a ban at once but writes its database shortly after
const DB_WRITE_DELAY_MS = 1500;

const jailsKey = (hostId: number) => ['hosts', hostId, 'jails'];
const bansKey = (hostId: number) => ['hosts', hostId, 'bans'];

function useRefreshHost(hostId: number) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: jailsKey(hostId) });
    setTimeout(() => queryClient.invalidateQueries({ queryKey: bansKey(hostId) }), DB_WRITE_DELAY_MS);
  };
}

function BanForm({ hostId, jails }: { hostId: number; jails: JailStatus[] }) {
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

function JailRow({ hostId, jail, canWrite }: { hostId: number; jail: JailStatus; canWrite: boolean }) {
  const { t } = useTranslation();
  const refresh = useRefreshHost(hostId);
  const reload = useMutation({
    mutationFn: () => api.post(`/hosts/${hostId}/jails/${jail.name}/reload`),
    onSuccess: () => {
      notify('success', t('jails.reloaded', { name: jail.name }));
      refresh();
    },
    onError: (err: Error) => notify('error', errorText(t, err)),
  });

  return (
    <tr>
      <td className="font-medium">{jail.name}</td>
      <td>
        <Badge tone={jail.currentlyBanned > 0 ? 'danger' : 'neutral'}>{jail.currentlyBanned}</Badge>
      </td>
      <td className="text-muted">{jail.totalBanned}</td>
      <td className="text-muted">{jail.currentlyFailed}</td>
      <td>
        {canWrite && (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => reload.mutate()} disabled={reload.isPending}>
              {t('jails.reload')}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function BanRowView({ hostId, ban, canWrite }: { hostId: number; ban: BanRow; canWrite: boolean }) {
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
      <td className="font-mono text-xs">{ban.ip}</td>
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
    queryFn: () => api.get<{ jails: JailStatus[] }>(`/hosts/${hostId}/jails`),
    refetchInterval: REFRESH_MS,
  });
  const bans = useQuery({
    queryKey: bansKey(hostId),
    queryFn: () => api.get<{ bans: BanRow[] }>(`/hosts/${hostId}/bans`),
    refetchInterval: REFRESH_MS,
  });

  return (
    <>
      <ErrorText>{jails.error && errorText(t, jails.error)}</ErrorText>
      {jails.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {jails.data &&
        (jails.data.jails.length === 0 ? (
          <p className="text-sm text-muted">{t('jails.empty')}</p>
        ) : (
          <Table columns={[t('jails.name'), t('jails.banned'), t('jails.totalBanned'), t('jails.failed'), '']}>
            {jails.data.jails.map((jail) => (
              <JailRow key={jail.name} hostId={hostId} jail={jail} canWrite={canWrite} />
            ))}
          </Table>
        ))}
      {canWrite && jails.data && jails.data.jails.length > 0 && <BanForm hostId={hostId} jails={jails.data.jails} />}

      <h2 className="pt-2 text-base font-semibold">{t('jails.bansTitle')}</h2>
      <ErrorText>{bans.error && errorText(t, bans.error)}</ErrorText>
      {bans.data &&
        (bans.data.bans.length === 0 ? (
          <p className="text-sm text-muted">{t('jails.noBans')}</p>
        ) : (
          <Table
            columns={[t('jails.ip'), t('jails.jail'), t('jails.bannedAt'), t('jails.expires'), t('jails.failures'), '']}
          >
            {bans.data.bans.map((ban) => (
              <BanRowView key={`${ban.jail}-${ban.ip}`} hostId={hostId} ban={ban} canWrite={canWrite} />
            ))}
          </Table>
        ))}
    </>
  );
}

export function JailsPage() {
  const { t } = useTranslation();
  const canWrite = useCurrentUser().role === 'admin';
  const hosts = useQuery(hostsQuery);
  const [chosen, setChosen] = useState<number | null>(null);
  const list = hosts.data?.hosts ?? [];
  const hostId = chosen ?? list[0]?.id;

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('jails.title')}</h1>
      <p className="text-sm text-muted">{t('jails.intro')}</p>
      <ErrorText>{hosts.error && errorText(t, hosts.error)}</ErrorText>
      {list.length > 1 && (
        <div className="max-w-xs">
          <SelectField label={t('jails.instance')} value={hostId} onChange={(e) => setChosen(Number(e.target.value))}>
            {list.map((host) => (
              <option key={host.id} value={host.id}>
                {host.name}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      {/* key drops the form state and queries of the previous instance */}
      {hostId !== undefined && <HostJails key={hostId} hostId={hostId} canWrite={canWrite} />}
    </div>
  );
}
