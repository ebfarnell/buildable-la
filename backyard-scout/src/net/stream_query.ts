import { fetch } from 'undici';

type QueryOpts = {
  url: string;
  where?: string;
  outFields?: string[];
  geometry?: any;
  geometryType?: string;
  spatialRel?: string;
  token?: string | null;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
};

function body(params: Record<string, any>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v != null) s.set(k, Array.isArray(v) ? v.join(',') : String(v));
  return s.toString();
}

export async function* streamFeatureServer(opts: QueryOpts) {
  const {
    url,
    where = '1=1',
    outFields = ['*'],
    geometry,
    geometryType = 'esriGeometryPolygon',
    spatialRel = 'esriSpatialRelIntersects',
    token = process.env.ARCGIS_TOKEN ?? null,
    pageSize = 1000,
    maxPages = 1000,
    timeoutMs = 15000,
  } = opts;

  const base = url.replace(/\/+$/, '') + '/query';
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const req = body({
      f: 'json',
      where,
      outFields: outFields.join(','),
      resultRecordCount: pageSize,
      resultOffset: offset,
      returnGeometry: true,
      spatialRel,
      ...(geometry ? { geometry: JSON.stringify(geometry), geometryType, inSR: 4326 } : {}),
    });
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: token ? req + `&token=${encodeURIComponent(token)}` : req,
      // @ts-ignore undici timeout signature
      timeout: timeoutMs,
    });
    const json: any = await res.json();
    if (json.error) {
      const code = Number(json.error.code);
      if ([498, 499, 500, 502, 503, 504].includes(code)) {
        await new Promise((r) => setTimeout(r, 400 * (page + 1)));
        continue;
      }
      throw new Error(`ArcGIS ${code}: ${json.error.message}`);
    }
    const feats = json.features ?? [];
    if (!feats.length) break;
    for (const f of feats) yield f;
    offset += feats.length;
    if (feats.length < pageSize) break;
  }
}
