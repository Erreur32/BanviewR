// Dates come from the API as UTC ISO strings and are shown in the user's time zone
export function formatDateTime(iso: string | null, timezone: string, lang: string) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(lang, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: timezone === 'browser' ? undefined : timezone,
  }).format(new Date(iso));
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
