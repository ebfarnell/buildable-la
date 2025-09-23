import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';

export function toSqft(areaM2: number) {
  return areaM2 * 10.7639;
}

export function inwardSetbackEnvelope(
  parcel: Feature<Polygon | MultiPolygon>,
  { frontFt, sideFt, rearFt }: { frontFt: number; sideFt: number; rearFt: number },
) {
  // Without surveyed frontage, approximate: use min(front, rear) = frontFt; sides = sideFt; rear = rearFt
  // Practical simplification: shrink uniformly by the max(sideFt, rearFt, frontFt).
  const feet = Math.max(frontFt, sideFt, rearFt);
  const meters = feet * 0.3048;
  // Negative buffer (shrink)
  const envelope = turf.buffer(parcel, -meters, { units: 'meters' });
  return envelope;
}

export function subtractFootprints(
  envelope: Feature<any>,
  footprints: FeatureCollection<Polygon | MultiPolygon>,
) {
  let result = envelope as any;
  for (const f of footprints.features) {
    try {
      const diff = turf.difference(turf.featureCollection([result, f]));
      if (diff) result = diff;
    } catch (_e) {
      // Skip if difference operation fails
      continue;
    }
  }
  return result;
}

/**
 * Suggests up to 3 rectangles (e.g., 22×35 ft) that fit in the buildable polygon.
 * Simplified: just return standard ADU-size templates if polygon area is large enough.
 */
export function suggestRectangles(buildable: Feature<any>) {
  const areaSqft = toSqft(turf.area(buildable));
  const suggestions = [] as { wFt: number; hFt: number; areaSqft: number }[];
  const candidates = [
    [22, 35],
    [24, 34],
    [20, 40],
  ];
  for (const [w, h] of candidates) {
    if (w * h <= areaSqft) {
      suggestions.push({ wFt: w, hFt: h, areaSqft: w * h });
    }
  }
  return suggestions;
}
