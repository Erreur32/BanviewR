import { useState } from 'react';

// A choice of a few values remembered in this browser (display mode, chart format).
// shortcut: per browser, not per account; move to the user preferences if people ask
export function usePersisted<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return allowed.find((v) => v === stored) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const change = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Private window: the choice lasts for this page only
    }
  };
  return [value, change] as const;
}
