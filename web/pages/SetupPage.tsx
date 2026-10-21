import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserInfo } from '../../shared/auth.ts';
import { api } from '../api.ts';
import { useSignedIn } from '../auth.ts';
import { AuthShell, Button, ErrorText, TextField } from '../components/ui.tsx';
import { errorText } from '../errors.ts';

export function SetupPage() {
  const { t } = useTranslation();
  const signedIn = useSignedIn();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const setup = useMutation({
    mutationFn: () => api.post<{ user: UserInfo }>('/auth/setup', { username, password }),
    onSuccess: signedIn,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setMismatch(password !== confirm);
    if (password === confirm) setup.mutate();
  }

  return (
    <AuthShell title={t('auth.setupTitle')}>
      <p className="mb-5 text-sm text-muted">{t('auth.setupIntro')}</p>
      <form onSubmit={submit}>
        <ErrorText>{mismatch ? t('auth.passwordMismatch') : setup.error && errorText(t, setup.error)}</ErrorText>
        <TextField
          label={t('auth.username')}
          hint={t('auth.usernameHint')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          autoFocus
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
        <TextField
          label={t('auth.passwordConfirm')}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Button type="submit" className="w-full" disabled={setup.isPending}>
          {t('auth.setupSubmit')}
        </Button>
      </form>
    </AuthShell>
  );
}
