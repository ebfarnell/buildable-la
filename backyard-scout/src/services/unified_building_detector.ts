/**
 * Unified Building Detector Service
 * Consolidates all building detection methods into a single, reliable service
 *
 * Detection Strategy:
 * 1. Try county-specific building footprints (most accurate)
 * 2. Try Microsoft Building Footprints (comprehensive coverage)
 * 3. Try OpenStreetMap (good urban coverage)
 * 4. Try LA County Assessor data (for LA County only)
 * 5. Use intelligent estimation as last resort
 *
 * Key Features:
 * - Parcel boundary matching to avoid neighbor contamination
 * - Confidence scoring for each building
 * - Caching to avoid redundant API calls
 * - Detailed source tracking
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'crypto';

export interface BuildingFootprint {
  id: string;
  area_sqft: number;
  geometry: any;
  source: string;
  confidence: number; // 0-1 score
  overlap_percent?: number; // How much of building overlaps with parcel
  distance_from_center?: number; // Distance from parcel center in feet
  detection_method?: string;
}

export interface BuildingDetectionResult {
  buildings: BuildingFootprint[];
  total_area_sqft: number;
  lot_coverage_percent: number;
  detection_method: string;
  data_quality: 'high' | 'medium' | 'low' | 'estimated';
  confidence_score: number;
  sources_checked: string[];
  cache_hit: boolean;
  debug_info?: any;
}

interface ParcelInfo {
  geometry: any; // Parcel boundary rings
  area_sqft: number;
  centroid: [number, number]; // [lon, lat]
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY]
  apn?: string;
  county?: string;
  city?: string;
}

// County-specific building endpoints (high accuracy)
// NOTE: Most county endpoints are currently unavailable or have changed URLs
// Keeping structure for future updates when correct endpoints are found
const COUNTY_BUILDING_ENDPOINTS: Record<string, { name: string; url: string; available: boolean }> =
  {
    'LOS ANGELES': {
      name: 'LA County Buildings',
      url: 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Buildings/MapServer/0',
      available: false, // Service not found - needs new endpoint
    },
    ORANGE: {
      name: 'Orange County Buildings',
      url: 'https://services1.arcgis.com/vY6WuhLW0HkFe6Fl/ArcGIS/rest/services/Building_Footprints/FeatureServer/0',
      available: false, // Invalid URL error - needs correct service
    },
    'SAN DIEGO': {
      name: 'San Diego Buildings',
      url: 'https://sdgis.sandag.org/arcgis/rest/services/Buildings/MapServer/0',
      available: false, // 404 Not Found
    },
    'SAN FRANCISCO': {
      name: 'SF Buildings',
      url: 'https://sfplanninggis.org/arcgis/rest/services/BuildingFootprints/MapServer/0',
      available: false, // 404 Not Found
    },
    ALAMEDA: {
      name: 'Alameda Buildings',
      url: 'https://gismaps.oaklandca.gov/oaklandgis/rest/services/BuildingFootprints/MapServer/0',
      available: false, // Service not found, only parcels available
    },
    'SANTA CLARA': {
      name: 'Santa Clara Buildings',
      url: 'https://gis.sccgov.org/arcgis/rest/services/BuildingFootprints/MapServer/0',
      available: false, // 403 Forbidden
    },
    RIVERSIDE: {
      name: 'Riverside Buildings',
      url: 'https://gis.rivcoca.org/arcgis/rest/services/BuildingFootprints/FeatureServer/0',
      available: false, // DNS error - domain doesn't exist
    },
    VENTURA: {
      name: 'Ventura Buildings',
      url: 'https://maps.ventura.org/arcgis/rest/services/Buildings/MapServer/0',
      available: false, // Service not found
    },
  };

// Microsoft Building Footprints endpoint (statewide coverage)
// Note: Original endpoint may have issues, using MSBFP2 as alternative
const MICROSOFT_BUILDINGS_URL =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/MSBFP2/FeatureServer/0';

// Cache configuration
const CACHE_DIR = path.join(process.cwd(), 'cache', 'buildings');
const CACHE_TTL_HOURS = 24 * 7; // 1 week

/**
 * Main entry point for building detection
 */
export async function detectBuildings(
  parcelGeometry: any,
  parcelApn?: string,
  county?: string,
  options: {
    aggressiveMatching?: boolean;
    includePartial?: boolean;
    skipCache?: boolean;
  } = {},
): Promise<BuildingDetectionResult> {
  // Parse parcel information
  const parcelInfo = parseParcelInfo(parcelGeometry, parcelApn, county);

  // Check cache first (unless skipped)
  if (!options.skipCache) {
    const cached = await checkCache(parcelInfo);
    if (cached) {
      return { ...cached, cache_hit: true };
    }
  }

  const sourcesChecked: string[] = [];
  let buildings: BuildingFootprint[] = [];
  let detectionMethod = 'none';
  let dataQuality: 'high' | 'medium' | 'low' | 'estimated' = 'estimated';

  // 1. Try county-specific endpoints (highest accuracy)
  if (county) {
    const countyBuildings = await fetchCountyBuildings(parcelInfo, county);
    sourcesChecked.push(`County (${county})`);

    if (countyBuildings.length > 0) {
      buildings = matchBuildingsToParcel(countyBuildings, parcelInfo, options);
      if (buildings.length > 0) {
        detectionMethod = `County-specific (${county})`;
        dataQuality = 'high';
      }
    }
  }

  // 2. Try Microsoft Building Footprints
  if (buildings.length === 0) {
    const msftBuildings = await fetchMicrosoftBuildings(parcelInfo);
    sourcesChecked.push('Microsoft Buildings');

    if (msftBuildings.length > 0) {
      buildings = matchBuildingsToParcel(msftBuildings, parcelInfo, options);
      if (buildings.length > 0) {
        detectionMethod = 'Microsoft Building Footprints';
        dataQuality = 'medium';
      }
    }
  }

  // 3. Try OpenStreetMap
  if (buildings.length === 0) {
    const osmBuildings = await fetchOSMBuildings(parcelInfo);
    sourcesChecked.push('OpenStreetMap');

    if (osmBuildings.length > 0) {
      buildings = matchBuildingsToParcel(osmBuildings, parcelInfo, options);
      if (buildings.length > 0) {
        detectionMethod = 'OpenStreetMap';
        dataQuality = 'medium';
      }
    }
  }

  // 4. Try LA County Assessor (for LA County only)
  if (buildings.length === 0 && county === 'LOS ANGELES' && parcelApn) {
    const assessorData = await fetchAssessorData(parcelApn);
    sourcesChecked.push('LA County Assessor');

    if (assessorData) {
      buildings = [
        {
          id: `ASSESSOR_${parcelApn}`,
          area_sqft: assessorData.building_sqft,
          geometry: null, // No geometry from assessor
          source: 'LA County Assessor',
          confidence: 0.7,
          detection_method: 'Assessor Records',
        },
      ];
      detectionMethod = 'LA County Assessor';
      dataQuality = 'low';
    }
  }

  // 5. Use intelligent estimation as last resort
  if (buildings.length === 0) {
    const estimate = createIntelligentEstimate(parcelInfo);
    buildings = [estimate];
    detectionMethod = 'Intelligent Estimation';
    dataQuality = 'estimated';
    sourcesChecked.push('Estimation Algorithm');
  }

  // Calculate totals and metrics
  const totalArea = buildings.reduce((sum, b) => sum + b.area_sqft, 0);
  const lotCoverage = (totalArea / parcelInfo.area_sqft) * 100;
  const avgConfidence = buildings.reduce((sum, b) => sum + b.confidence, 0) / buildings.length;

  const result: BuildingDetectionResult = {
    buildings,
    total_area_sqft: Math.round(totalArea),
    lot_coverage_percent: Math.min(lotCoverage, 100), // Cap at 100%
    detection_method: detectionMethod,
    data_quality: dataQuality,
    confidence_score: avgConfidence,
    sources_checked: sourcesChecked,
    cache_hit: false,
  };

  // Cache the result
  await saveToCache(parcelInfo, result);

  return result;
}

/**
 * Parse parcel geometry into useful information
 */
function parseParcelInfo(geometry: any, apn?: string, county?: string): ParcelInfo {
  const polygon = turf.polygon(geometry.rings || geometry.coordinates);
  const area = turf.area(polygon);
  const centroid = turf.centroid(polygon);
  const bbox = turf.bbox(polygon);

  return {
    geometry,
    area_sqft: Math.round(area * 10.7639), // Convert m² to ft²
    centroid: centroid.geometry.coordinates as [number, number],
    bbox: bbox as [number, number, number, number],
    apn,
    county: county?.toUpperCase(),
  };
}

/**
 * Fetch buildings from county-specific endpoints
 */
async function fetchCountyBuildings(
  parcel: ParcelInfo,
  county: string,
): Promise<BuildingFootprint[]> {
  const endpoint = COUNTY_BUILDING_ENDPOINTS[county.toUpperCase()];
  if (!endpoint || !endpoint.available) {
    return [];
  }

  const [minX, minY, maxX, maxY] = parcel.bbox;

  // Expand search area slightly
  const buffer = 0.0002; // ~70 feet
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${minX - buffer},${minY - buffer},${maxX + buffer},${maxY + buffer}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    maxRecordCount: '50',
  });

  try {
    const response = await fetch(`${endpoint.url}/query?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.log(`   ⚠️ ${endpoint.name} returned ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const buildings: BuildingFootprint[] = [];

    for (const feature of data.features || []) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `${county}_${feature.attributes?.OBJECTID || Math.random()}`,
          area_sqft: area,
          geometry: feature.geometry,
          source: endpoint.name,
          confidence: 0, // Will be set during matching
        });
      }
    }

    return buildings;
  } catch (error: any) {
    console.log(`   ⚠️ ${endpoint.name} error: ${error.message}`);
    return [];
  }
}

/**
 * Fetch buildings from Microsoft Building Footprints
 */
async function fetchMicrosoftBuildings(parcel: ParcelInfo): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = parcel.bbox;

  // Expand search area
  const buffer = 0.0002;
  const params = new URLSearchParams({
    where: '1=1', // No STATE field in MSBFP2, use spatial filter only
    geometry: `${minX - buffer},${minY - buffer},${maxX + buffer},${maxY + buffer}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326', // Critical: Must specify input spatial reference
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*', // Get all available fields
    returnGeometry: 'true',
    f: 'json', // Ensure JSON response
  });

  try {
    const response = await fetch(`${MICROSOFT_BUILDINGS_URL}/query?${params}`, {
      signal: AbortSignal.timeout(30000), // Increased from 15s to 30s for better reliability
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as any;
    const buildings: BuildingFootprint[] = [];

    for (const feature of data.features || []) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `MSFT_${feature.attributes?.OBJECTID || Math.random()}`,
          area_sqft: area,
          geometry: feature.geometry,
          source: 'Microsoft Buildings',
          confidence: 0,
        });
      }
    }

    return buildings;
  } catch (error: any) {
    console.log(`   ⚠️ Microsoft Buildings error: ${error.message}`);
    return [];
  }
}

/**
 * Fetch buildings from OpenStreetMap
 */
async function fetchOSMBuildings(parcel: ParcelInfo): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = parcel.bbox;

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
          geometry: { rings: [coords] },
          source: 'OpenStreetMap',
          confidence: 0,
        });
      }
    }

    return buildings;
  } catch (error: any) {
    console.log(`   ⚠️ OSM error: ${error.message}`);
    return [];
  }
}

/**
 * Fetch building data from LA County Assessor
 */
async function fetchAssessorData(_apn: string): Promise<{ building_sqft: number } | null> {
  // Simplified assessor lookup - would need actual API integration
  // This is a placeholder for the actual assessor API call
  return null;
}

/**
 * Match buildings to parcel with confidence scoring
 */
function matchBuildingsToParcel(
  buildings: BuildingFootprint[],
  parcel: ParcelInfo,
  options: { aggressiveMatching?: boolean; includePartial?: boolean } = {},
): BuildingFootprint[] {
  const parcelPolygon = turf.polygon(parcel.geometry.rings || parcel.geometry.coordinates);
  const matched: BuildingFootprint[] = [];

  for (const building of buildings) {
    if (!building.geometry) continue;

    const buildingPolygon = turf.polygon(building.geometry.rings || building.geometry.coordinates);

    // Calculate overlap
    let overlapPercent = 0;
    let confidence = 0;

    try {
      // Try to find intersection between building and parcel
      const intersection = turf.booleanIntersects(buildingPolygon, parcelPolygon);

      if (intersection) {
        // If they intersect, calculate overlap by checking if building is within parcel
        if (turf.booleanWithin(buildingPolygon, parcelPolygon)) {
          overlapPercent = 100;
          confidence = 0.95;
        } else if (turf.booleanContains(parcelPolygon, buildingPolygon)) {
          overlapPercent = 100;
          confidence = 0.95;
        } else {
          // Partial overlap - estimate based on centroid
          const buildingCentroid = turf.centroid(buildingPolygon);
          if (turf.booleanPointInPolygon(buildingCentroid, parcelPolygon)) {
            overlapPercent = 75; // Estimate
            confidence = 0.7;
          } else {
            overlapPercent = 25; // Small overlap
            confidence = 0.3;
          }
        }
      }
    } catch (_e) {
      // If intersection fails, check if centroid is in parcel
      const buildingCentroid = turf.centroid(buildingPolygon);
      if (turf.booleanPointInPolygon(buildingCentroid, parcelPolygon)) {
        confidence = 0.5; // Centroid is in parcel
        overlapPercent = 50; // Estimate
      }
    }

    // Calculate distance from parcel center
    const buildingCentroid = turf.centroid(buildingPolygon);
    const distance = turf.distance(turf.point(parcel.centroid), buildingCentroid, {
      units: 'feet',
    });

    // Decision logic
    let include = false;

    if (confidence >= 0.7) {
      include = true; // High confidence - always include
    } else if (confidence >= 0.4 && options.aggressiveMatching) {
      include = true; // Medium confidence with aggressive matching
    } else if (confidence >= 0.2 && options.includePartial && overlapPercent >= 25) {
      include = true; // Partial buildings if option enabled
    } else if (distance < 50 && building.area_sqft > 500) {
      // Very close to center and significant size
      include = true;
      confidence = Math.max(confidence, 0.6);
    }

    if (include) {
      matched.push({
        ...building,
        confidence,
        overlap_percent: overlapPercent,
        distance_from_center: Math.round(distance),
      });
    }
  }

  // Sort by confidence and overlap
  matched.sort((a, b) => {
    const scoreA = a.confidence * 0.7 + ((a.overlap_percent || 0) / 100) * 0.3;
    const scoreB = b.confidence * 0.7 + ((b.overlap_percent || 0) / 100) * 0.3;
    return scoreB - scoreA;
  });

  return matched;
}

/**
 * Create intelligent estimate when no real data available
 */
function createIntelligentEstimate(parcel: ParcelInfo): BuildingFootprint {
  // Base coverage ratios by lot size
  let baseCoverage = 0.22; // Default 22%

  if (parcel.area_sqft < 5000) {
    baseCoverage = 0.3; // Small lots have higher coverage
  } else if (parcel.area_sqft < 7500) {
    baseCoverage = 0.25;
  } else if (parcel.area_sqft < 10000) {
    baseCoverage = 0.22;
  } else if (parcel.area_sqft < 20000) {
    baseCoverage = 0.18;
  } else if (parcel.area_sqft < 43560) {
    baseCoverage = 0.15; // Large lots
  } else {
    baseCoverage = 0.1; // Acre+ lots
  }

  // County adjustments
  const countyFactors: Record<string, number> = {
    'LOS ANGELES': 1.0,
    ORANGE: 1.05,
    'SAN DIEGO': 1.02,
    'SAN FRANCISCO': 1.15,
    ALAMEDA: 1.1,
    'SANTA CLARA': 1.08,
    VENTURA: 0.95,
    RIVERSIDE: 0.92,
    'SAN BERNARDINO': 0.9,
  };

  const countyFactor = countyFactors[parcel.county || ''] || 1.0;
  const finalCoverage = Math.min(baseCoverage * countyFactor, 0.4);

  return {
    id: 'ESTIMATE_001',
    area_sqft: Math.round(parcel.area_sqft * finalCoverage),
    geometry: null,
    source: 'Intelligent Estimate',
    confidence: 0.3,
    detection_method: `${(finalCoverage * 100).toFixed(0)}% lot coverage estimate`,
  };
}

/**
 * Cache management functions
 */
async function checkCache(parcel: ParcelInfo): Promise<BuildingDetectionResult | null> {
  try {
    const cacheKey = getCacheKey(parcel);
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

    const stats = await fs.stat(cachePath);
    const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);

    if (ageHours < CACHE_TTL_HOURS) {
      const data = await fs.readFile(cachePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Cache miss
  }

  return null;
}

async function saveToCache(parcel: ParcelInfo, result: BuildingDetectionResult): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const cacheKey = getCacheKey(parcel);
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

    await fs.writeFile(cachePath, JSON.stringify(result, null, 2));
  } catch (error) {
    // Cache write failure - not critical
    console.log(`   ⚠️ Cache write failed: ${error}`);
  }
}

function getCacheKey(parcel: ParcelInfo): string {
  const data = `${parcel.apn || ''}_${parcel.centroid.join(',')}_${parcel.area_sqft}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Clear the cache
 */
export async function clearBuildingCache(): Promise<void> {
  try {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
    console.log('Building cache cleared');
  } catch (error) {
    console.log('Failed to clear cache:', error);
  }
}
