// Builds web/world.json from Natural Earth 1:110m countries (public domain), run by hand:
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
//   node scripts/world-map.mjs ne_110m_admin_0_countries.geojson
// Equirectangular, 2 units per degree, Antarctica left out: 720 x 284.
import { readFileSync, writeFileSync } from 'node:fs';

const SCALE = 2;
const TOP = 84;
const BOTTOM = -58;
const r = (n) => Math.round(n * 10) / 10;
const ring = (points) =>
  `M${points.map(([lon, lat]) => `${r((lon + 180) * SCALE)},${r((TOP - Math.max(BOTTOM, lat)) * SCALE)}`).join('L')}Z`;

const geo = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const countries = geo.features
  .filter((f) => f.properties.ISO_A2_EH !== 'AQ')
  .map((f) => {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const code = f.properties.ISO_A2_EH;
    return { code: code === '-99' ? null : code, d: polygons.flatMap((rings) => rings.map(ring)).join('') };
  });
writeFileSync(
  new URL('../web/world.json', import.meta.url),
  JSON.stringify({ width: 360 * SCALE, height: (TOP - BOTTOM) * SCALE, countries }),
);
