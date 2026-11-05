import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { errorText } from '../errors.ts';
import { hostsQuery } from '../hosts.ts';
import { ErrorText } from './ui.tsx';

// One instance chosen for the whole app, so it stays the same from page to page.
// shortcut: kept in memory, a reload goes back to the first instance; persist it if users ask
const useChosenHost = create<{ chosen: number | null; choose: (id: number) => void }>((set) => ({
  chosen: null,
  choose: (chosen) => set({ chosen }),
}));

function useHost() {
  const hosts = useQuery(hostsQuery);
  const { chosen, choose } = useChosenHost();
  const list = hosts.data?.hosts ?? [];
  // A removed instance falls back to the first one
  const hostId = list.some((h) => h.id === chosen) ? (chosen as number) : list[0]?.id;
  return { hosts, list, hostId, choose };
}

// Instance picker of the sidebar, shown only when there is a choice
export function HostPicker() {
  const { t } = useTranslation();
  const { list, hostId, choose } = useHost();
  if (list.length < 2) return null;
  return (
    <label className="mx-3 mb-3 block text-xs text-muted">
      {t('nav.instance')}
      <select
        value={hostId}
        onChange={(e) => choose(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-border bg-bg0 px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
      >
        {list.map((host) => (
          <option key={host.id} value={host.id}>
            {host.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// Per-instance pages render for the instance chosen in the sidebar.
// children should key on hostId, to drop the state of the previous instance.
export function HostSwitch({ children }: { children: (hostId: number) => ReactNode }) {
  const { t } = useTranslation();
  const { hosts, hostId } = useHost();
  return (
    <>
      <ErrorText>{hosts.error && errorText(t, hosts.error)}</ErrorText>
      {hostId !== undefined && children(hostId)}
    </>
  );
}
