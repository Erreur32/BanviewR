import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IpGeo } from '../../shared/geoip.ts';

// Regional indicator letters: no flag images to bundle. Some systems (Windows) show the two letters instead.
const flag = (code: string) =>
  String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function useCountryName() {
  const { i18n } = useTranslation();
  const names = useMemo(
    () => new Intl.DisplayNames([i18n.language], { type: 'region', fallback: 'code' }),
    [i18n.language],
  );
  return (code: string) => {
    try {
      return names.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

export function CountryLabel({ code }: { code: string }) {
  const countryName = useCountryName();
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true">{flag(code)}</span> {countryName(code)}
    </span>
  );
}

// Country, then the network operator. Empty when the address is not located.
export function IpOrigin({ geo }: { geo: IpGeo }) {
  if (!geo) return null;
  return (
    <span className="flex flex-col">
      {geo.country && <CountryLabel code={geo.country} />}
      {geo.org && (
        <span className="max-w-56 truncate text-xs text-muted" title={geo.asn ? `AS${geo.asn} ${geo.org}` : geo.org}>
          {geo.org}
        </span>
      )}
    </span>
  );
}
