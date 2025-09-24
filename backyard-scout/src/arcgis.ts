import fetch from 'node-fetch';

function normalizeServiceUrl(u: string) {
  // Some hosts are case-sensitive; prefer /ArcGIS/rest
  return u.replace(/\/arcgis\/rest/i, '/ArcGIS/rest');
}

function toParams(o: Record<string, any>) {
  return new URLSearchParams(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])));
}

function esriJsonToGeoJSON(js: any) {
  // minimal converter for FeatureSet (f=json) → GeoJSON FeatureCollection
  if (!js || !Array.isArray(js.features)) return null;
  const fc = { type: 'FeatureCollection', features: [] as any[] };
  for (const f of js.features) {
    const g = f.geometry;
    let geom: any = null;
    if (g?.rings) {
      geom = { type: 'Polygon', coordinates: g.rings };
    } else if (g?.paths) {
      geom = { type: 'MultiLineString', coordinates: g.paths };
    } else if (typeof g?.x === 'number' && typeof g?.y === 'number') {
      geom = { type: 'Point', coordinates: [g.x, g.y] };
    } else {
      continue;
    }
    fc.features.push({ type: 'Feature', properties: f.attributes || {}, geometry: geom });
  }
  return fc;
}

export async function queryFeatureLayer(url: string, params: Record<string, any>) {
  const base = normalizeServiceUrl(url) + '/query';
  // Try geojson first, else fall back to json→convert
  const common = {
    where: '1=1',
    outFields: '*',
    outSR: 4326,
    returnGeometry: true,
    ...params,
  };

  // 1) f=geojson attempt (if supported)
  {
    const body = toParams({ f: 'geojson', ...common });
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (r.ok) {
      const js = await r.json().catch(() => null);
      if (js && Array.isArray((js as any).features)) return js; // already GeoJSON
    } else {
      const _txt = await r.text().catch(() => '');
      // fall through to JSON path; keep diagnostics in case both fail
      // console.warn(`geojson POST failed ${r.status}: ${base}\n${txt.slice(0,200)}`);
    }
  }

  // 2) f=json then convert
  {
    const body = toParams({ f: 'json', ...common });
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`ArcGIS POST failed ${r.status} ${base}\n${txt.slice(0, 300)}`);
    }
    const js = await r.json().catch(() => null);
    if (!js) throw new Error(`ArcGIS returned invalid JSON for ${base}`);

    // Check for error response
    if ((js as any).error) {
      throw new Error(`ArcGIS error for ${base}: ${JSON.stringify((js as any).error)}`);
    }

    const fc = esriJsonToGeoJSON(js);
    if (!fc)
      throw new Error(
        `ArcGIS returned non-feature set for ${base}\nResponse: ${JSON.stringify(js).slice(0, 300)}`,
      );
    return fc;
  }
}

export async function exportImage(
  url: string,
  bbox: [number, number, number, number],
  size = [600, 600],
) {
  const base = normalizeServiceUrl(url) + '/exportImage';
  const p = toParams({
    bbox: bbox.join(','),
    bboxSR: 4326,
    size: `${size[0]},${size[1]}`,
    format: 'jpg',
    f: 'image',
  });
  return `${base}?${p.toString()}`;
}
