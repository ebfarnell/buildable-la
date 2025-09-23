import fs from 'node:fs';
import path from 'node:path';
import slugify from 'slugify';
import * as turf from '@turf/turf';
import { streamFeatureServer } from '../net/stream_query.js';
import { resolveBoundary } from '../area/resolve_boundary.js';
import { resolveCollege, bufferMiles } from '../area/poi.js';
import { getLayerBlock } from '../services/layers_router.js';

export type Ctx = Record<string, any>;

export async function resolve_area(ctx: Ctx, { name, city }: { name: string; city?: string }) {
  const r = await resolveBoundary(name, city);
  if (!r) throw new Error('Area not found: ' + name);
  const slug = slugify(r.slug || `${name}-${city || ''}`, { lower: true, strict: true });
  ctx.area_polygon = r.geojson.features?.[0] ?? r.geojson;
  ctx.area_slug = slug;
  ctx.task_slug = ctx.task_slug ?? slug;
  return ctx;
}

export async function resolve_zip(ctx: Ctx, { zip }: { zip: string }) {
  // Quick zip polygon via OSM boundary (or your local zip index if you have one)
  const r = await resolveBoundary(zip, undefined);
  if (!r) throw new Error('ZIP boundary not found: ' + zip);
  ctx.zip_polygon = r.geojson.features?.[0] ?? r.geojson;
  ctx.task_slug = ctx.task_slug ?? `zip-${zip}`;
  return ctx;
}

export async function resolve_poi(
  ctx: Ctx,
  { _kind, name, city }: { kind: 'college' | 'university'; name: string; city?: string },
) {
  const poi = await resolveCollege(name, city);
  if (!poi) throw new Error('POI not found: ' + name);
  ctx.poi = poi;
  ctx.poi_name = poi.name;
  ctx.task_slug = ctx.task_slug ?? slugify(`${name}-${city || ''}`, { lower: true, strict: true });
  return ctx;
}

export async function buffer_poi(ctx: Ctx, { miles }: { miles: number | string }) {
  if (!ctx.poi) throw new Error('POI missing');
  const ring = bufferMiles(ctx.poi.lon, ctx.poi.lat, Number(miles));
  ctx.buffer = ring;
  return ctx;
}

export async function extract_stream(
  ctx: Ctx,
  {
    county,
    _layer,
    geometry,
    fields,
  }: { county: 'los_angeles' | 'ventura' | 'auto'; layer: string; geometry: any; fields: string[] },
) {
  // Handle string references to context properties
  let geom = geometry;
  if (typeof geometry === 'string') {
    // Strip ${} wrapper if present
    const key = geometry.replace(/^\$\{|\}$/g, '');
    geom = ctx[key];
  }
  if (!geom) throw new Error('Geometry missing for extract_stream: ' + geometry);

  let k = county;
  if (k === 'auto') {
    // basic centroid router using services/county.ts (optional enhancement)
    k = 'ventura'; // heuristic when Thousand Oaks; swap with your router if desired
  }
  // expect parcels FeatureServer URL in layers.json under chosen county
  const block = getLayerBlock(k as any) as any;
  const url = block?.parcels?.url;
  if (!url) throw new Error(`Parcels layer URL missing for county ${k}`);

  const slug = ctx.task_slug || 'selection';
  const outPath = `data/parcels_${slug}.jsonl`;
  fs.mkdirSync('data', { recursive: true });
  const out = fs.createWriteStream(outPath, { flags: 'w' });

  let n = 0;
  // Extract the geometry properly
  const esriGeom =
    geom.type === 'Feature'
      ? geom.geometry
      : geom.type === 'FeatureCollection'
        ? geom.features[0].geometry
        : (geom.geometry ?? geom);

  for await (const f of streamFeatureServer({
    url,
    outFields: fields,
    geometry: esriGeom,
    geometryType: 'esriGeometryPolygon',
  })) {
    out.write(JSON.stringify({ attributes: f.attributes, geometry: f.geometry }) + '\n');
    if (++n % 200 === 0) console.log(`parcels… ${n}`);
  }
  out.end();
  console.log(`extracted ${n} → ${outPath}`);
  ctx.parcels_jsonl = outPath;
  return ctx;
}

// Minimal shortlist (fast). For full accuracy, follow with batch_analyze.
export async function shortlist(
  ctx: Ctx,
  { limit, min_buildable_sqft = 770 }: { limit: number | string; min_buildable_sqft?: number },
) {
  const filepath = ctx.parcels_jsonl;
  const lines = fs.readFileSync(filepath, 'utf8').trim().split('\n').filter(Boolean);
  const toSqft = (m2: number) => m2 * 10.7639;
  const keep: any[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const lot = toSqft(turf.area({ type: 'Feature', geometry: row.geometry, properties: {} }));
      const env = turf.buffer({ type: 'Feature', geometry: row.geometry, properties: {} }, -4, {
        units: 'feet',
      });
      const buildable = env ? Math.max(0, toSqft(turf.area(env))) : 0;
      if (buildable >= min_buildable_sqft) {
        keep.push({
          apn: row.attributes?.APN ?? null,
          address: row.attributes?.SITUS_ADDR ?? null,
          zip: row.attributes?.ZIP ?? row.attributes?.SitusZIP ?? null,
          lot_sqft: Math.round(lot),
          buildable_sqft: Math.round(buildable),
          rental_score: +(buildable / 1000).toFixed(1),
        });
      }
    } catch {
      // Skip if fetching property data fails
    }
  }
  keep.sort((a, b) => b.rental_score - a.rental_score);
  ctx.shortlist = keep.slice(0, Number(limit));
  return ctx;
}

export async function export_csv(ctx: Ctx, { path: filepath }: { path: string }) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const rows = ctx.shortlist ?? [];
  const header = 'apn,zip,address,lot_sqft,buildable_sqft,rental_score';
  const body = rows
    .map((r: any) =>
      [
        r.apn,
        r.zip,
        JSON.stringify(r.address ?? ''),
        r.lot_sqft,
        r.buildable_sqft,
        r.rental_score,
      ].join(','),
    )
    .join('\n');
  fs.writeFileSync(filepath, [header, body].join('\n'));
  ctx.export_path = filepath;
  console.log(`wrote ${rows.length} → ${filepath}`);
  return ctx;
}

// Optional: wire your existing rigorous batch
export async function batch_analyze(
  ctx: Ctx,
  { _jsonl, _limit }: { jsonl: string; limit?: number | string },
) {
  // You can invoke your existing src/batch_all.ts here, or keep this as a no-op placeholder.
  return ctx;
}
