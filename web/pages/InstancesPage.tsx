import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthResult } from '../../shared/api.ts';
import type { EmbeddedStatus, HostRow } from '../../shared/hosts.ts';
import { agentCompose } from '../agentSetup.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import { Badge, Button, Card, CheckboxField, ConfirmButton, ErrorText, Table, TextField } from '../components/ui.tsx';
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
type EmbeddedResult = { embedded: EmbeddedStatus; callerIp: string };

// Where the bans land, what is never banned, the trial and the way back: read before the firewall changes
function EmbeddedStartDialog({
  open,
  status,
  callerIp,
  onStart,
  onClose,
}: {
  open: boolean;
  status: EmbeddedStatus;
  callerIp: string;
  onStart: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [understood, setUnderstood] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (open && !el?.open) {
      setUnderstood(false);
      el?.showModal();
    }
    if (!open && el?.open) el.close();
  }, [open]);

  const k = 'instances.embedded.warn';
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-full max-w-lg rounded-lg border border-border bg-bg1 p-6 text-text backdrop:bg-black/60"
    >
      <h2 className="mb-3 text-base font-semibold">{t(`${k}.title`)}</h2>
      <ul className="mb-4 list-disc space-y-2 pl-5 text-sm">
        <li>{t(`${k}.machine.${status.machine.kind}`, { name: status.machine.name ?? '?' })}</li>
        {!status.hostNetwork && <li className="text-danger">{t(`${k}.noHostNetwork`)}</li>}
        <li>{t(`${k}.ignored`, { ip: callerIp })}</li>
        <li>{t(`${k}.trial`)}</li>
        <li>
          {t(`${k}.rescue`)} <code className="font-mono text-xs">docker stop banviewr</code>
        </li>
      </ul>
      {open && (
        <CheckboxField
          label={t(`${k}.understood`)}
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" disabled={!understood} onClick={onStart}>
          {t(`${k}.start`)}
        </Button>
      </div>
    </dialog>
  );
}

function EmbeddedCard() {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const query = useQuery({
    queryKey: ['embedded'],
    queryFn: () => api.get<EmbeddedResult>('/embedded'),
    // A trial stops on its own: show it when it does
    refetchInterval: (q) => (q.state.data?.embedded.trialUntil ? 10_000 : false),
  });
  const change = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'confirm') => api.post<EmbeddedResult>(`/embedded/${action}`),
    onSuccess: (data, action) => {
      queryClient.setQueryData(['embedded'], data);
      queryClient.invalidateQueries({ queryKey: hostsQuery.queryKey });
      notify('success', t(`instances.embedded.${action}Done`));
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
      {embedded && query.data && (
        <div className="space-y-2 text-sm">
          <p>
            {embedded.running ? (
              <Badge tone="ok">{t('instances.embedded.running', { pid: embedded.pid })}</Badge>
            ) : (
              <Badge>{t('instances.embedded.stopped')}</Badge>
            )}{' '}
            {embedded.blockedBy && t(`instances.embedded.blocked.${embedded.blockedBy}`)}
          </p>
          {embedded.trialUntil && (
            <div className="rounded-md border border-[#d29922] bg-[#bb800926] p-3">
              <p className="mb-2">
                {t('instances.embedded.trialRunning', { time: formatDateTime(embedded.trialUntil) })}
              </p>
              <Button size="sm" onClick={() => change.mutate('confirm')} disabled={change.isPending}>
                {t('instances.embedded.confirm')}
              </Button>
            </div>
          )}
          <p className="text-muted">
            {t(`instances.embedded.warn.machine.${embedded.machine.kind}`, { name: embedded.machine.name ?? '?' })}
          </p>
          {!embedded.hostNetwork && <p className="text-danger">{t('instances.embedded.warn.noHostNetwork')}</p>}
          {embedded.trustedIp && (
            <p className="text-muted">{t('instances.embedded.trustedIp', { ip: embedded.trustedIp })}</p>
          )}
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
            <Button size="sm" onClick={() => setAsking(true)} disabled={change.isPending || !!embedded.blockedBy}>
              {t('instances.embedded.start')}
            </Button>
          )}
          <EmbeddedStartDialog
            open={asking}
            status={embedded}
            callerIp={query.data.callerIp}
            onClose={() => setAsking(false)}
            onStart={() => {
              setAsking(false);
              change.mutate('start');
            }}
          />
        </div>
      )}
    </Card>
  );
}

export type AgentCode = { name: string; code: string; expiresAt: string };

// Shown once: the server only keeps the code's hash
function AgentCodeCard({ agent, onClose }: { agent: AgentCode; onClose: () => void }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const [central, setCentral] = useState(window.location.origin);
  const yml = agentCompose(central, agent.code);
  // The clipboard API only exists on HTTPS or localhost, the field stays selectable otherwise
  const canCopy = window.isSecureContext && 'clipboard' in navigator;

  async function copy() {
    await navigator.clipboard.writeText(yml);
    notify('success', t('instances.agent.copied'));
  }

  return (
    <section className="rounded-md border border-ok/50 bg-ok/10 p-5">
      <h2 className="mb-2 text-base font-semibold">{t('instances.agent.codeTitle', { name: agent.name })}</h2>
      <p className="mb-3 text-sm">{t('instances.agent.codeWarning', { time: formatDateTime(agent.expiresAt) })}</p>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
        <li>{t('instances.agent.step1')}</li>
        <li>
          {t('instances.agent.step2')} <code className="font-mono">docker compose up -d</code>
        </li>
        <li>{t('instances.agent.step3')}</li>
      </ol>
      <TextField
        label={t('instances.agent.centralUrl')}
        hint={t('instances.agent.centralHint')}
        value={central}
        onChange={(e) => setCentral(e.target.value)}
      />
      <textarea
        readOnly
        value={yml}
        rows={yml.split('\n').length}
        aria-label="docker-compose.yml"
        onFocus={(e) => e.target.select()}
        className="mb-3 w-full rounded-md border border-border bg-bg0 px-3 py-2 font-mono text-xs"
      />
      <div className="flex gap-2">
        {canCopy && (
          <Button variant="secondary" onClick={copy}>
            {t('instances.agent.copy')}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t('instances.agent.done')}
        </Button>
      </div>
    </section>
  );
}

function AgentForm({ onCreated }: { onCreated: (agent: AgentCode) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: string }>('/agents', { name }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: hostsQuery.queryKey });
      onCreated({ name, ...res });
      setName('');
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card title={t('instances.agent.title')}>
      <p className="mb-3 text-sm text-muted">{t('instances.agent.intro')}</p>
      <form onSubmit={submit}>
        <ErrorText>{create.error && conflictText(t, create.error, 'instances.conflict')}</ErrorText>
        <TextField
          label={t('instances.name')}
          hint={t('instances.agent.nameHint')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          required
        />
        <Button type="submit" disabled={create.isPending}>
          {t('instances.agent.create')}
        </Button>
      </form>
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

  // An agent knows its own paths, only its name changes here
  const isAgent = host?.mode === 'agent';
  const save = useMutation({
    mutationFn: () => {
      const body = isAgent ? { name } : { name, socketPath, dbPath, confPath };
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
        {!isAgent && (
          <>
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
          </>
        )}
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
  if (host.agent && !host.agent.enrolled) return <Badge tone="neutral">{t('instances.agent.pending')}</Badge>;
  // Without a socket the database is still read: not an error to colour red
  return (
    <Badge tone={error === 'NO_SOCKET' ? 'neutral' : 'danger'}>{t(`instances.error.${error ?? 'UNREACHABLE'}`)}</Badge>
  );
}

// What the paths column says for an agent instance
function AgentDetails({ agent }: { agent: NonNullable<HostRow['agent']> }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  return (
    <div className="text-xs text-muted">
      {agent.enrolled ? (
        <>
          <p>{t('instances.agent.details', { version: agent.version ?? '?' })}</p>
          <p>
            {agent.online
              ? t('instances.agent.online')
              : t('instances.agent.lastSeen', { time: formatDateTime(agent.lastSeenAt) })}
          </p>
        </>
      ) : (
        <p>{t('instances.agent.waiting')}</p>
      )}
      {agent.codeExpiresAt && <p>{t('instances.agent.codeUntil', { time: formatDateTime(agent.codeExpiresAt) })}</p>}
    </div>
  );
}

function InstanceRow({
  host,
  isAdmin,
  onEdit,
  onDeleted,
  onCode,
}: {
  host: HostRow;
  isAdmin: boolean;
  onEdit: () => void;
  onDeleted: () => void;
  onCode: (agent: AgentCode) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const newCode = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: string }>(`/agents/${host.id}/code`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: hostsQuery.queryKey });
      onCode({ name: host.name, ...res });
    },
    onError: (err: Error) => notify('error', errorText(t, err)),
  });
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
        {host.agent ? (
          <AgentDetails agent={host.agent} />
        ) : (
          <>
            <p>{host.socketPath}</p>
            <p>{host.dbPath}</p>
            <p>{host.confPath}</p>
          </>
        )}
      </td>
      <td>
        {isAdmin && (
          <div className="flex justify-end gap-2">
            {host.agent && (
              <Button variant="secondary" size="sm" onClick={() => newCode.mutate()} disabled={newCode.isPending}>
                {t('instances.agent.newCode')}
              </Button>
            )}
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
  const [agentCode, setAgentCode] = useState<AgentCode | null>(null);

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
              onCode={setAgentCode}
            />
          ))}
        </Table>
      )}
      {agentCode && <AgentCodeCard agent={agentCode} onClose={() => setAgentCode(null)} />}
      {/* key resets the fields when switching between create and edit */}
      {isAdmin && <InstanceForm key={editing?.id ?? 'new'} host={editing} onDone={() => setEditing(null)} />}
      {isAdmin && !editing && <AgentForm onCreated={setAgentCode} />}
    </div>
  );
}
