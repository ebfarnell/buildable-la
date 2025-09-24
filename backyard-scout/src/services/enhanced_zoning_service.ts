/**
 * Enhanced Zoning Service - Multi-source zoning with fallbacks
 *
 * This service enhances the existing zoningIntersect function with additional fallback options
 * while maintaining the LOCAL-FIRST approach of the backyard-scout agent.
 *
 * Fallback order:
 * 1. ArcGIS layers (existing zoningIntersect function) - LOCAL FIRST
 * 2. Zoneomics tiles API (new addition)
 * 3. Local estimates (Thousand Oaks, etc.)
 */

import { zoningIntersect } from '../sources.js';
import { getZoneomicsZoningWithFallback } from './zoneomics_tiles_service.js';
import { getZoningRequirements, estimateZoneFromLotSize } from './thousand_oaks_zoning.js';
import * as turf from '@turf/turf';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

interface EnhancedZoningResult {
  zone_code: string;
  zone_name?: string;
  zone_type?: string;
  description?: string;
  source: 'arcgis_layers' | 'zoneomics_tiles' | 'local_estimate' | 'cache';
  verified: boolean;
  city?: string;
  retrieved_at: string;
  checksum: string;
}

// Cache directory for deterministic results
const CACHE_DIR = './cache/enhanced_zoning';
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Generate deterministic cache key
 */
function getCacheKey(lat: number, lon: number): string {
  // Round to 6 decimal places for consistent caching
  const roundedLat = Math.round(lat * 1000000) / 1000000;
  const roundedLon = Math.round(lon * 1000000) / 1000000;
  return crypto.createHash('md5').update(`${roundedLat}_${roundedLon}`).digest('hex');
}

/**
 * Load cached result
 */
function loadCachedResult(cacheKey: string): EnhancedZoningResult | null {
  try {
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return { ...cached, source: 'cache' as const };
    }
  } catch (error) {
    console.warn('Cache read error:', error);
  }
  return null;
}

/**
 * Save result to cache
 */
function saveCachedResult(cacheKey: string, result: EnhancedZoningResult): void {
  try {
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
  } catch (error) {
    console.warn('Cache write error:', error);
  }
}

/**
 * Enhanced zoning lookup with multiple fallback sources
 * LOCAL-FIRST: Tries ArcGIS layers first, then external APIs as fallback
 */
export async function getEnhancedZoning(
  parcelGeojson: any,
  zoneomicsApiKey?: string,
): Promise<EnhancedZoningResult> {
  const feat = parcelGeojson?.features?.[0];
  if (!feat?.geometry) {
    throw new Error('Parcel geometry missing');
  }

  // Get centroid for coordinate-based lookups
  const [lon, lat] = turf.center(feat).geometry.coordinates as [number, number];
  const cacheKey = getCacheKey(lat, lon);

  // Check cache first (DETERMINISTIC)
  const cached = loadCachedResult(cacheKey);
  if (cached) {
    console.log(`📦 Using cached zoning result for ${lat}, ${lon}`);
    return cached;
  }

  const timestamp = new Date().toISOString();

  try {
    // 1. Try ArcGIS layers first (LOCAL APPROACH)
    console.log('🏛️ Trying ArcGIS layers (LOCAL approach)...');
    const arcgisResult = await zoningIntersect(parcelGeojson);

    if (arcgisResult?.features?.length > 0) {
      const feature = arcgisResult.features[0];
      const props = feature.properties;

      const result: EnhancedZoningResult = {
        zone_code: props.ZONE_CLASS || props.ZONE_CODE || props.ZONING || 'UNKNOWN',
        zone_name: props.ZONE_NAME || props.DESCRIPTION,
        zone_type: props.ZONE_TYPE,
        description: props.DESCRIPTION || props.ZONE_DESCRIPTION,
        source: 'arcgis_layers',
        verified: true,
        city: props.CITY_NAME || props.CITY,
        retrieved_at: timestamp,
        checksum: crypto.createHash('md5').update(JSON.stringify(props)).digest('hex'),
      };

      console.log(`✅ ArcGIS success: ${result.zone_code}`);
      saveCachedResult(cacheKey, result);
      return result;
    }
  } catch (error) {
    console.log(`⚠️ ArcGIS layers failed: ${error}`);
  }

  // 2. Try Zoneomics tiles as fallback (if API key provided)
  if (zoneomicsApiKey) {
    try {
      console.log('🗺️ Trying Zoneomics tiles fallback...');
      const zoneomicsResult = await getZoneomicsZoningWithFallback(lat, lon, zoneomicsApiKey);

      if (zoneomicsResult) {
        const result: EnhancedZoningResult = {
          zone_code: zoneomicsResult.zone_code,
          zone_name: zoneomicsResult.zone_name,
          zone_type: zoneomicsResult.zone_type,
          description: zoneomicsResult.zone_sub_type,
          source: 'zoneomics_tiles',
          verified: true,
          retrieved_at: timestamp,
          checksum: crypto.createHash('md5').update(JSON.stringify(zoneomicsResult)).digest('hex'),
        };

        console.log(`✅ Zoneomics success: ${result.zone_code}`);
        saveCachedResult(cacheKey, result);
        return result;
      }
    } catch (error) {
      console.log(`⚠️ Zoneomics tiles failed: ${error}`);
    }
  }

  // 3. Try local estimates as last resort
  console.log('🏠 Using local zoning estimates...');

  // For Thousand Oaks area, use local estimates
  if (lat >= 34.1 && lat <= 34.3 && lon >= -119.0 && lon <= -118.7) {
    try {
      // Calculate lot size from parcel geometry for estimation
      const area = turf.area(feat);
      const lotSizeSqft = area * 10.764; // Convert m² to sqft

      const estimatedZone = estimateZoneFromLotSize(lotSizeSqft);
      const requirements = getZoningRequirements(estimatedZone);

      const result: EnhancedZoningResult = {
        zone_code: estimatedZone,
        zone_name: requirements.description,
        description: `Estimated based on lot size (${Math.round(lotSizeSqft)} sqft)`,
        source: 'local_estimate',
        verified: false,
        city: 'Thousand Oaks (estimated)',
        retrieved_at: timestamp,
        checksum: crypto.createHash('md5').update(`${estimatedZone}_${lotSizeSqft}`).digest('hex'),
      };

      console.log(`🔍 Local estimate: ${result.zone_code} (${Math.round(lotSizeSqft)} sqft)`);
      saveCachedResult(cacheKey, result);
      return result;
    } catch (error) {
      console.log(`⚠️ Local estimate failed: ${error}`);
    }
  }

  // Last resort: return unknown with coordinates for manual lookup
  const result: EnhancedZoningResult = {
    zone_code: 'UNKNOWN',
    description: `No zoning data found for coordinates ${lat}, ${lon}`,
    source: 'local_estimate',
    verified: false,
    retrieved_at: timestamp,
    checksum: crypto.createHash('md5').update(`UNKNOWN_${lat}_${lon}`).digest('hex'),
  };

  console.log(`❌ No zoning data found for ${lat}, ${lon}`);
  saveCachedResult(cacheKey, result);
  return result;
}

/**
 * Get zoning requirements for analysis
 * Converts enhanced zoning result to format expected by existing code
 */
export function getZoningRequirementsFromResult(zoningResult: EnhancedZoningResult) {
  // Try to get requirements from local database first
  if (zoningResult.zone_code && zoningResult.zone_code !== 'UNKNOWN') {
    try {
      return getZoningRequirements(zoningResult.zone_code);
    } catch (_error) {
      // If zone code not in local database, return conservative defaults
      console.log(`Using conservative defaults for zone: ${zoningResult.zone_code}`);
      return {
        description: zoningResult.description || zoningResult.zone_name || 'Unknown Zone',
        front_setback: 20,
        side_setback: 5,
        rear_setback: 15,
        max_lot_coverage: 0.4,
        max_height: 30,
        min_lot_size: 0,
      };
    }
  }

  // Default fallback
  return {
    description: 'Unknown zoning - using conservative estimates',
    front_setback: 25,
    side_setback: 10,
    rear_setback: 20,
    max_lot_coverage: 0.3,
    max_height: 25,
    min_lot_size: 0,
  };
}
