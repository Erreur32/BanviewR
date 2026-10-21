import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api.ts';
import { useCurrentUser } from '../auth.ts';

const NAV = [
  { to: '/', label: 'nav.dashboard' },
  { to: '/preferences', label: 'nav.preferences' },
] as const;

export function AppLayout() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      queryClient.clear();
      navigate({ to: '/login' });
    },
  });

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-border border-b bg-bg1 md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <p className="px-5 py-4 text-lg font-semibold tracking-tight">
          Ban<span className="text-danger">view</span>R
        </p>
        <nav aria-label={t('nav.menu')} className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true }}
              className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted hover:bg-bg2 hover:text-text"
              activeProps={{ className: 'bg-bg2 text-text' }}
            >
              {t(item.label)}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-border border-b px-4 py-3 md:px-6">
          <span className="text-sm">{user.username}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            {t(`roles.${user.role}`)}
          </span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-bg2 hover:text-text"
          >
            {t('auth.logout')}
          </button>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
