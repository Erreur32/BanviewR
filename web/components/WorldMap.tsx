import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CountryCount } from '../../shared/geoip.ts';
import world from '../world.json';
import { SEQ_EMPTY as EMPTY, SEQ_RAMP as RAMP } from './charts.tsx';
import { useCountryName } from './IpOrigin.tsx';

// Small countries (Singapore, Hong Kong...) have no outline at this scale
const ON_MAP = new Set(world.countries.map((c) => c.code));

// Log scale: a few countries usually hold most bans, linear would leave the rest blank
const level = (bans: number, max: number) =>
  max <= 1 ? RAMP.length - 1 : Math.min(RAMP.length - 1, Math.floor((Math.log(bans) / Math.log(max)) * RAMP.length));

type Hovered = { code: string | null; row: CountryCount | undefined };

// Lazy-loaded with its outlines (Natural Earth, public domain), built by scripts/world-map.mjs
export default function WorldMap({ countries }: { countries: CountryCount[] }) {
  const { t, i18n } = useTranslation();
  const countryName = useCountryName();
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const byCode = new Map(countries.map((c) => [c.country, c]));
  const max = countries[0]?.bans ?? 1;
  const top = countries[0];
  const offMap = countries.filter((c) => !ON_MAP.has(c.country));
  const describe = ({ code, row }: Hovered) =>
    row
      ? t('stats.countryValue', { country: countryName(row.country), count: row.bans, ips: row.ips })
      : t('stats.countryNone', { country: code ? countryName(code) : '?' });

  return (
    <div>
      <p className="h-5 text-xs text-muted">
        {hovered ? describe(hovered) : top && describe({ code: top.country, row: top })}
      </p>
      <svg
        viewBox={`0 0 ${world.width} ${world.height}`}
        className="mt-2 w-full"
        role="img"
        aria-label={top ? `${t('stats.map')}. ${describe({ code: top.country, row: top })}` : t('stats.map')}
        onMouseLeave={() => setHovered(null)}
      >
        {world.countries.map(({ code, d }, i) => {
          const row = code ? byCode.get(code) : undefined;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover detail only, the countries table carries the data
            <path
              key={code ?? `none-${i}`}
              d={d}
              fill={row ? RAMP[level(row.bans, max)] : EMPTY}
              stroke={hovered?.code === code && code ? '#e6edf3' : '#0d1117'}
              strokeWidth={0.5}
              strokeLinejoin="round"
              onMouseEnter={() => setHovered({ code, row })}
            />
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span>1</span>
        <span className="flex">
          {RAMP.map((color) => (
            <span key={color} className="h-2.5 w-6" style={{ background: color }} />
          ))}
        </span>
        <span>{max.toLocaleString(i18n.language)}</span>
        <span>{t('stats.logScale')}</span>
      </div>
      {offMap.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {t('stats.offMap', { countries: offMap.map((c) => countryName(c.country)).join(', ') })}
        </p>
      )}
    </div>
  );
}
