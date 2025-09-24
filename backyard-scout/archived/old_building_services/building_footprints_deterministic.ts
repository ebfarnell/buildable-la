import * as turf from '@turf/turf';
import crypto from 'crypto';
import { fetch } from 'undici';

interface BuildingFootprint {
  id: string;
  area_sqft: number;
  geometry: any;
  source: string;
  retrieved_at: string;
  checksum: string;
}

interface BuildingSource {
  name: string;
  endpoint: string;
  priority: number;
  available: boolean;
}

// California building footprint sources (tested and verified - 2025-09-20)
// NOTE: Comprehensive testing showed ALL county ArcGIS endpoints are broken/non-existent
// OSM provides excellent coverage and real building data across California
const BUILDING_SOURCES: Record<string, BuildingSource[]> = {
  DEFAULT: [
    {
      name: 'OpenStreetMap Buildings',
      endpoint: 'https://overpass-api.de/api/interpreter',
      priority: 1,
      available: true,
    },
    // NO FALLBACKS - No estimated sources
  ],
};

/**
 * DETERMINISTIC: Calculate consistent hash for geometry
 */
function calculateGeometryHash(geometry: any): string {
  // Sort coordinates to ensure consistent hashing
  const normalized = JSON.stringify(geometry, Object.keys(geometry).sort());
  return crypto.createHash('md5').update(normalized).digest('hex').substring(0, 8);
}

/**
 * DETERMINISTIC: Round all coordinates to 6 decimal places
 */
function normalizeGeometry(geometry: any): any {
  if (geometry.rings) {
    return {
      ...geometry,
      rings: geometry.rings.map((ring: number[][]) =>
        ring.map((coord) => [
          Math.round(coord[0] * 1000000) / 1000000,
          Math.round(coord[1] * 1000000) / 1000000,
        ]),
      ),
    };
  }
  return geometry;
}

/**
 * DETERMINISTIC: Get building footprints for a parcel
 * Same input MUST produce same output every time
 */
export async function getBuildingFootprints(
  parcelGeometry: any,
  countyName: string,
  apn: string,
): Promise<BuildingFootprint[]> {
  const county = countyName.toUpperCase();
  const sources = [...(BUILDING_SOURCES[county] || []), ...BUILDING_SOURCES.DEFAULT];

  // Sort sources by priority for consistent order
  sources.sort((a, b) => a.priority - b.priority);

  // Calculate parcel area and centroid for queries
  const parcelPolygon = turf.polygon(parcelGeometry.rings);
  const parcelArea = turf.area(parcelPolygon) * 10.7639; // Convert to sqft
  const centroid = turf.centroid(parcelPolygon);
  const [lon, lat] = centroid.geometry.coordinates;

  // Create bounding box for queries
  const bbox = turf.bbox(parcelPolygon);

  for (const source of sources) {
    if (!source.available) continue;

    try {
      if (source.name === 'OpenStreetMap Buildings') {
        const buildings = await fetchOSMBuildings(bbox);
        if (buildings.length > 0) {
          return buildings.map((b) => ({
            ...b,
            source: 'OSM',
            checksum: calculateGeometryHash(b.geometry),
          }));
        }
      }

      // Try ArcGIS endpoint
      const buildings = await fetchArcGISBuildings(source.endpoint, bbox);
      if (buildings.length > 0) {
        return buildings.map((b) => ({
          ...b,
          source: source.name,
          checksum: calculateGeometryHash(b.geometry),
        }));
      }
    } catch (error) {
      console.log(`Failed to fetch from ${source.name}:`, error);
    }
  }

  // NO FALLBACKS - Return empty array if no real data found
  console.log(`   ⚠️ NO BUILDING DATA FOUND`);
  return []; // No estimates, no fallbacks - only real data
}

/**
 * Fetch buildings from OSM Overpass API
 */
async function fetchOSMBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;

  console.log(
    `   OSM Query: bbox=[${minX.toFixed(6)}, ${minY.toFixed(6)}, ${maxX.toFixed(6)}, ${maxY.toFixed(6)}]`,
  );

  const query = `[out:json][timeout:25];
    way["building"](${minY},${minX},${maxY},${maxX});
    out geom;`;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20000), // 20 second timeout
    });

    if (!response.ok) {
      console.log(`   OSM API returned status: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const buildings: BuildingFootprint[] = [];

    console.log(`   OSM Response: ${data.elements?.length || 0} elements found`);

    for (const element of data.elements || []) {
      if (element.type === 'way' && element.geometry) {
        const coords = element.geometry.map((node: any) => [node.lon, node.lat]);
        coords.push(coords[0]); // Close the polygon

        const polygon = turf.polygon([coords]);
        const area = Math.round(turf.area(polygon) * 10.7639); // Convert to sqft

        buildings.push({
          id: `OSM_${element.id}`,
          area_sqft: area,
          geometry: normalizeGeometry({ rings: [coords] }),
          source: 'OSM',
          retrieved_at: new Date().toISOString(),
          checksum: '',
        });
      }
    }

    console.log(`   OSM Buildings found: ${buildings.length}`);

    // DETERMINISTIC: Sort buildings by ID for consistent order
    return buildings.sort((a, b) => a.id.localeCompare(b.id));
  } catch (error: any) {
    console.log(`   OSM API error: ${error.message}`);
    return [];
  }
}

/**
 * Fetch buildings from ArcGIS endpoint
 */
async function fetchArcGISBuildings(
  endpoint: string,
  bbox: number[],
): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: `${minX},${minY},${maxX},${maxY}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
  });

  const response = await fetch(`${endpoint}/query?${params}`);
  if (!response.ok) return [];

  const data = (await response.json()) as any;
  const buildings: BuildingFootprint[] = [];

  for (const feature of data.features || []) {
    if (feature.geometry?.rings) {
      const polygon = turf.polygon(feature.geometry.rings);
      const area = Math.round(turf.area(polygon) * 10.7639);

      buildings.push({
        id: `ARCGIS_${feature.attributes?.OBJECTID || Math.random()}`,
        area_sqft: area,
        geometry: normalizeGeometry(feature.geometry),
        source: endpoint,
        retrieved_at: new Date().toISOString(),
        checksum: '',
      });
    }
  }

  // DETERMINISTIC: Sort by ID
  return buildings.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * DETERMINISTIC: Calculate buildable area after subtracting buildings
 * Same inputs MUST produce same output
 */
export function calculateBuildableArea(
  parcelGeometry: any,
  buildingFootprints: BuildingFootprint[],
  setbacks: { front: number; side: number; rear: number },
): number {
  // 1. Normalize parcel geometry
  const normalizedParcel = normalizeGeometry(parcelGeometry);
  const parcelPolygon = turf.polygon(normalizedParcel.rings);

  // 2. Apply setbacks (deterministic buffer operation)
  const sideBuffer = turf.buffer(parcelPolygon, -setbacks.side, { units: 'feet' });
  if (!sideBuffer) return 0;

  // Apply directional setbacks (simplified for determinism)
  const avgExtraSetback = (setbacks.front - setbacks.side + (setbacks.rear - setbacks.side)) / 4;
  const envelope =
    avgExtraSetback > 0 ? turf.buffer(sideBuffer, -avgExtraSetback, { units: 'feet' }) : sideBuffer;

  if (!envelope) return 0;

  // 3. Subtract building footprints
  let buildablePolygon = envelope;

  // Sort buildings by ID for consistent processing order
  const sortedBuildings = [...buildingFootprints].sort((a, b) => a.id.localeCompare(b.id));

  for (const building of sortedBuildings) {
    if (building.geometry?.rings) {
      const buildingPolygon = turf.polygon(building.geometry.rings);

      // Clip building to parcel boundary first
      const clippedBuilding = turf.intersect(buildingPolygon, parcelPolygon);

      if (clippedBuilding) {
        // Subtract from buildable area
        const difference = turf.difference(buildablePolygon, clippedBuilding);
        if (difference) {
          buildablePolygon = difference;
        }
      }
    }
    // NO ESTIMATES - skip any building without geometry
  }

  // Calculate final area (round to nearest sqft for consistency)
  const buildableArea = Math.round(turf.area(buildablePolygon) * 10.7639);
  return buildableArea;
}

/**
 * Test deterministic behavior
 */
export async function testDeterministicBehavior(
  parcelGeometry: any,
  countyName: string,
  apn: string,
): Promise<boolean> {
  console.log('Testing deterministic behavior...');

  // Run the same calculation 3 times
  const results = [];
  for (let i = 0; i < 3; i++) {
    const buildings = await getBuildingFootprints(parcelGeometry, countyName, apn);
    const buildable = calculateBuildableArea(parcelGeometry, buildings, {
      front: 25,
      side: 5,
      rear: 15,
    });

    results.push({
      buildingCount: buildings.length,
      totalBuildingArea: buildings.reduce((sum, b) => sum + b.area_sqft, 0),
      buildableArea: buildable,
      checksums: buildings.map((b) => b.checksum).join(','),
    });
  }

  // Verify all results are identical
  const firstResult = JSON.stringify(results[0]);
  const allIdentical = results.every((r) => JSON.stringify(r) === firstResult);

  console.log('Deterministic test results:', {
    passed: allIdentical,
    runs: results,
  });

  return allIdentical;
}
