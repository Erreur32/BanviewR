import { QueryCache, QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { ApiError } from './api.ts';
import { authStatusQuery } from './auth.ts';
import { Toasts } from './components/Toasts.tsx';
import i18n from './i18n.ts';
import { AppLayout } from './pages/AppLayout.tsx';
import { AuditPage } from './pages/admin/AuditPage.tsx';
import { GeoIpPage } from './pages/admin/GeoIpPage.tsx';
import { TokensPage } from './pages/admin/TokensPage.tsx';
import { UsersPage } from './pages/admin/UsersPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { InstancesPage } from './pages/InstancesPage.tsx';
import { JailsPage } from './pages/JailsPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { PreferencesPage } from './pages/PreferencesPage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { StatsPage } from './pages/StatsPage.tsx';
import { notify } from './stores/notificationStore.ts';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // A session that expires while the app is open sends the user back to the sign-in page
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        notify('info', i18n.t('auth.sessionExpired'));
        queryClient.clear();
        router.navigate({ to: '/login' });
      }
    },
  }),
});

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toasts />
    </>
  ),
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(authStatusQuery);
    if (!status.setupRequired) throw redirect({ to: '/' });
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(authStatusQuery);
    if (status.setupRequired) throw redirect({ to: '/setup' });
    if (status.user) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

// Every signed-in page lives under this layout
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(authStatusQuery);
    if (status.setupRequired) throw redirect({ to: '/setup' });
    if (!status.user) throw redirect({ to: '/login' });
  },
  component: AppLayout,
});

const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: DashboardPage });
const instancesRoute = createRoute({ getParentRoute: () => appRoute, path: '/instances', component: InstancesPage });
const jailsRoute = createRoute({ getParentRoute: () => appRoute, path: '/jails', component: JailsPage });
const statsRoute = createRoute({ getParentRoute: () => appRoute, path: '/stats', component: StatsPage });
const preferencesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/preferences',
  component: PreferencesPage,
});

// Admin pages, the server enforces the same rule on every admin route
const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(authStatusQuery);
    if (status.user?.role !== 'admin') throw redirect({ to: '/' });
  },
});
const usersRoute = createRoute({ getParentRoute: () => adminRoute, path: '/users', component: UsersPage });
const tokensRoute = createRoute({ getParentRoute: () => adminRoute, path: '/tokens', component: TokensPage });
const auditRoute = createRoute({ getParentRoute: () => adminRoute, path: '/audit', component: AuditPage });
const geoipRoute = createRoute({ getParentRoute: () => adminRoute, path: '/geoip', component: GeoIpPage });

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  appRoute.addChildren([
    dashboardRoute,
    instancesRoute,
    jailsRoute,
    statsRoute,
    preferencesRoute,
    adminRoute.addChildren([usersRoute, tokensRoute, auditRoute, geoipRoute]),
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient } });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
