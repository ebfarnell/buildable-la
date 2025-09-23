import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

export type RectSuggestion = {
  wFt: number;
  hFt: number;
  areaSqft: number;
  center: [number, number];
  polygon: Feature<Polygon>;
};

function feetToMeters(ft: number) {
  return ft * 0.3048;
}

/**
 * Suggests axis‑aligned rectangles that fit entirely inside a buildable polygon.
 * We test a small set of useful ADU pads (in feet), scan the polygon bbox with a grid,
 * and return the best placements (by area) for each size.
 */
export function suggestRectPads(
  buildable: Feature<Polygon | MultiPolygon>,
  candidatesFt: Array<[number, number]> = [
    [22, 35],
    [24, 34],
    [20, 40],
    [20, 30],
    [16, 50],
  ],
  gridStepFt = 3,
): RectSuggestion[] {
  const bbox = turf.bbox(buildable);
  const stepM = feetToMeters(gridStepFt);
  const xMin = bbox[0],
    yMin = bbox[1],
    xMax = bbox[2],
    yMax = bbox[3];
  const results: RectSuggestion[] = [];

  for (const [wFt, hFt] of candidatesFt) {
    const wM = feetToMeters(wFt);
    const hM = feetToMeters(hFt);

    let best: RectSuggestion | null = null;

    // Scan the bbox in a grid; place rect centered at each grid point.
    for (let x = xMin; x <= xMax; x += stepM / 111320 /*deg approx*/) {
      for (let y = yMin; y <= yMax; y += stepM / 111320) {
        const rect = rectangleFromCenterMeters([x, y], wM, hM);
        if (!rect) continue;
        // Check containment
        if (turf.booleanWithin(rect, buildable)) {
          const areaSqft = turf.area(rect) * 10.7639;
          if (!best || areaSqft > best.areaSqft) {
            best = { wFt, hFt, areaSqft, center: [x, y], polygon: rect };
          }
        }
      }
    }

    if (best) results.push(best);
  }

  // Sort by area desc
  results.sort((a, b) => b.areaSqft - a.areaSqft);
  return results;
}

/** Create an axis‑aligned rectangle polygon (WGS84) centered at lon/lat with width/height in meters. */
function rectangleFromCenterMeters(center: [number, number], wM: number, hM: number) {
  const [lon, lat] = center;
  const dLon = wM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  const dLat = hM / 2 / 110540;
  const poly = turf.polygon([
    [
      [lon - dLon, lat - dLat],
      [lon + dLon, lat - dLat],
      [lon + dLon, lat + dLat],
      [lon - dLon, lat + dLat],
      [lon - dLon, lat - dLat],
    ],
  ]);
  return poly;
}
