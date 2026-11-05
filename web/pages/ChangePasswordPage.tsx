import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api.ts';
import { authStatusQuery } from '../auth.ts';
import { AuthShell } from '../components/ui.tsx';
import { PasswordCard } from './PreferencesPage.tsx';

// An admin chose this password (new account, reset): the server refuses everything else until it is replaced
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      queryClient.clear();
      navigate({ to: '/login' });
    },
  });

  function done() {
    queryClient.setQueryData(authStatusQuery.queryKey, (old) =>
      old?.user ? { ...old, user: { ...old.user, mustChangePassword: false } } : old,
    );
    navigate({ to: '/' });
  }

  return (
    <AuthShell title={t('prefs.mustChangeTitle')}>
      <p className="mb-4 text-sm text-muted">{t('prefs.mustChangeIntro')}</p>
      <PasswordCard onDone={done} />
      <button
        type="button"
        onClick={() => logout.mutate()}
        className="mt-4 w-full text-center text-sm text-muted hover:text-text"
      >
        {t('auth.logout')}
      </button>
    </AuthShell>
  );
}
