import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api.ts';
import { useCurrentUser } from '../auth.ts';
import { HostPicker } from '../components/HostSwitch.tsx';
import { Logo } from '../components/ui.tsx';

// Menu groups of the validated mockup; adminOnly groups and items are hidden from viewers
const NAV_GROUPS = [
  {
    title: 'nav.groups.watch',
    items: [
      { to: '/', label: 'nav.dashboard' },
      { to: '/stats', label: 'nav.stats' },
    ],
  },
  {
    title: 'nav.groups.act',
    items: [
      { to: '/jails', label: 'nav.jails' },
      { to: '/firewall', label: 'nav.firewall' },
      { to: '/blocklists', label: 'nav.blocklists' },
    ],
  },
  {
    title: 'nav.groups.configure',
    items: [
      { to: '/instances', label: 'nav.instances' },
      { to: '/admin/notifications', label: 'nav.notifications', adminOnly: true },
      { to: '/preferences', label: 'nav.preferences' },
    ],
  },
  {
    title: 'nav.groups.admin',
    adminOnly: true,
    items: [
      { to: '/admin/users', label: 'nav.users' },
      { to: '/admin/tokens', label: 'nav.tokens' },
      { to: '/admin/audit', label: 'nav.audit' },
      { to: '/admin/geoip', label: 'nav.geoip' },
    ],
  },
] as const satisfies {
  title: string;
  adminOnly?: boolean;
  items: { to: string; label: string; adminOnly?: boolean }[];
}[];

const navLinkClass = 'whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted hover:bg-bg2 hover:text-text';

export function AppLayout() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const isAdmin = user.role === 'admin';
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
        <p className="px-5 py-4">
          <Logo size={22} className="text-lg" />
        </p>
        <HostPicker />
        <nav aria-label={t('nav.menu')} className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:gap-4">
          {NAV_GROUPS.filter((group) => isAdmin || !('adminOnly' in group)).map((group) => (
            <div key={group.title} className="flex gap-1 md:flex-col">
              <p className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted md:block">
                {t(group.title)}
              </p>
              {group.items
                .filter((item) => isAdmin || !('adminOnly' in item))
                .map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    activeOptions={{ exact: true }}
                    className={navLinkClass}
                    activeProps={{ className: 'bg-bg2 text-text' }}
                  >
                    {t(item.label)}
                  </Link>
                ))}
            </div>
          ))}
          {/* Served by the API server, outside the SPA router */}
          <a href="/api/docs/" target="_blank" rel="noreferrer" className={navLinkClass}>
            {t('nav.apiDocs')}
          </a>
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
