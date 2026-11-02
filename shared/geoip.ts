import { z } from 'zod';

// From the local GeoIP databases. null: no database loaded, or the address is not in it (private range).
export const ipGeo = z
  .object({
    // ISO 3166-1 alpha-2
    country: z.string().nullable(),
    asn: z.number().nullable(),
    org: z.string().nullable(),
  })
  .nullable();
export type IpGeo = z.infer<typeof ipGeo>;

export const geoDbKind = z.enum(['country', 'asn']);

export const geoDbStatus = z.object({
  kind: geoDbKind,
  loaded: z.boolean(),
  // From the file itself, e.g. DBIP-Country-Lite or GeoLite2-Country
  type: z.string().nullable(),
  builtAt: z.string().nullable(),
  // The file is there but could not be read
  error: z.string().nullable(),
});
export type GeoDbStatus = z.infer<typeof geoDbStatus>;

export const countryCount = z.object({ country: z.string(), bans: z.number(), ips: z.number() });
export type CountryCount = z.infer<typeof countryCount>;
