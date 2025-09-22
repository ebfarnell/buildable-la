import { fetch } from 'undici';

export async function searchOSM(name: string, cityHint?: string) {
  const q = encodeURIComponent([name, cityHint].filter(Boolean).join(', '));
  const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&q=${q}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'backyard-scout/1.0' },
    timeout: 10_000 as any,
  });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) return null;
  // Prefer place_rank / class=boundary / type=administrative or neighbourhood/suburb
  const sorted = arr.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  const hit =
    sorted.find(
      (r: any) =>
        (r.class === 'boundary' && r.type) ||
        r.type === 'neighbourhood' ||
        r.type === 'suburb' ||
        r.type === 'administrative',
    ) ?? sorted[0];
  if (!hit?.geojson) return null;
  const gj = hit.geojson; // GeoJSON geometry
  const feature = {
    type: 'Feature',
    properties: { source: 'osm', display_name: hit.display_name },
    geometry: gj,
  };
  return { feature, url, display_name: hit.display_name };
}
