import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WebhookKind, WebhookRow } from '../../../shared/notifications.ts';
import { api } from '../../api.ts';
import { useFormatDateTime } from '../../auth.ts';
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  ConfirmButton,
  ErrorText,
  SelectField,
  Table,
  TextField,
} from '../../components/ui.tsx';
import { errorText } from '../../errors.ts';
import { notify } from '../../stores/notificationStore.ts';

const KINDS: WebhookKind[] = ['generic', 'discord', 'telegram', 'mqtt'];
const webhooksKey = ['webhooks'];

function CreateCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WebhookKind>('generic');
  const [target, setTarget] = useState('');
  const [chatId, setChatId] = useState('');
  const [onBans, setOnBans] = useState(true);
  const [onActions, setOnActions] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.post('/webhooks', { name, kind, target, chatId: kind === 'telegram' ? chatId : null, onBans, onActions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhooksKey });
      notify('success', t('notifications.created', { name }));
      setName('');
      setTarget('');
      setChatId('');
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card title={t('notifications.createTitle')}>
      <form onSubmit={submit}>
        <ErrorText>{create.error && errorText(t, create.error)}</ErrorText>
        <TextField label={t('notifications.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <SelectField
          label={t('notifications.kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as WebhookKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`notifications.kinds.${k}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t(kind === 'telegram' ? 'notifications.botToken' : 'notifications.url')}
          hint={t(`notifications.targetHint.${kind}`)}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          type={kind === 'telegram' ? 'password' : 'url'}
          autoComplete="off"
          required
        />
        {kind === 'telegram' && (
          <TextField
            label={t('notifications.chatId')}
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            required
          />
        )}
        <div className="mb-4 space-y-2">
          <CheckboxField
            label={t('notifications.onBans')}
            checked={onBans}
            onChange={(e) => setOnBans(e.target.checked)}
          />
          <CheckboxField
            label={t('notifications.onActions')}
            checked={onActions}
            onChange={(e) => setOnActions(e.target.checked)}
          />
        </div>
        <Button type="submit" disabled={create.isPending}>
          {t('notifications.create')}
        </Button>
      </form>
    </Card>
  );
}

function WebhookRowView({ webhook }: { webhook: WebhookRow }) {
  const { t } = useTranslation();
  const formatDate = useFormatDateTime();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: webhooksKey });
  const onError = (err: Error) => {
    notify('error', errorText(t, err));
    refresh();
  };
  const patch = useMutation({
    mutationFn: (body: Partial<Pick<WebhookRow, 'enabled' | 'onBans' | 'onActions'>>) =>
      api.patch(`/webhooks/${webhook.id}`, body),
    onSuccess: refresh,
    onError,
  });
  const test = useMutation({
    mutationFn: () => api.post(`/webhooks/${webhook.id}/test`),
    onSuccess: () => {
      notify('success', t('notifications.testSent', { name: webhook.name }));
      refresh();
    },
    onError,
  });
  const remove = useMutation({ mutationFn: () => api.delete(`/webhooks/${webhook.id}`), onSuccess: refresh, onError });

  return (
    <tr>
      <td>
        {webhook.name} {!webhook.enabled && <Badge>{t('notifications.disabled')}</Badge>}
        <p className="text-xs text-muted">{t(`notifications.kinds.${webhook.kind}`)}</p>
      </td>
      <td className="font-mono text-xs text-muted">{webhook.destination}</td>
      <td>
        <div className="space-y-1">
          <CheckboxField
            label={t('notifications.onBans')}
            checked={webhook.onBans}
            onChange={(e) => patch.mutate({ onBans: e.target.checked })}
          />
          <CheckboxField
            label={t('notifications.onActions')}
            checked={webhook.onActions}
            onChange={(e) => patch.mutate({ onActions: e.target.checked })}
          />
        </div>
      </td>
      <td>
        {webhook.lastError === null ? (
          <Badge>{t('notifications.neverSent')}</Badge>
        ) : webhook.lastError === '' ? (
          <Badge tone="ok">{t('notifications.sentOk')}</Badge>
        ) : (
          <Badge tone="danger">{webhook.lastError}</Badge>
        )}
        <p className="mt-1 whitespace-nowrap text-xs text-muted">{formatDate(webhook.lastSentAt)}</p>
      </td>
      <td>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => patch.mutate({ enabled: !webhook.enabled })}
            disabled={patch.isPending}
          >
            {t(webhook.enabled ? 'notifications.disable' : 'notifications.enable')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
            {t('notifications.test')}
          </Button>
          <ConfirmButton size="sm" confirmLabel={t('common.confirm')} onConfirm={() => remove.mutate()}>
            {t('common.delete')}
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: webhooksKey,
    queryFn: () => api.get<{ webhooks: WebhookRow[] }>('/webhooks'),
  });

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('notifications.title')}</h1>
      <p className="text-sm text-muted">{t('notifications.intro')}</p>
      <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{t('notifications.privacy')}</p>
      <ErrorText>{list.error && errorText(t, list.error)}</ErrorText>
      {list.data &&
        (list.data.webhooks.length === 0 ? (
          <p className="text-sm text-muted">{t('notifications.empty')}</p>
        ) : (
          <Table
            columns={[
              t('notifications.name'),
              t('notifications.destination'),
              t('notifications.events'),
              t('notifications.lastSend'),
              '',
            ]}
          >
            {list.data.webhooks.map((w) => (
              <WebhookRowView key={w.id} webhook={w} />
            ))}
          </Table>
        ))}
      <CreateCard />
    </div>
  );
}
