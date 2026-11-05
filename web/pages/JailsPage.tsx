import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BanStats, JailAction, JailRow, LocatedBan } from '../../shared/fail2ban.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { IpOrigin } from '../components/IpOrigin.tsx';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorText,
  Segmented,
  SelectField,
  Table,
  TextField,
} from '../components/ui.tsx';
import { hourColumns } from '../dashboard.ts';
import { conflictText, errorText } from '../errors.ts';
import { useJailColors } from '../jailColors.ts';
import { usePersisted } from '../persisted.ts';
import { notify } from '../stores/notificationStore.ts';

const REFRESH_MS = 15_000;
// fail2ban applies a ban at once but writes its database shortly after
const DB_WRITE_DELAY_MS = 1500;

const jailsKey = (hostId: number) => ['hosts', hostId, 'jails'];
const VIEWS = ['cards', 'table'] as const;
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

// Reload, stop or start a jail: the same buttons on the card and in the table
function JailActions({ hostId, jail }: { hostId: number; jail: JailRow }) {
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

  if (!jail.running) {
    return (
      <Button size="sm" onClick={() => act.mutate('start')} disabled={act.isPending}>
        {t('jails.start')}
      </Button>
    );
  }
  return (
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
  );
}

function JailRowView({ hostId, jail, canWrite }: { hostId: number; jail: JailRow; canWrite: boolean }) {
  const { t } = useTranslation();
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
            <JailActions hostId={hostId} jail={jail} />
          </div>
        )}
      </td>
    </tr>
  );
}

// One hour of a card's sparkline: bans of this jail only
type SparkHour = { key: string; label: string; bans: number };

// Card of the mockup: colour of the jail, bans now and over 24 h, hourly sparkline, settings, actions
function JailCard({
  hostId,
  jail,
  color,
  hours,
  canWrite,
}: {
  hostId: number;
  jail: JailRow;
  color: string;
  hours: SparkHour[];
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const day = hours.reduce((sum, h) => sum + h.bans, 0);
  // Each card on its own scale: the 24 h total says how big it is
  const peak = Math.max(1, ...hours.map((h) => h.bans));
  const setting = (label: string, value: string | number | null | undefined) => (
    <span className="flex flex-col">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="whitespace-nowrap font-mono text-xs">
        {value === null || value === undefined || value === '' ? '?' : value}
      </span>
    </span>
  );

  return (
    <article
      style={{ borderTopColor: color, borderColor: jail.running ? `${color}55` : undefined }}
      className={`flex flex-col gap-3.5 rounded-lg border border-border border-t-[3px] bg-bg1 p-4 ${jail.running ? '' : 'opacity-75'}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-mono text-sm font-semibold">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate">{jail.name}</span>
        </h3>
        <Badge tone={jail.running ? 'ok' : 'neutral'}>{t(jail.running ? 'jails.running' : 'jails.stopped')}</Badge>
      </header>
      <div className="flex gap-6">
        <span className="flex flex-col">
          <span className="text-xs text-muted">{t('jails.bannedNow')}</span>
          <span className="text-2xl font-semibold tabular-nums">{jail.currentlyBanned}</span>
        </span>
        <span className="flex flex-col">
          <span className="text-xs text-muted">{t('jails.bans24h')}</span>
          <span className="text-2xl font-semibold tabular-nums">{day}</span>
        </span>
      </div>
      <figure className="m-0">
        <figcaption className="sr-only">{t('jails.sparkCaption', { name: jail.name, count: day })}</figcaption>
        <div aria-hidden="true" className="flex h-9 items-end gap-[2px]">
          {hours.map((h) => (
            <span
              key={h.key}
              title={`${h.label} · ${h.bans}`}
              className="flex-1 rounded-t-[1px]"
              style={{
                height: `${Math.max(6, Math.round((h.bans / peak) * 100))}%`,
                background: h.bans ? color : `${color}33`,
              }}
            />
          ))}
        </div>
        <span className="mt-1 block text-[11px] text-muted">{t('jails.last24h')}</span>
      </figure>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {setting('maxretry', jail.config?.maxretry)}
        {setting('findtime', formatDuration(t, jail.config?.findtime))}
        {setting('bantime', formatDuration(t, jail.config?.bantime))}
        {setting(t('jails.filter'), jail.config?.filter)}
      </div>
      {canWrite && (
        <div className="mt-auto flex flex-wrap gap-2">
          <JailActions hostId={hostId} jail={jail} />
        </div>
      )}
    </article>
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
  const { t, i18n } = useTranslation();
  const { timezone } = useCurrentUser();
  const [view, setView] = usePersisted('bvr.jails.view', VIEWS, 'cards');
  // Same query as the dashboard: hourly bans per jail over the last 24 hours, from the local history
  const day = useQuery({
    queryKey: ['hosts', hostId, 'stats', 1],
    queryFn: () => api.get<{ stats: BanStats }>(`/hosts/${hostId}/stats?days=1`),
    refetchInterval: 60_000,
    enabled: view === 'cards',
  });
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
  const list = jails.data?.jails ?? [];
  const colors = useJailColors(list.map((j) => j.name));
  const columns = hourColumns(day.data?.stats.slots ?? [], {
    now: Math.floor(Date.now() / 1000),
    hours: 24,
    timezone,
    lang: i18n.language,
    colorOf: () => '',
  });
  const hoursOf = (jail: string) =>
    columns.map((c) => ({ key: c.key, label: c.label, bans: c.parts.find((p) => p.name === jail)?.value ?? 0 }));

  return (
    <>
      <ErrorText>{jails.error && errorText(t, jails.error)}</ErrorText>
      {jails.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {list.length > 0 && (
        <Segmented
          label={t('jails.view')}
          options={VIEWS.map((v) => ({ value: v, label: t(`jails.views.${v}`) }))}
          value={view}
          onChange={setView}
        />
      )}
      {jails.data && list.length === 0 && <p className="text-sm text-muted">{t('jails.empty')}</p>}
      {list.length > 0 && view === 'cards' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((jail) => (
            <JailCard
              key={jail.name}
              hostId={hostId}
              jail={jail}
              color={colors(jail.name)}
              hours={hoursOf(jail.name)}
              canWrite={canWrite}
            />
          ))}
        </div>
      )}
      {list.length > 0 && view === 'table' && (
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
          {list.map((jail) => (
            <JailRowView key={jail.name} hostId={hostId} jail={jail} canWrite={canWrite} />
          ))}
        </Table>
      )}
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
