/**
 * Enhanced Building Footprints Service
 * Tries multiple data sources before falling back to estimates
 * Priority: County-specific → Microsoft → OSM → Estimate (last resort)
 */

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
  queryBuilder?: (bbox: number[], lat: number, lon: number) => string;
}

// County-specific building footprint endpoints (verified from documentation)
const COUNTY_ENDPOINTS: Record<string, BuildingSource> = {
  'LOS ANGELES': {
    name: 'LA County Buildings',
    endpoint:
      'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Buildings/MapServer/0',
    priority: 1,
    available: true,
  },
  'SAN DIEGO': {
    name: 'San Diego Buildings',
    endpoint: 'https://sdgis.sandag.org/arcgis/rest/services/Buildings/MapServer/0',
    priority: 1,
    available: true,
  },
  ORANGE: {
    name: 'Orange County Buildings',
    endpoint:
      'https://services1.arcgis.com/vY6WuhLW0HkFe6Fl/ArcGIS/rest/services/Building_Footprints/FeatureServer/0',
    priority: 1,
    available: true,
  },
  'SAN FRANCISCO': {
    name: 'SF Buildings',
    endpoint: 'https://sfplanninggis.org/arcgis/rest/services/BuildingFootprints/MapServer/0',
    priority: 1,
    available: true,
  },
  SACRAMENTO: {
    name: 'Sacramento Buildings',
    endpoint:
      'https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    priority: 1,
    available: true,
  },
  ALAMEDA: {
    name: 'Alameda Buildings',
    endpoint:
      'https://gismaps.oaklandca.gov/oaklandgis/rest/services/BuildingFootprints/MapServer/0',
    priority: 1,
    available: true,
  },
  'SANTA CLARA': {
    name: 'Santa Clara Buildings',
    endpoint: 'https://gis.sccgov.org/arcgis/rest/services/BuildingFootprints/MapServer/0',
    priority: 1,
    available: true,
  },
  RIVERSIDE: {
    name: 'Riverside Buildings',
    endpoint: 'https://gis.rivcoca.org/arcgis/rest/services/BuildingFootprints/FeatureServer/0',
    priority: 1,
    available: true,
  },
  VENTURA: {
    name: 'Ventura Buildings',
    endpoint: 'https://maps.ventura.org/arcgis/rest/services/Buildings/MapServer/0',
    priority: 1,
    available: true,
  },
  'CONTRA COSTA': {
    name: 'Contra Costa Buildings',
    endpoint: 'https://gis.cccounty.us/arcgis/rest/services/BuildingFootprints/MapServer/0',
    priority: 1,
    available: true,
  },
  'SAN MATEO': {
    name: 'San Mateo Buildings',
    endpoint:
      'https://services3.arcgis.com/WznFNxVBdIyJbqto/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    priority: 1,
    available: true,
  },
  MARIN: {
    name: 'Marin Buildings',
    endpoint: 'https://gis.marinpublic.com/arcgis/rest/services/BuildingFootprints/MapServer/0',
    priority: 1,
    available: true,
  },
  KERN: {
    name: 'Kern Buildings',
    endpoint: 'https://maps.kerncounty.com/arcgis/rest/services/BuildingFootprints/MapServer/0',
    priority: 1,
    available: true,
  },
  'SANTA BARBARA': {
    name: 'Santa Barbara Buildings',
    endpoint: 'https://cosb.countyofsb.org/arcgis/rest/services/BuildingFootprints/MapServer/0',
    priority: 1,
    available: true,
  },
};

// Statewide and fallback sources
const STATEWIDE_SOURCES: BuildingSource[] = [
  {
    name: 'Microsoft Building Footprints',
    endpoint:
      'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0',
    priority: 2,
    available: true,
  },
  {
    name: 'OpenStreetMap Buildings',
    endpoint: 'https://overpass-api.de/api/interpreter',
    priority: 3,
    available: true,
  },
];

/**
 * Round coordinates to 6 decimal places for consistency
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
 * Main function to get building footprints
 * Tries all available sources before falling back to estimates
 */
export async function getBuildingFootprints(
  parcelGeometry: any,
  countyName: string,
  apn: string,
): Promise<BuildingFootprint[]> {
  const county = countyName.toUpperCase();

  // Calculate parcel info for queries
  const parcelPolygon = turf.polygon(parcelGeometry.rings);
  const parcelArea = turf.area(parcelPolygon) * 10.7639; // Convert to sqft
  const centroid = turf.centroid(parcelPolygon);
  const [lon, lat] = centroid.geometry.coordinates;

  // Expand bbox by ~50 feet to catch nearby buildings that might be slightly misaligned
  const bufferedParcel = turf.buffer(parcelPolygon, 50, { units: 'feet' });
  const bbox = bufferedParcel ? turf.bbox(bufferedParcel) : turf.bbox(parcelPolygon);

  console.log(`\n🔍 Searching for building footprints...`);
  console.log(`   County: ${county}`);
  console.log(`   Location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);

  // Build sources list with county-specific first
  const sources: BuildingSource[] = [];

  // Add county-specific endpoint if available
  if (COUNTY_ENDPOINTS[county]) {
    sources.push(COUNTY_ENDPOINTS[county]);
    console.log(`   ✓ County-specific endpoint available: ${COUNTY_ENDPOINTS[county].name}`);
  } else {
    console.log(`   ℹ No county-specific endpoint for ${county}`);
  }

  // Add statewide sources
  sources.push(...STATEWIDE_SOURCES);

  // Sort by priority
  sources.sort((a, b) => a.priority - b.priority);

  // For residential properties, start with a baseline estimate
  let baselineEstimate: BuildingFootprint | null = null;
  if (parcelArea > 3000 && parcelArea < 20000) {
    const estimatedBuildingArea = Math.round(parcelArea * 0.22);
    baselineEstimate = {
      id: `EST_${apn}`,
      area_sqft: estimatedBuildingArea,
      geometry: null,
      source: 'Baseline Estimate',
      retrieved_at: new Date().toISOString(),
      checksum: '',
    };
    console.log(`   📊 Baseline estimate: ${estimatedBuildingArea.toLocaleString()} sqft`);
  }

  // Try each source to find actual building data
  let actualBuildingsFound = false;
  let bestMatchBuildings: BuildingFootprint[] = [];

  for (const source of sources) {
    if (!source.available) continue;

    console.log(`   → Trying ${source.name}...`);

    try {
      let buildings: BuildingFootprint[] = [];

      switch (source.name) {
        case 'OpenStreetMap Buildings':
          buildings = await fetchOSMBuildings(bbox);
          break;

        case 'Microsoft Building Footprints':
          buildings = await fetchMicrosoftBuildings(bbox, lat, lon);
          break;

        default:
          // All other sources are ArcGIS endpoints
          buildings = await fetchArcGISBuildings(source.endpoint, bbox, source.name);
      }

      if (buildings.length > 0) {
        console.log(`   📍 Found ${buildings.length} building(s) from ${source.name}`);

        // More lenient validation - use 20 foot buffer for coordinate misalignment
        const bufferedParcelForCheck = turf.buffer(parcelPolygon, 20, { units: 'feet' });

        const validBuildings = buildings.filter((b, idx) => {
          if (!b.geometry) return true;

          try {
            const buildingPoly = turf.polygon(b.geometry.rings);
            const buildingCentroid = turf.centroid(buildingPoly);
            const [bLon, bLat] = buildingCentroid.geometry.coordinates;

            // Calculate distance from building to parcel centroid
            const distance = turf.distance(buildingCentroid, centroid, { units: 'feet' });

            // Debug first few buildings
            if (idx < 3) {
              console.log(
                `     Building ${idx + 1}: ${Math.round(distance)} ft from parcel center`,
              );
            }

            // Very lenient: Accept any building within 100 feet of parcel center
            if (distance < 100) {
              console.log(`     ✓ Accepted building ${idx + 1} at ${Math.round(distance)} ft`);
              return true;
            }

            // Check if building intersects with buffered parcel
            if (bufferedParcelForCheck) {
              const intersection = turf.intersect(buildingPoly, bufferedParcelForCheck);
              if (intersection) {
                const intersectionArea = turf.area(intersection);
                const buildingArea = turf.area(buildingPoly);
                const overlapPercent = (intersectionArea / buildingArea) * 100;

                // Accept even 10% overlap
                if (overlapPercent > 10) {
                  console.log(
                    `     ✓ Accepted building ${idx + 1} with ${Math.round(overlapPercent)}% overlap`,
                  );
                  return true;
                }
              }
            }

            return false;
          } catch (err) {
            return false;
          }
        });

        if (validBuildings.length > 0) {
          console.log(`   ✅ Matched ${validBuildings.length} building(s) within parcel`);

          // Calculate total area to validate it's reasonable
          const totalArea = validBuildings.reduce((sum, b) => sum + b.area_sqft, 0);

          // For residential properties, limit to reasonable coverage
          // Typical residential = 20-40% coverage, but can be higher with multiple structures
          const maxReasonableArea = Math.min(parcelArea * 0.5, 3000); // Max 50% or 3000 sqft

          if (totalArea <= maxReasonableArea) {
            // Use all buildings if under threshold
            actualBuildingsFound = true;
            bestMatchBuildings = validBuildings;
            console.log(
              `   ✅ Using ${validBuildings.length} buildings totaling ${Math.round(totalArea)} sqft`,
            );
            break;
          } else {
            // Take only the closest/largest building if total is too high
            const sortedByDistance = validBuildings.sort((a, b) => {
              // Prefer buildings closer to center and larger
              const aCenter = a.geometry ? turf.centroid(turf.polygon(a.geometry.rings)) : null;
              const bCenter = b.geometry ? turf.centroid(turf.polygon(b.geometry.rings)) : null;
              if (aCenter && bCenter) {
                const aDist = turf.distance(aCenter, centroid, { units: 'feet' });
                const bDist = turf.distance(bCenter, centroid, { units: 'feet' });
                return aDist - bDist;
              }
              return b.area_sqft - a.area_sqft;
            });

            // Take the main building(s) up to reasonable area
            let cumArea = 0;
            const mainBuildings = [];
            for (const building of sortedByDistance) {
              if (cumArea + building.area_sqft <= maxReasonableArea) {
                mainBuildings.push(building);
                cumArea += building.area_sqft;
              }
            }

            if (mainBuildings.length > 0) {
              actualBuildingsFound = true;
              bestMatchBuildings = mainBuildings;
              console.log(
                `   ⚠️ Selected ${mainBuildings.length} main building(s) totaling ${Math.round(cumArea)} sqft`,
              );
              break;
            }
          }
        }
      }
    } catch (error: any) {
      console.log(`   ✗ ${source.name} error: ${error.message}`);
    }
  }

  // Return actual buildings if found, otherwise use baseline estimate
  if (actualBuildingsFound && bestMatchBuildings.length > 0) {
    console.log(`   ✅ Using actual building data`);
    return bestMatchBuildings;
  } else if (baselineEstimate) {
    console.log(`   📐 Using baseline estimate for analysis`);
    return [baselineEstimate];
  }

  // No building data found at all
  console.log(`   ⚠️ No building data available`);
  return [];
}

/**
 * Fetch buildings from Microsoft Building Footprints
 */
async function fetchMicrosoftBuildings(
  bbox: number[],
  lat: number,
  lon: number,
): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;

  const params = new URLSearchParams({
    f: 'json',
    where: "STATE='CA'",
    geometry: `${minX},${minY},${maxX},${maxY}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    maxRecordCount: '100',
  });

  const url = `https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0/query?${params}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return [];

    const data = (await response.json()) as any;
    const buildings: BuildingFootprint[] = [];

    for (const feature of data.features || []) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `MSFT_${feature.attributes?.OBJECTID || Math.random()}`,
          area_sqft: area,
          geometry: normalizeGeometry(feature.geometry),
          source: 'Microsoft Buildings',
          retrieved_at: new Date().toISOString(),
          checksum: '',
        });
      }
    }

    return buildings.sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    console.log(`   Microsoft Buildings error: ${error}`);
    return [];
  }
}

/**
 * Fetch buildings from OSM Overpass API
 */
async function fetchOSMBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;

  const query = `[out:json][timeout:25];
    way["building"](${minY},${minX},${maxY},${maxX});
    out geom;`;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as any;
    const buildings: BuildingFootprint[] = [];

    for (const element of data.elements || []) {
      if (element.type === 'way' && element.geometry) {
        const coords = element.geometry.map((node: any) => [node.lon, node.lat]);
        coords.push(coords[0]); // Close polygon

        const polygon = turf.polygon([coords]);
        const area = Math.round(turf.area(polygon) * 10.7639);

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

    return buildings.sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    console.log(`   OSM error: ${error}`);
    return [];
  }
}

/**
 * Fetch buildings from ArcGIS endpoint
 */
async function fetchArcGISBuildings(
  endpoint: string,
  bbox: number[],
  sourceName: string,
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
    maxRecordCount: '100',
  });

  const url = `${endpoint}/query?${params}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;

    if (data.error) {
      throw new Error(data.error.message || 'ArcGIS error');
    }

    const buildings: BuildingFootprint[] = [];

    for (const feature of data.features || []) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `${sourceName.replace(/\s+/g, '_')}_${feature.attributes?.OBJECTID || Math.random()}`,
          area_sqft: area,
          geometry: normalizeGeometry(feature.geometry),
          source: sourceName,
          retrieved_at: new Date().toISOString(),
          checksum: '',
        });
      }
    }

    return buildings.sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    throw error;
  }
}

/**
 * Calculate buildable area after subtracting buildings
 */
export function calculateBuildableArea(
  parcelGeometry: any,
  buildingFootprints: BuildingFootprint[],
  setbacks: { front: number; side: number; rear: number },
): number {
  const normalizedParcel = normalizeGeometry(parcelGeometry);
  const parcelPolygon = turf.polygon(normalizedParcel.rings);

  // Apply setbacks
  const sideBuffer = turf.buffer(parcelPolygon, -setbacks.side, { units: 'feet' });
  if (!sideBuffer) return 0;

  const avgExtraSetback = (setbacks.front - setbacks.side + (setbacks.rear - setbacks.side)) / 4;
  const envelope =
    avgExtraSetback > 0 ? turf.buffer(sideBuffer, -avgExtraSetback, { units: 'feet' }) : sideBuffer;

  if (!envelope) return 0;

  let buildablePolygon = envelope;
  const sortedBuildings = [...buildingFootprints].sort((a, b) => a.id.localeCompare(b.id));

  for (const building of sortedBuildings) {
    if (building.geometry?.rings) {
      const buildingPolygon = turf.polygon(building.geometry.rings);
      const clippedBuilding = turf.intersect(buildingPolygon, parcelPolygon);

      if (clippedBuilding) {
        const difference = turf.difference(buildablePolygon, clippedBuilding);
        if (difference) {
          buildablePolygon = difference;
        }
      }
    }
    // NO ESTIMATES - skip any building without geometry
  }

  const buildableArea = Math.round(turf.area(buildablePolygon) * 10.7639);
  return buildableArea;
}
