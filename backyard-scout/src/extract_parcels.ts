import fs from 'node:fs';
import * as _turf from '@turf/turf';
import { streamFeatureServer } from './net/stream_query.js';
import { _routeCountyByPoint } from './services/county.js';
import { getLayerBlock } from './services/layers_router.js';
import slugify from 'slugify';

// Expected args: either a ZIP code, or a boundary file path (GeoJSON), or a name we resolved earlier
// Usage examples:
//   tsx src/extract_parcels.ts 91361
//   tsx src/extract_parcels.ts --boundary data/boundaries/thousand-oaks.geojson
// Optional: --county ventura | los_angeles

const argv = process.argv.slice(2);
const boundaryIdx = argv.indexOf('--boundary');
const boundaryPath = boundaryIdx >= 0 ? argv[boundaryIdx + 1] : null;
const countyIdx = argv.indexOf('--county');
const countyForce = countyIdx >= 0 ? argv[countyIdx + 1] || 'los_angeles' : null;
const target =
  argv.find((a) => /^\d{5}$/.test(a)) ||
  (boundaryPath ? boundaryPath.split('/').pop()?.replace(/\..+$/, '') : 'selection');
const slug = slugify(String(target), { lower: true, strict: true });

const outPath = `data/parcels_${slug}.jsonl`;
fs.mkdirSync('data', { recursive: true });
const out = fs.createWriteStream(outPath, { flags: 'w' });

function toEsriPolygon(g: any) {
  return g;
} // if you store WGS84 coords, parcel boundaries as-is work for geometry intersects

async function main() {
  let boundary: any = null;
  if (boundaryPath && fs.existsSync(boundaryPath)) {
    boundary = JSON.parse(fs.readFileSync(boundaryPath, 'utf8'));
  }

  // Decide county & layer block
  let countyKey: 'los_angeles' | 'ventura' = 'los_angeles';
  if (countyForce === 'ventura' || countyForce === 'los_angeles') countyKey = countyForce as any;

  const block = getLayerBlock(countyKey);
  const parcelsUrl = block?.parcels?.url; // if present
  if (!parcelsUrl) {
    console.error(
      'No parcels FeatureServer URL configured for',
      countyKey,
      '— set layers.json (ventura.parcels.url).',
    );
    process.exit(2);
  }

  let geom = null;
  if (boundary?.type) {
    const gj = boundary.type === 'FeatureCollection' ? boundary.features[0] : boundary;
    geom = toEsriPolygon(gj.geometry);
  }

  // If ZIP code provided, use WHERE clause
  const zipCode = argv.find((a) => /^\d{5}$/.test(a));
  const where = zipCode ? `SitusZIP LIKE '${zipCode}%'` : '1=1';

  let n = 0;
  for await (const f of streamFeatureServer({
    url: parcelsUrl,
    where,
    outFields: ['APN', 'SitusAddr', 'SitusZIP', '*'],
    geometry: geom ?? undefined,
    geometryType: 'esriGeometryPolygon',
  })) {
    out.write(
      JSON.stringify({
        apn: f.attributes.APN ?? null,
        address: f.attributes.SitusAddr ?? null,
        zip: f.attributes.SitusZIP ?? null,
        parcel_esri: f.geometry,
        _src: { layer: parcelsUrl, fetched_at: new Date().toISOString() },
      }) + '\n',
    );
    n++;
    if (n % 200 === 0) console.log(`parcels… ${n}`);
  }
  out.end();
  console.log(`Wrote ${n} parcels → ${outPath}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
