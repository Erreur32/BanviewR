import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Role, UserRow } from '../../../shared/auth.ts';
import { api } from '../../api.ts';
import { useCurrentUser, useFormatDateTime } from '../../auth.ts';
import { Badge, Button, Card, ConfirmButton, ErrorText, SelectField, Table, TextField } from '../../components/ui.tsx';
import { errorText } from '../../errors.ts';
import { notify } from '../../stores/notificationStore.ts';

const ROLES: Role[] = ['viewer', 'operator', 'admin'];
const usersKey = ['users'];

function RoleOptions() {
  const { t } = useTranslation();
  return ROLES.map((r) => (
    <option key={r} value={r}>
      {t(`roles.${r}`)}
    </option>
  ));
}

function CreateUserCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  const create = useMutation({
    mutationFn: () => api.post('/users', { username, password, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersKey });
      notify('success', t('users.created', { username }));
      setUsername('');
      setPassword('');
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card title={t('users.createTitle')}>
      <form onSubmit={submit}>
        <ErrorText>{create.error && errorText(t, create.error)}</ErrorText>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <TextField
            label={t('auth.username')}
            hint={t('auth.usernameHint')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            required
          />
          <TextField
            label={t('auth.password')}
            hint={t('auth.passwordHint')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
          <SelectField label={t('users.role')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <RoleOptions />
          </SelectField>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {t('users.createSubmit')}
        </Button>
      </form>
    </Card>
  );
}

function PasswordReset({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}`, { password }),
    onSuccess: () => {
      notify('success', t('users.passwordReset', { username: user.username }));
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    reset.mutate();
  }

  return (
    <form onSubmit={submit} className="max-w-md">
      <ErrorText>{reset.error && errorText(t, reset.error)}</ErrorText>
      <TextField
        label={t('users.newPasswordFor', { username: user.username })}
        hint={t('users.passwordResetHint')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={10}
        required
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={reset.isPending}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function UserRowView({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const formatDate = useFormatDateTime();
  const [resetting, setResetting] = useState(false);
  const onError = (err: Error) => notify('error', errorText(t, err));
  const refresh = () => queryClient.invalidateQueries({ queryKey: usersKey });

  const changeRole = useMutation({
    mutationFn: (role: Role) => api.patch(`/users/${user.id}`, { role }),
    onSuccess: () => {
      refresh();
      notify('success', t('users.roleChanged', { username: user.username }));
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/users/${user.id}`),
    onSuccess: () => {
      refresh();
      notify('success', t('users.deleted', { username: user.username }));
    },
    onError,
  });

  return (
    <>
      <tr>
        <td className="font-medium">
          {user.username} {isSelf && <Badge tone="accent">{t('users.you')}</Badge>}
        </td>
        <td>
          {isSelf ? (
            <Badge>{t(`roles.${user.role}`)}</Badge>
          ) : (
            <select
              aria-label={t('users.role')}
              value={user.role}
              disabled={changeRole.isPending}
              onChange={(e) => changeRole.mutate(e.target.value as Role)}
              className="rounded-md border border-border bg-bg0 px-2 py-1 text-sm"
            >
              <RoleOptions />
            </select>
          )}
        </td>
        <td className="whitespace-nowrap text-muted">{formatDate(user.createdAt)}</td>
        <td className="whitespace-nowrap text-muted">{formatDate(user.lastLoginAt) || t('users.never')}</td>
        <td>
          {!isSelf && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setResetting(!resetting)}>
                {t('users.resetPassword')}
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
      {resetting && (
        <tr>
          <td colSpan={5} className="bg-bg1">
            <PasswordReset user={user} onDone={() => setResetting(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const me = useCurrentUser();
  const users = useQuery({ queryKey: usersKey, queryFn: () => api.get<{ users: UserRow[] }>('/users') });

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">{t('users.title')}</h1>
      <p className="text-sm text-muted">{t('users.intro')}</p>
      <ErrorText>{users.error && errorText(t, users.error)}</ErrorText>
      {users.isPending && <p className="text-muted">{t('common.loading')}</p>}
      {users.data && (
        <Table columns={[t('auth.username'), t('users.role'), t('users.createdAt'), t('users.lastLogin'), '']}>
          {users.data.users.map((user) => (
            <UserRowView key={user.id} user={user} isSelf={user.id === me.id} />
          ))}
        </Table>
      )}
      <CreateUserCard />
    </div>
  );
}
