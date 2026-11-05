import { useTranslation } from 'react-i18next';

// More bans means more attacks: up is the warning direction
const LOOK = {
  '1': { tone: 'text-[#f0883e]', mark: '▲' },
  '0': { tone: 'text-muted', mark: '=' },
  '-1': { tone: 'text-ok', mark: '▼' },
} as const;

// Change against the previous window of the same length, in percent; null when there was nothing before
export function Trend({ change }: { change: number | null }) {
  const { t } = useTranslation();
  if (change === null) return <span className="text-xs text-muted">{t('dashboard.noTrend')}</span>;
  const { tone, mark } = LOOK[String(Math.sign(change)) as keyof typeof LOOK];
  return (
    <span className={`text-xs font-semibold ${tone}`}>
      {mark} {Math.abs(change)} %
    </span>
  );
}
