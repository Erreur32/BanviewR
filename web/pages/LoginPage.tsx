import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserInfo } from '../../shared/auth.ts';
import { api } from '../api.ts';
import { useSignedIn } from '../auth.ts';
import { AuthShell, Button, ErrorText, TextField } from '../components/ui.tsx';
import { errorText } from '../errors.ts';

export function LoginPage() {
  const { t } = useTranslation();
  const signedIn = useSignedIn();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => api.post<{ user: UserInfo }>('/auth/login', { username, password }),
    onSuccess: signedIn,
    onError: () => setPassword(''),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate();
  }

  return (
    <AuthShell title={t('auth.loginTitle')}>
      <form onSubmit={submit}>
        <ErrorText>{login.error && errorText(t, login.error)}</ErrorText>
        <TextField
          label={t('auth.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
        <TextField
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {t('auth.loginSubmit')}
        </Button>
      </form>
    </AuthShell>
  );
}
