import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BLOCKLIST_PRESETS, type BlocklistRow } from '../../shared/blocklists.ts';
import { api } from '../api.ts';
import { useCurrentUser, useFormatDateTime } from '../auth.ts';
import { HostSwitch } from '../components/HostSwitch.tsx';
import { Badge, Button, Card, ConfirmButton, ErrorText, SelectField, Table, TextField } from '../components/ui.tsx';
import { errorText } from '../errors.ts';
import { notify } from '../stores/notificationStore.ts';

const listsKey = (hostId: number) => ['hosts', hostId, 'blocklists'];

function AddCard({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const create = useMutation({
    mutationFn: () => api.post(`/hosts/${hostId}/blocklists`, { name, url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listsKey(hostId) });
      notify('success', t('blocklists.added', { name }));
      setName('');
      setUrl('');
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  function pick(index: string) {
    const preset = BLOCKLIST_PRESETS[Number(index)];
    if (!preset) return;
    setName(preset.name);
    setUrl(preset.url);
  }

  return (
    <Card title={t('blocklists.addTitle')}>
      <form onSubmit={submit}>
        <ErrorText>{create.error && errorText(t, create.error)}</ErrorText>
        <SelectField label={t('blocklists.preset')} value="" onChange={(e) => pick(e.target.value)}>
          <option value="">{t('blocklists.custom')}</option>
          {BLOCKLIST_PRESETS.map((p, i) => (
            <option key={p.url} value={i}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <TextField label={t('blocklists.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <TextField
          label={t('blocklists.url')}
          hint={t('blocklists.urlHint')}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <Button type="submit" disabled={create.isPending}>
          {t('blocklists.add')}
        </Button>
      </form>
    </Card>
  );
}

function ListRow({ hostId, list, canWrite }: { hostId: number; list: BlocklistRow; canWrite: boolean }) {
  const { t, i18n } = useTranslation();
  const formatDate = useFormatDateTime();
  const queryClient = useQueryClient();
  const base = `/hosts/${hostId}/blocklists/${list.id}`;
  const options = {
    onSettled: () => queryClient.invalidateQueries({ queryKey: listsKey(hostId) }),
    onError: (err: Error) => notify('error', errorText(t, err)),
  };
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api.patch(base, { enabled }), ...options });
  const reload = useMutation({ mutationFn: () => api.post(`${base}/refresh`), ...options });
  const remove = useMutation({ mutationFn: () => api.delete(base), ...options });
  const busy = toggle.isPending || reload.isPending || remove.isPending;

  return (
    <tr>
      <td>
        {list.name}{' '}
        <Badge tone={list.enabled ? 'ok' : 'neutral'}>{t(list.enabled ? 'blocklists.on' : 'blocklists.off')}</Badge>
        <p className="max-w-xs truncate text-xs text-muted" title={list.url}>
          {list.url}
        </p>
      </td>
      <td className="whitespace-nowrap">
        {list.entries.toLocaleString(i18n.language)}
        {list.skipped > 0 && <p className="text-xs text-muted">{t('blocklists.skipped', { count: list.skipped })}</p>}
      </td>
      <td className="text-xs">
        {list.loadedAt ? formatDate(list.loadedAt) : <span className="text-muted">{t('blocklists.never')}</span>}
        {list.lastError && <p className="text-danger">{list.lastError}</p>}
        <p className="font-mono text-muted">{list.set}</p>
      </td>
      {canWrite && (
        <td>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => toggle.mutate(!list.enabled)}>
              {toggle.isPending
                ? t('blocklists.loading')
                : t(list.enabled ? 'blocklists.turnOff' : 'blocklists.turnOn')}
            </Button>
            {list.enabled && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => reload.mutate()}>
                {reload.isPending ? t('blocklists.loading') : t('blocklists.refresh')}
              </Button>
            )}
            <ConfirmButton
              size="sm"
              disabled={busy}
              confirmLabel={t('blocklists.confirmDelete')}
              onConfirm={() => remove.mutate()}
            >
              {t('blocklists.delete')}
            </ConfirmButton>
          </div>
        </td>
      )}
    </tr>
  );
}

function HostBlocklists({ hostId }: { hostId: number }) {
  const { t } = useTranslation();
  const canWrite = useCurrentUser().role === 'admin';
  const lists = useQuery({
    queryKey: listsKey(hostId),
    queryFn: () => api.get<{ blocklists: BlocklistRow[] }>(`/hosts/${hostId}/blocklists`),
  });
  const rows = lists.data?.blocklists ?? [];
  const columns = [t('blocklists.list'), t('blocklists.entries'), t('blocklists.loadedAt')];

  return (
    <>
      <ErrorText>{lists.error && errorText(t, lists.error)}</ErrorText>
      <Card title={t('blocklists.listsTitle')}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{t('blocklists.none')}</p>
        ) : (
          <Table columns={canWrite ? [...columns, ''] : columns}>
            {rows.map((list) => (
              <ListRow key={list.id} hostId={hostId} list={list} canWrite={canWrite} />
            ))}
          </Table>
        )}
      </Card>
      {canWrite && <AddCard hostId={hostId} />}
    </>
  );
}

export function BlocklistsPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('blocklists.title')}</h1>
      <p className="text-sm text-muted">{t('blocklists.intro')}</p>
      <p className="text-sm text-muted">{t('blocklists.privacy')}</p>
      <HostSwitch>{(hostId) => <HostBlocklists key={hostId} hostId={hostId} />}</HostSwitch>
    </div>
  );
}
