import fs from 'node:fs';
import path from 'node:path';
import slugify from 'slugify';
import * as turf from '@turf/turf';
import { searchOSM } from './sources/osm.js';
import { searchArcGISBoundary } from './sources/arcgis_catalog.js';
import { searchWikiPolygon } from './sources/wiki.js';
import type { ResolvedArea } from './types.js';

function slug(n: string) {
  return slugify(n, { lower: true, strict: true });
}
function boundaryPath(s: string) {
  return path.resolve('data/boundaries', `${s}.geojson`);
}

export function tryLoadLocal(name: string): ResolvedArea | null {
  const s = slug(name);
  const p = boundaryPath(s);
  if (fs.existsSync(p)) {
    const gj = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { name, slug: s, source: 'local', retrieved_at: new Date().toISOString(), geojson: gj };
  }
  // also check config/neighborhoods
  const cfg = path.resolve('config/neighborhoods', `${s}.geojson`);
  if (fs.existsSync(cfg)) {
    const gj = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(gj));
    return { name, slug: s, source: 'local', retrieved_at: new Date().toISOString(), geojson: gj };
  }
  return null;
}

export async function resolveBoundary(
  name: string,
  cityHint?: string,
): Promise<ResolvedArea | null> {
  const cached = tryLoadLocal(name);
  if (cached) return cached;

  // OSM first
  try {
    const r = await searchOSM(name, cityHint);
    if (r?.feature) {
      const s = slug(`${name}-${cityHint ?? ''}`);
      const p = boundaryPath(s);
      const fc = turf.featureCollection([r.feature]);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(fc));
      return {
        name: `${name}${cityHint ? `, ${cityHint}` : ''}`,
        slug: s,
        source: 'osm',
        url: r.url,
        retrieved_at: new Date().toISOString(),
        geojson: fc,
      };
    }
  } catch {}

  // ArcGIS known hubs (extend later)
  try {
    const g = await searchArcGISBoundary(name, cityHint);
    if (g) return g;
  } catch {}

  // Wiki fallback (optional)
  try {
    const g = await searchWikiPolygon(name, cityHint);
    if (g) return g;
  } catch {}

  return null;
}
