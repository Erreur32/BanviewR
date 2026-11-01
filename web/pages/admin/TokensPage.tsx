import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Scope, TokenRow } from '../../../shared/auth.ts';
import { api } from '../../api.ts';
import { useFormatDateTime } from '../../auth.ts';
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  ConfirmButton,
  ErrorText,
  Table,
  TextField,
} from '../../components/ui.tsx';
import { errorText } from '../../errors.ts';
import { hostsQuery } from '../../hosts.ts';
import { notify } from '../../stores/notificationStore.ts';

const SCOPES: Scope[] = ['read', 'write', 'admin'];
const tokensKey = ['tokens'];

type TokenStatus = 'active' | 'expired' | 'revoked';

function tokenStatus(token: TokenRow): TokenStatus {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && new Date(token.expiresAt) <= new Date()) return 'expired';
  return 'active';
}

// Shown once after creation: only the hash is stored server side
function SecretCard({ name, secret, onClose }: { name: string; secret: string; onClose: () => void }) {
  const { t } = useTranslation();
  // The clipboard API only exists on HTTPS or localhost, the field stays selectable otherwise
  const canCopy = window.isSecureContext && 'clipboard' in navigator;

  async function copy() {
    await navigator.clipboard.writeText(secret);
    notify('success', t('tokens.copied'));
  }

  return (
    <section className="rounded-md border border-ok/50 bg-ok/10 p-5">
      <h2 className="mb-2 text-base font-semibold">{t('tokens.secretTitle', { name })}</h2>
      <p className="mb-3 text-sm">{t('tokens.secretWarning')}</p>
      <div className="mb-3 flex gap-2">
        <input
          readOnly
          value={secret}
          aria-label={t('tokens.secret')}
          onFocus={(e) => e.target.select()}
          className="w-full rounded-md border border-border bg-bg0 px-3 py-2 font-mono text-sm"
        />
        {canCopy && (
          <Button variant="secondary" onClick={copy}>
            {t('tokens.copy')}
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted">
        {t('tokens.usage')} <code className="font-mono">Authorization: Bearer {'<token>'}</code>
      </p>
      <Button variant="secondary" onClick={onClose}>
        {t('tokens.secretSaved')}
      </Button>
    </section>
  );
}

function CreateTokenCard({ onCreated }: { onCreated: (name: string, secret: string) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['read']);
  const [expiresInDays, setExpiresInDays] = useState('90');
  const [hostIds, setHostIds] = useState<number[]>([]);
  const hosts = useQuery(hostsQuery);
  // The admin scope is global, the server refuses it on a limited token
  const limitable = !scopes.includes('admin');

  const create = useMutation({
    mutationFn: () =>
      api.post<{ token: TokenRow; secret: string }>('/tokens', {
        name,
        scopes,
        hostIds: limitable && hostIds.length > 0 ? hostIds : null,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
      }),
    onSuccess: ({ token, secret }) => {
      queryClient.invalidateQueries({ queryKey: tokensKey });
      onCreated(token.name, secret);
      setName('');
      setHostIds([]);
    },
  });

  function toggleScope(scope: Scope, checked: boolean) {
    setScopes((prev) => (checked ? [...prev, scope] : prev.filter((s) => s !== scope)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card title={t('tokens.createTitle')}>
      <form onSubmit={submit}>
        <ErrorText>{create.error && errorText(t, create.error)}</ErrorText>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField
            label={t('tokens.name')}
            hint={t('tokens.nameHint')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
          />
          <TextField
            label={t('tokens.expiresInDays')}
            hint={t('tokens.expiresHint')}
            type="number"
            min={1}
            max={3650}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </div>
        <fieldset className="mb-4">
          <legend className="mb-1 text-sm text-muted">{t('tokens.scopes')}</legend>
          <div className="flex flex-wrap gap-4">
            {SCOPES.map((scope) => (
              <CheckboxField
                key={scope}
                label={t(`tokens.scope.${scope}`)}
                checked={scopes.includes(scope)}
                onChange={(e) => toggleScope(scope, e.target.checked)}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{t('tokens.scopesHint')}</p>
        </fieldset>
        <fieldset className="mb-4" disabled={!limitable}>
          <legend className="mb-1 text-sm text-muted">{t('tokens.instances')}</legend>
          <div className="flex flex-wrap gap-4">
            {hosts.data?.hosts.map((host) => (
              <CheckboxField
                key={host.id}
                label={host.name}
                checked={limitable && hostIds.includes(host.id)}
                onChange={(e) =>
                  setHostIds((prev) => (e.target.checked ? [...prev, host.id] : prev.filter((id) => id !== host.id)))
                }
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            {t(limitable ? 'tokens.instancesHint' : 'tokens.instancesAdminHint')}
          </p>
        </fieldset>
        <Button type="submit" disabled={create.isPending || scopes.length === 0}>
          {t('tokens.createSubmit')}
        </Button>
      </form>
    </Card>
  );
}

const STATUS_TONE = { active: 'ok', expired: 'neutral', revoked: 'danger' } as const;

function TokenRowView({ token }: { token: TokenRow }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const formatDate = useFormatDateTime();
  const status = tokenStatus(token);
  const hosts = useQuery(hostsQuery);
  // A removed instance keeps its id in the token, shown as #id
  const hostNames = (ids: number[]) =>
    ids.map((id) => hosts.data?.hosts.find((h) => h.id === id)?.name ?? `#${id}`).join(', ');
  const mutationOpts = (done: string) => ({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tokensKey });
      notify('success', t(done, { name: token.name }));
    },
    onError: (err: Error) => notify('error', errorText(t, err)),
  });
  const revoke = useMutation({
    mutationFn: () => api.post(`/tokens/${token.id}/revoke`),
    ...mutationOpts('tokens.revoked'),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/tokens/${token.id}`),
    ...mutationOpts('tokens.deleted'),
  });

  return (
    <tr>
      <td>
        <p className="font-medium">{token.name}</p>
        <p className="font-mono text-xs text-muted">{token.prefix}...</p>
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {token.scopes.map((s) => (
            <Badge key={s}>{s}</Badge>
          ))}
        </div>
      </td>
      <td className="text-muted">{token.hostIds ? hostNames(token.hostIds) : t('tokens.allInstances')}</td>
      <td>
        <Badge tone={STATUS_TONE[status]}>{t(`tokens.status.${status}`)}</Badge>
      </td>
      <td className="whitespace-nowrap text-muted">{formatDate(token.expiresAt) || t('tokens.noExpiry')}</td>
      <td className="whitespace-nowrap text-muted">{formatDate(token.lastUsedAt) || t('users.never')}</td>
      <td>
        <div className="flex justify-end">
          <ConfirmButton
            size="sm"
            confirmLabel={t('common.confirm')}
            onConfirm={() => (status === 'revoked' ? remove : revoke).mutate()}
            disabled={remove.isPending || revoke.isPending}
          >
            {t(status === 'revoked' ? 'common.delete' : 'tokens.revoke')}
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );
}

export function TokensPage() {
  const { t } = useTranslation();
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const tokens = useQuery({ queryKey: tokensKey, queryFn: () => api.get<{ tokens: TokenRow[] }>('/tokens') });

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('tokens.title')}</h1>
      <p className="text-sm text-muted">{t('tokens.intro')}</p>
      {created && <SecretCard {...created} onClose={() => setCreated(null)} />}
      <ErrorText>{tokens.error && errorText(t, tokens.error)}</ErrorText>
      {tokens.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {tokens.data &&
        (tokens.data.tokens.length === 0 ? (
          <p className="text-sm text-muted">{t('tokens.empty')}</p>
        ) : (
          <Table
            columns={[
              t('tokens.name'),
              t('tokens.scopes'),
              t('tokens.instances'),
              t('tokens.statusLabel'),
              t('tokens.expiresAt'),
              t('tokens.lastUsed'),
              '',
            ]}
          >
            {tokens.data.tokens.map((token) => (
              <TokenRowView key={token.id} token={token} />
            ))}
          </Table>
        ))}
      <CreateTokenCard onCreated={(name, secret) => setCreated({ name, secret })} />
    </div>
  );
}
