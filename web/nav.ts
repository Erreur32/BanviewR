import type { IconName } from './components/NavIcon.tsx';

// Menu groups of the validated mockup (style C, folding of D, rail E); adminOnly groups and items
// are hidden from the other roles
export const NAV_GROUPS = [
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

export type NavItem = { to: string; label: string; icon: IconName };

// Pages a role may open, in menu order (adminOnly groups and items are for admins)
export function navItems(isAdmin: boolean): NavItem[] {
  return NAV_GROUPS.filter((group) => isAdmin || !('adminOnly' in group)).flatMap((group) =>
    group.items.filter((item) => isAdmin || !('adminOnly' in item)),
  );
}

// Case and accents do not count: "prefe" finds "Préférences"
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function matchLabel(query: string, label: string) {
  return fold(label).includes(fold(query.trim()));
}
