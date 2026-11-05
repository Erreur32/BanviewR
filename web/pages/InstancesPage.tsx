import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthResult } from '../../shared/api.ts';
import type { EmbeddedStatus, HostRow } from '../../shared/hosts.ts';
import { api } from '../api.ts';
import { useCurrentUser } from '../auth.ts';
import { Badge, Button, Card, ConfirmButton, ErrorText, Table, TextField } from '../components/ui.tsx';
import { conflictText, errorText } from '../errors.ts';
import { hostsQuery } from '../hosts.ts';
import { notify } from '../stores/notificationStore.ts';

function DetectionCard() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<HealthResult>('/health') });
  const detection = health.data?.fail2ban;
  if (!detection) return null;
  return (
    <Card title={t('instances.detectionTitle')}>
      <p className="text-sm">
        <Badge tone={detection.mode === 'external' ? 'ok' : 'neutral'}>{t(`instances.mode.${detection.mode}`)}</Badge>{' '}
        {t(`instances.reason.${detection.reason}`)}
      </p>
    </Card>
  );
}

// Admins only: the routes refuse everyone else
function EmbeddedCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['embedded'], queryFn: () => api.get<{ embedded: EmbeddedStatus }>('/embedded') });
  const change = useMutation({
    mutationFn: (action: 'start' | 'stop') => api.post<{ embedded: EmbeddedStatus }>(`/embedded/${action}`),
    onSuccess: (data, action) => {
      queryClient.setQueryData(['embedded'], data);
      queryClient.invalidateQueries({ queryKey: hostsQuery.queryKey });
      notify('success', t(action === 'start' ? 'instances.embedded.startDone' : 'instances.embedded.stopDone'));
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ['embedded'] });
      notify('error', errorText(t, err));
    },
  });
  const embedded = query.data?.embedded;

  return (
    <Card title={t('instances.embedded.title')}>
      <ErrorText>{query.error && errorText(t, query.error)}</ErrorText>
      {embedded && (
        <div className="space-y-2 text-sm">
          <p>
            {embedded.running ? (
              <Badge tone="ok">{t('instances.embedded.running', { pid: embedded.pid })}</Badge>
            ) : (
              <Badge>{t('instances.embedded.stopped')}</Badge>
            )}{' '}
            {embedded.blockedBy && t(`instances.embedded.blocked.${embedded.blockedBy}`)}
          </p>
          {embedded.firewall && (
            <p className="text-muted">
              {t('instances.embedded.firewall', { backend: embedded.firewall.backend })}{' '}
              {t(embedded.firewall.dockerUser ? 'instances.embedded.dockerUser' : 'instances.embedded.noDockerUser')}
            </p>
          )}
          {embedded.stopReason && (
            <p className="text-danger">
              {t(`instances.embedded.stopReason.${embedded.stopReason}`)}
              {embedded.lastError && <span className="block font-mono text-xs">{embedded.lastError}</span>}
            </p>
          )}
          <p className="text-muted">
            {t('instances.embedded.intro')} <span className="font-mono text-xs">{embedded.confDir}/jail.d/</span>
          </p>
          {embedded.running ? (
            <ConfirmButton
              size="sm"
              confirmLabel={t('common.confirm')}
              onConfirm={() => change.mutate('stop')}
              disabled={change.isPending}
            >
              {t('instances.embedded.stop')}
            </ConfirmButton>
          ) : (
            <Button
              size="sm"
              onClick={() => change.mutate('start')}
              disabled={change.isPending || !!embedded.blockedBy}
            >
              {t('instances.embedded.start')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function InstanceForm({ host, onDone }: { host: HostRow | null; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(host?.name ?? '');
  const [socketPath, setSocketPath] = useState(host?.socketPath ?? '');
  const [dbPath, setDbPath] = useState(host?.dbPath ?? '');
  const [confPath, setConfPath] = useState(host?.confPath ?? '/etc/fail2ban');

  const save = useMutation({
    mutationFn: () => {
      const body = { name, socketPath, dbPath, confPath };
      return host ? api.patch(`/hosts/${host.id}`, body) : api.post('/hosts', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hostsQuery.queryKey });
      notify('success', t('instances.saved', { name }));
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card title={host ? t('instances.editTitle', { name: host.name }) : t('instances.createTitle')}>
      <form onSubmit={submit}>
        <ErrorText>{save.error && conflictText(t, save.error, 'instances.conflict')}</ErrorText>
        <TextField
          label={t('instances.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          required
        />
        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField
            label={t('instances.socketPath')}
            hint={t('instances.socketHint')}
            value={socketPath}
            onChange={(e) => setSocketPath(e.target.value)}
            maxLength={512}
            pattern="/.+"
            title={t('instances.socketHint')}
            required
          />
          <TextField
            label={t('instances.dbPath')}
            hint={t('instances.dbHint')}
            value={dbPath}
            onChange={(e) => setDbPath(e.target.value)}
            maxLength={512}
            pattern="/.+"
            title={t('instances.dbHint')}
            required
          />
        </div>
        <TextField
          label={t('instances.confPath')}
          hint={t('instances.confHint')}
          value={confPath}
          onChange={(e) => setConfPath(e.target.value)}
          maxLength={512}
          pattern="/.+"
          title={t('instances.confHint')}
          required
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
          {host && (
            <Button variant="secondary" onClick={onDone}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function StatusBadge({ host }: { host: HostRow }) {
  const { t } = useTranslation();
  const { reachable, version, error } = host.status;
  if (reachable) return <Badge tone="ok">{t('instances.reachable', { version })}</Badge>;
  return <Badge tone="danger">{t(`instances.error.${error ?? 'UNREACHABLE'}`)}</Badge>;
}

function InstanceRow({
  host,
  isAdmin,
  onEdit,
  onDeleted,
}: {
  host: HostRow;
  isAdmin: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/hosts/${host.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hostsQuery.queryKey });
      notify('success', t('instances.deleted', { name: host.name }));
      onDeleted();
    },
    onError: (err: Error) => notify('error', conflictText(t, err, 'instances.lastInstance')),
  });

  return (
    <tr>
      <td className="font-medium">{host.name}</td>
      <td>
        <StatusBadge host={host} />
      </td>
      <td className="font-mono text-xs text-muted">
        <p>{host.socketPath}</p>
        <p>{host.dbPath}</p>
        <p>{host.confPath}</p>
      </td>
      <td>
        {isAdmin && (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              {t('instances.edit')}
            </Button>
            <ConfirmButton
              size="sm"
              confirmLabel={t('common.confirm')}
              onConfirm={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {t('common.delete')}
            </ConfirmButton>
          </div>
        )}
      </td>
    </tr>
  );
}

export function InstancesPage() {
  const { t } = useTranslation();
  const isAdmin = useCurrentUser().role === 'admin';
  const hosts = useQuery(hostsQuery);
  const [editing, setEditing] = useState<HostRow | null>(null);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t('instances.title')}</h1>
        <Button variant="secondary" size="sm" onClick={() => hosts.refetch()} disabled={hosts.isFetching}>
          {t('common.refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('instances.intro')}</p>
      <DetectionCard />
      {isAdmin && <EmbeddedCard />}
      <ErrorText>{hosts.error && errorText(t, hosts.error)}</ErrorText>
      {hosts.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {hosts.data && (
        <Table columns={[t('instances.name'), t('instances.status'), t('instances.paths'), '']}>
          {hosts.data.hosts.map((host) => (
            <InstanceRow
              key={host.id}
              host={host}
              isAdmin={isAdmin}
              onEdit={() => setEditing(host)}
              onDeleted={() => setEditing((current) => (current?.id === host.id ? null : current))}
            />
          ))}
        </Table>
      )}
      {/* key resets the fields when switching between create and edit */}
      {isAdmin && <InstanceForm key={editing?.id ?? 'new'} host={editing} onDone={() => setEditing(null)} />}
    </div>
  );
}
