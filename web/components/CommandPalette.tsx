import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { matchLabel, type NavItem } from '../nav.ts';
import { useHost } from './HostSwitch.tsx';
import { NavIcon } from './NavIcon.tsx';

const isIp = (value: string) => z.union([z.ipv4(), z.ipv6()]).safeParse(value).success;

type Entry = { key: string; label: string; icon: Parameters<typeof NavIcon>[0]['name']; go: () => void };

// Ctrl K (Cmd K) or the menu button: type part of a page name, or an address to open its page
export function CommandPalette({
  items,
  open,
  setOpen,
}: {
  items: NavItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hostId } = useHost();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    const el = dialog.current;
    if (open && !el?.open) {
      setQuery('');
      setSelected(0);
      el?.showModal();
    }
    if (!open && el?.open) el.close();
  }, [open]);

  const typed = query.trim();
  const entries: Entry[] = items
    .filter((item) => matchLabel(query, t(item.label)))
    .map((item) => ({ key: item.to, label: t(item.label), icon: item.icon, go: () => navigate({ to: item.to }) }));
  if (hostId !== undefined && isIp(typed)) {
    entries.unshift({
      key: 'ip',
      label: t('search.openIp', { ip: typed }),
      icon: 'addresses',
      go: () => navigate({ to: '/hosts/$hostId/ips/$ip', params: { hostId: String(hostId), ip: typed } }),
    });
  }
  const current = Math.min(selected, Math.max(0, entries.length - 1));

  function pick(entry: Entry | undefined) {
    if (!entry) return;
    setOpen(false);
    entry.go();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((current + step + entries.length) % Math.max(1, entries.length));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(entries[current]);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label={t('search.title')}
      onClose={() => setOpen(false)}
      className="mx-auto mt-[15vh] w-full max-w-md rounded-lg border border-border bg-bg1 p-0 text-text backdrop:bg-black/60"
    >
      <div className="flex items-center gap-2 border-border border-b px-3">
        <NavIcon name="search" className="text-muted" />
        {open && (
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="w-full bg-transparent py-3 text-sm outline-none"
            autoFocus
          />
        )}
      </div>
      {/* Arrow keys move the highlight from the input, Enter opens it; each entry is a button for Tab users */}
      <ul className="max-h-80 overflow-y-auto p-1">
        {entries.map((entry, i) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={() => pick(entry)}
              onMouseMove={() => setSelected(i)}
              aria-current={i === current}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${i === current ? 'bg-bg2 text-text' : 'text-muted'}`}
            >
              <NavIcon name={entry.icon} />
              {entry.label}
            </button>
          </li>
        ))}
        {entries.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t('search.none')}</li>}
      </ul>
    </dialog>
  );
}
