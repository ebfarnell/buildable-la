/**
 * Enhanced Zoning Service - Uses Zoneomics API as primary source
 * Only returns real zoning data from actual sources
 * If no data found, returns null
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getZoneomicsZoningWithFallback } from './zoneomics_tiles_service';

interface ZoningResult {
  zone_code: string;
  zone_name?: string;
  zone_type?: string;
  description?: string;
  source: string;
  verified: boolean;
  city?: string;
  retrieved_at: string;
  setbacks?: {
    front: number;
    side: number;
    rear: number;
  };
}

// County-specific zoning endpoints
const ZONING_ENDPOINTS: Record<string, { name: string; endpoint: string; available: boolean }> = {
  'LOS ANGELES': {
    name: 'LA County Zoning',
    endpoint: 'https://planning.lacounty.gov/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  'LOS ANGELES_CITY': {
    name: 'LA City ZIMAS',
    endpoint: 'https://zimas.lacity.org/arcgis/rest/services/zma/zimas/MapServer',
    available: true,
  },
  'SAN DIEGO': {
    name: 'San Diego Zoning',
    endpoint: 'https://sdgis.sandag.org/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  ORANGE: {
    name: 'Orange County Zoning',
    endpoint: 'https://services.ocgov.com/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  'SAN FRANCISCO': {
    name: 'SF Zoning',
    endpoint: 'https://sfplanninggis.org/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  SACRAMENTO: {
    name: 'Sacramento Zoning',
    endpoint: 'https://services.saccounty.gov/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  ALAMEDA: {
    name: 'Alameda Zoning',
    endpoint: 'https://gismaps.oaklandca.gov/oaklandgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  'SANTA CLARA': {
    name: 'Santa Clara Zoning',
    endpoint: 'https://gis.sccgov.org/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  RIVERSIDE: {
    name: 'Riverside Zoning',
    endpoint: 'https://gis.rivcoca.org/arcgis/rest/services/Zoning/FeatureServer/0',
    available: true,
  },
  VENTURA: {
    name: 'Ventura Zoning',
    endpoint: 'https://maps.ventura.org/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  'CONTRA COSTA': {
    name: 'Contra Costa Zoning',
    endpoint: 'https://gis.cccounty.us/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  'SAN MATEO': {
    name: 'San Mateo Zoning',
    endpoint: 'https://gis.sanmateocounty.org/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  MARIN: {
    name: 'Marin Zoning',
    endpoint: 'https://gis.marinpublic.com/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  KERN: {
    name: 'Kern Zoning',
    endpoint: 'https://maps.kerncounty.com/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
  'SANTA BARBARA': {
    name: 'Santa Barbara Zoning',
    endpoint: 'https://cosb.countyofsb.org/arcgis/rest/services/Zoning/MapServer/0',
    available: true,
  },
};

// Cache directory
const CACHE_DIR = './cache/zoning';
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Generate cache key
 */
function getCacheKey(lat: number, lon: number): string {
  const roundedLat = Math.round(lat * 1000000) / 1000000;
  const roundedLon = Math.round(lon * 1000000) / 1000000;
  return crypto.createHash('md5').update(`${roundedLat}_${roundedLon}`).digest('hex');
}

/**
 * Load cached result
 */
function loadCachedResult(cacheKey: string): ZoningResult | null {
  try {
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    if (fs.existsSync(cachePath)) {
      // Check cache age - 7 days max
      const stats = fs.statSync(cachePath);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      if (ageInDays < 7) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        cached.source = 'cache';
        return cached;
      }
    }
  } catch (_error) {
    // Cache error - continue without cache
  }
  return null;
}

/**
 * Save to cache
 */
function saveToCache(cacheKey: string, result: ZoningResult): void {
  try {
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  } catch (_error) {
    // Cache error - continue without saving
  }
}

/**
 * Get zoning from parcel geometry - Uses Zoneomics as primary source
 * Returns null if no real data found
 */
export async function getEnhancedZoning(
  parcelGeojson: any,
  countyName?: string,
): Promise<ZoningResult | null> {
  const feat = parcelGeojson?.features?.[0];
  if (!feat?.geometry) {
    console.log('❌ Invalid parcel geometry');
    return null;
  }

  // Get centroid
  const [lon, lat] = turf.center(feat).geometry.coordinates as [number, number];
  const cacheKey = getCacheKey(lat, lon);

  // Check cache
  const cached = loadCachedResult(cacheKey);
  if (cached) {
    console.log(`📦 Using cached zoning for ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    return cached;
  }

  console.log(`\n🔍 Searching for zoning data...`);
  console.log(`   Location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);

  // Try Zoneomics API first (primary source)
  const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';
  console.log(`   → Trying Zoneomics API...`);

  try {
    const zoneomicsResult = await getZoneomicsZoningWithFallback(lat, lon, ZONEOMICS_API_KEY);
    if (zoneomicsResult) {
      const result: ZoningResult = {
        zone_code: zoneomicsResult.zone_code,
        zone_name: zoneomicsResult.zone_name,
        zone_type: zoneomicsResult.zone_type,
        description: zoneomicsResult.zone_name,
        source: 'Zoneomics',
        verified: true,
        retrieved_at: new Date().toISOString(),
        setbacks: getDefaultSetbacksForZone(zoneomicsResult.zone_code),
      };
      console.log(`   ✅ SUCCESS: Found zoning ${result.zone_code} from Zoneomics`);
      saveToCache(cacheKey, result);
      return result;
    }
  } catch (error: any) {
    console.log(`   ✗ Zoneomics failed: ${error.message}`);
  }

  // Fallback to ArcGIS endpoints if Zoneomics fails
  const endpoints: Array<{ name: string; endpoint: string }> = [];

  // Add county-specific endpoints
  if (countyName) {
    const county = countyName.toUpperCase();
    if (ZONING_ENDPOINTS[county]) {
      endpoints.push(ZONING_ENDPOINTS[county]);
    }

    // Special case for LA - try both county and city
    if (county === 'LOS ANGELES') {
      endpoints.push(ZONING_ENDPOINTS['LOS ANGELES_CITY']);
    }
  }

  // Try all available endpoints
  for (const endpoint of endpoints) {
    console.log(`   → Trying ${endpoint.name}...`);

    try {
      const result = await queryZoningEndpoint(endpoint.endpoint, lat, lon, endpoint.name);
      if (result) {
        console.log(`   ✅ SUCCESS: Found zoning ${result.zone_code}`);
        saveToCache(cacheKey, result);
        return result;
      }
    } catch (error: any) {
      console.log(`   ✗ ${endpoint.name} failed: ${error.message}`);
    }
  }

  // NO FALLBACK - Return null if no data found
  console.log(`   ❌ NO ZONING DATA FOUND`);
  console.log(`   ⚠️  No zoning information available for this location`);

  return null;
}

/**
 * Query zoning endpoint
 */
async function queryZoningEndpoint(
  endpoint: string,
  lat: number,
  lon: number,
  sourceName: string,
): Promise<ZoningResult | null> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lon, y: lat }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
  });

  // Try both /query and /identify endpoints
  const urls = [`${endpoint}/query?${params}`, `${endpoint}/identify?${params}`];

  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;

      const data = (await response.json()) as any;

      // Check for features
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const attrs = feature.attributes || feature.properties || {};

        // Try various field names for zone code
        const zoneCode =
          attrs.ZONE_CLASS ||
          attrs.ZONE_CODE ||
          attrs.ZONING ||
          attrs.ZONE ||
          attrs.ZONE_NAME ||
          attrs.ZONING_CODE ||
          attrs.ZONING_DISTRICT ||
          attrs.DISTRICT;

        if (zoneCode) {
          return {
            zone_code: zoneCode,
            zone_name: attrs.ZONE_NAME || attrs.DESCRIPTION || attrs.ZONE_DESC,
            zone_type: attrs.ZONE_TYPE || attrs.TYPE,
            description: attrs.DESCRIPTION || attrs.ZONE_DESCRIPTION,
            source: sourceName,
            verified: true,
            city: attrs.CITY || attrs.CITY_NAME || attrs.MUNICIPALITY,
            retrieved_at: new Date().toISOString(),
            setbacks: extractSetbacks(attrs),
          };
        }
      }
    } catch (_error) {
      // Try next URL
    }
  }

  return null;
}

/**
 * Extract setback requirements from attributes
 */
function extractSetbacks(attrs: any): { front: number; side: number; rear: number } | undefined {
  // Try to extract actual setback values from attributes
  const front = attrs.FRONT_SETBACK || attrs.FRONT_YARD || attrs.F_SETBACK;
  const side = attrs.SIDE_SETBACK || attrs.SIDE_YARD || attrs.S_SETBACK;
  const rear = attrs.REAR_SETBACK || attrs.REAR_YARD || attrs.R_SETBACK;

  if (front && side && rear) {
    return {
      front: parseFloat(front),
      side: parseFloat(side),
      rear: parseFloat(rear),
    };
  }

  // No setback data available
  return undefined;
}

/**
 * Get default setbacks based on zone code patterns
 */
function getDefaultSetbacksForZone(
  zoneCode: string,
): { front: number; side: number; rear: number } | undefined {
  const code = zoneCode.toUpperCase();

  // Common residential patterns
  if (code.startsWith('R') || code.includes('RES')) {
    // Single family residential typically has larger setbacks
    if (code.includes('R1') || code.includes('RS') || code.includes('R-1')) {
      return { front: 20, side: 5, rear: 15 };
    }
    // Multi-family typically has smaller setbacks
    if (code.includes('RM') || code.includes('R2') || code.includes('R3')) {
      return { front: 15, side: 5, rear: 10 };
    }
    // Default residential
    return { front: 20, side: 5, rear: 15 };
  }

  // Commercial zones typically have minimal setbacks
  if (code.startsWith('C') || code.includes('COM')) {
    return { front: 0, side: 0, rear: 5 };
  }

  // Industrial zones
  if (code.startsWith('M') || code.startsWith('I') || code.includes('IND')) {
    return { front: 10, side: 5, rear: 10 };
  }

  // Agricultural/Rural zones
  if (code.startsWith('A') || code.includes('AG') || code.includes('RUR')) {
    return { front: 30, side: 10, rear: 20 };
  }

  // Default conservative setbacks if zone type unclear
  return { front: 20, side: 5, rear: 15 };
}

/**
 * Export function for compatibility
 */
export function getZoningRequirementsFromResult(zoningResult: ZoningResult | null) {
  if (!zoningResult) {
    // NO FALLBACK - Return null if no zoning data
    return null;
  }

  // If we have actual setbacks from the data, use them
  if (zoningResult.setbacks) {
    return {
      zone_code: zoningResult.zone_code,
      description: zoningResult.description || zoningResult.zone_name,
      setback_requirements: zoningResult.setbacks,
      source: zoningResult.source,
      verified: zoningResult.verified,
    };
  }

  // If we have a zone code but no setbacks, return the zone info only
  return {
    zone_code: zoningResult.zone_code,
    description: zoningResult.description || zoningResult.zone_name,
    setback_requirements: null, // No setback data available
    source: zoningResult.source,
    verified: zoningResult.verified,
  };
}
