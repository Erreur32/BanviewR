import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { AuthStatus, UserInfo } from '../shared/auth.ts';
import { api } from './api.ts';

export const authStatusQuery = queryOptions({
  queryKey: ['auth', 'status'],
  queryFn: () => api.get<AuthStatus>('/auth/status'),
  staleTime: 60_000,
});

// Inside the app layout the status is already loaded and has a user
export function useCurrentUser() {
  const { data } = useSuspenseQuery(authStatusQuery);
  if (!data.user) throw new Error('useCurrentUser outside the signed-in layout');
  return data.user;
}

// After setup or sign-in: store the new user and open the app
export function useSignedIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return ({ user }: { user: UserInfo }) => {
    queryClient.setQueryData(authStatusQuery.queryKey, { ok: true, setupRequired: false, user });
    navigate({ to: '/' });
  };
}
