import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api.ts';
import { useCurrentUser } from '../auth.ts';
import { Avatar } from '../components/Avatar.tsx';
import { HostPicker } from '../components/HostSwitch.tsx';
import { type IconName, NavIcon } from '../components/NavIcon.tsx';
import { Logo } from '../components/ui.tsx';
import { usePersisted } from '../persisted.ts';

// Menu groups of the validated mockup (style C, folding of D, rail E); adminOnly groups and items
// are hidden from the other roles
const NAV_GROUPS = [
  {
    id: 'watch',
    items: [
      { to: '/', label: 'nav.dashboard', icon: 'dashboard' },
      { to: '/stats', label: 'nav.stats', icon: 'stats' },
      { to: '/addresses', label: 'nav.addresses', icon: 'addresses' },
      { to: '/live', label: 'nav.live', icon: 'live' },
    ],
  },
  {
    id: 'act',
    items: [
      { to: '/jails', label: 'nav.jails', icon: 'jails' },
      { to: '/firewall', label: 'nav.firewall', icon: 'firewall' },
      { to: '/blocklists', label: 'nav.blocklists', icon: 'blocklists' },
    ],
  },
  {
    id: 'configure',
    items: [
      { to: '/instances', label: 'nav.instances', icon: 'instances' },
      { to: '/admin/notifications', label: 'nav.notifications', icon: 'notifications', adminOnly: true },
      { to: '/preferences', label: 'nav.preferences', icon: 'preferences' },
    ],
  },
  {
    id: 'admin',
    adminOnly: true,
    items: [
      { to: '/admin/users', label: 'nav.users', icon: 'users' },
      { to: '/admin/tokens', label: 'nav.tokens', icon: 'tokens' },
      { to: '/admin/audit', label: 'nav.audit', icon: 'audit' },
      { to: '/admin/geoip', label: 'nav.geoip', icon: 'geoip' },
    ],
  },
] as const satisfies {
  id: string;
  adminOnly?: boolean;
  items: { to: string; label: string; icon: IconName; adminOnly?: boolean }[];
}[];

type NavGroupDef = (typeof NAV_GROUPS)[number];

const FOLDS = ['open', 'shut'] as const;
const SIZES = ['full', 'rail'] as const;

const linkClass =
  'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted hover:bg-bg2 hover:text-text';
const iconButton = 'rounded-md p-1.5 text-muted hover:bg-bg2 hover:text-text';

function NavGroup({ group, rail, isAdmin }: { group: NavGroupDef; rail: boolean; isAdmin: boolean }) {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [fold, setFold] = usePersisted(`bvr.nav.${group.id}`, FOLDS, group.id === 'admin' ? 'shut' : 'open');
  const items = group.items.filter((item) => isAdmin || !('adminOnly' in item));
  // The group of the page on screen stays open, and the rail always shows every icon
  const shut = fold === 'shut' && !rail && !items.some((item) => item.to === path);

  return (
    <div
      className={`flex gap-1 md:flex-col md:gap-0.5 ${rail ? 'md:border-border md:border-t md:pt-2 md:first:border-t-0 md:first:pt-0' : ''}`}
    >
      {!rail && (
        <button
          type="button"
          aria-expanded={!shut}
          onClick={() => setFold(shut ? 'open' : 'shut')}
          className="hidden items-center justify-between rounded-md px-3 py-1 text-xs font-medium text-muted hover:text-text md:flex"
        >
          {t(`nav.groups.${group.id}`)}
          <span className="flex items-center gap-1.5">
            {shut && <span className="rounded-full bg-bg2 px-1.5 text-[11px] leading-[18px]">{items.length}</span>}
            <NavIcon name="chevron" size={14} className={`transition-transform ${shut ? '-rotate-90' : ''}`} />
          </span>
        </button>
      )}
      <div className={`flex gap-1 md:flex-col md:gap-0.5 ${shut ? 'md:hidden' : ''}`}>
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            title={rail ? t(item.label) : undefined}
            activeOptions={{ exact: true }}
            className={`${linkClass} ${rail ? 'md:justify-center md:px-0' : ''}`}
            activeProps={{ className: 'bg-bg2 font-medium text-text' }}
          >
            <NavIcon name={item.icon} />
            <span className={rail ? 'md:sr-only' : ''}>{t(item.label)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Who is signed in, at the foot of the menu: opens the preferences, signs out, folds the menu into a rail
function UserBlock({ rail, toggleRail }: { rail: boolean; toggleRail: () => void }) {
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
    <div className={`flex items-center gap-1 border-border border-t px-3 py-3 ${rail ? 'md:flex-col md:px-2' : ''}`}>
      <Link
        to="/preferences"
        title={rail ? user.username : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 hover:bg-bg2"
      >
        <Avatar user={user} size={30} />
        <span className={`flex min-w-0 flex-col leading-tight ${rail ? 'md:sr-only' : ''}`}>
          <span className="truncate text-sm">{user.username}</span>
          <span className="text-xs text-muted">{t(`roles.${user.role}`)}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => logout.mutate()}
        title={t('auth.logout')}
        className={`${iconButton} inline-flex`}
      >
        <NavIcon name="logout" />
        <span className="sr-only">{t('auth.logout')}</span>
      </button>
      <button
        type="button"
        onClick={toggleRail}
        title={t(rail ? 'nav.expand' : 'nav.collapse')}
        className={`${iconButton} hidden md:inline-flex`}
      >
        <NavIcon name={rail ? 'expand' : 'collapse'} />
        <span className="sr-only">{t(rail ? 'nav.expand' : 'nav.collapse')}</span>
      </button>
    </div>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const isAdmin = useCurrentUser().role === 'admin';
  const [size, setSize] = usePersisted('bvr.nav.size', SIZES, 'full');
  const rail = size === 'rail';

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside
        className={`flex flex-col border-border border-b bg-bg1 md:sticky md:top-0 md:h-screen md:shrink-0 md:border-r md:border-b-0 ${rail ? 'md:w-16' : 'md:w-60'}`}
      >
        <p className={`px-5 py-4 ${rail ? 'md:px-0 md:text-center' : ''}`}>
          <Logo size={22} className={`text-lg ${rail ? 'md:hidden' : ''}`} />
          {rail && <Logo size={22} iconOnly className="hidden md:inline-flex" />}
        </p>
        {/* The rail has no room for the picker: unfold the menu to change instance */}
        <div className={rail ? 'md:hidden' : ''}>
          <HostPicker />
        </div>
        <nav
          aria-label={t('nav.menu')}
          className={`flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-3 md:overflow-y-auto ${rail ? 'md:px-2' : ''}`}
        >
          {NAV_GROUPS.filter((group) => isAdmin || !('adminOnly' in group)).map((group) => (
            <NavGroup key={group.id} group={group} rail={rail} isAdmin={isAdmin} />
          ))}
          {/* Served by the API server, outside the SPA router */}
          <a
            href="/api/docs/"
            target="_blank"
            rel="noreferrer"
            title={rail ? t('nav.apiDocs') : undefined}
            className={`${linkClass} md:mt-auto ${rail ? 'md:justify-center md:px-0' : ''}`}
          >
            <NavIcon name="apiDocs" />
            <span className={rail ? 'md:sr-only' : ''}>{t('nav.apiDocs')}</span>
          </a>
        </nav>
        <UserBlock rail={rail} toggleRail={() => setSize(rail ? 'full' : 'rail')} />
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}
