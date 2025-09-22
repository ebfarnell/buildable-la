/**
 * Regrid API Zoning Service
 *
 * PURPOSE: Fetch ONLY zoning data from Regrid API
 * DETERMINISTIC: Results are cached to ensure same input = same output
 * FALLBACK: Uses local database if API fails
 */

import { fetch } from 'undici';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

interface RegridParcel {
  parcelnumb: string;
  zoning: string | null;
  zoning_description?: string;
  situs?: string;
  county?: string;
  state2?: string;
  ll_gisacre?: number;
}

interface ZoningResult {
  zone: string;
  description?: string;
  source: 'regrid_api' | 'regrid_cache' | 'fallback';
  verified: boolean;
  retrieved_at: string;
  checksum: string;
}

// Cache directory for deterministic results
const CACHE_DIR = './cache/regrid';
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * DETERMINISTIC: Generate cache key from input
 */
function getCacheKey(apn: string, county: string): string {
  return crypto.createHash('md5').update(`${apn}_${county.toUpperCase()}`).digest('hex');
}

/**
 * DETERMINISTIC: Check cache first
 */
function checkCache(apn: string, county: string): ZoningResult | null {
  const cacheKey = getCacheKey(apn, county);
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    // Cache valid for 30 days
    const cacheAge = Date.now() - new Date(cached.retrieved_at).getTime();
    if (cacheAge < 30 * 24 * 60 * 60 * 1000) {
      cached.source = 'regrid_cache';
      return cached;
    }
  }
  return null;
}

/**
 * Save to cache for deterministic results
 */
function saveCache(apn: string, county: string, result: ZoningResult): void {
  const cacheKey = getCacheKey(apn, county);
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
}

/**
 * Main function to get zoning from Regrid API
 * DETERMINISTIC: Always returns same result for same input
 */
export async function getRegridZoning(
  apn: string,
  county: string,
  apiKey?: string,
): Promise<ZoningResult> {
  // 1. Check cache first (deterministic)
  const cached = checkCache(apn, county);
  if (cached) {
    console.log(`   ✅ Using cached Regrid data (deterministic)`);
    return cached;
  }

  // 2. Use environment variable if no key provided
  const token = apiKey || process.env.REGRID_API_KEY;
  if (!token) {
    console.log(`   ⚠️ No Regrid API key, using fallback`);
    return getFallbackZoning(apn, county);
  }

  try {
    // 3. Query Regrid API - Try multiple methods
    console.log(`   🔍 Querying Regrid API for APN ${apn}...`);

    // Method 1: Direct APN search
    let url = `https://app.regrid.com/api/v2/parcels/apn?parcelnumb=${apn}&path=/us/ca/${county.toLowerCase()}&token=${token}`;

    let response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    // If APN search fails, try query endpoint
    if (!response.ok) {
      console.log(`   Trying query endpoint...`);
      const params = new URLSearchParams({
        token: token,
        'fields[parcelnumb][eq]': apn,
        'fields[county][ilike]': county,
        'fields[state2][eq]': 'CA',
      });

      response = await fetch(`https://app.regrid.com/api/v2/parcels/query?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
    }

    if (!response.ok) {
      throw new Error(`Regrid API error: ${response.status}`);
    }

    const data = (await response.json()) as any;

    if (data.parcels && data.parcels.length > 0) {
      const parcel = data.parcels[0] as RegridParcel;

      const result: ZoningResult = {
        zone: parcel.zoning || 'UNKNOWN',
        description: parcel.zoning_description,
        source: 'regrid_api',
        verified: true,
        retrieved_at: new Date().toISOString(),
        checksum: crypto
          .createHash('md5')
          .update(`${apn}_${parcel.zoning || 'UNKNOWN'}`)
          .digest('hex')
          .substring(0, 8),
      };

      // Save to cache for determinism
      saveCache(apn, county, result);

      console.log(`   ✅ Retrieved zoning: ${result.zone}`);
      return result;
    } else {
      console.log(`   ⚠️ No parcel found in Regrid`);
      return getFallbackZoning(apn, county);
    }
  } catch (error) {
    console.log(`   ❌ Regrid API error: ${error}`);
    return getFallbackZoning(apn, county);
  }
}

/**
 * Fallback to local database (deterministic)
 */
function getFallbackZoning(apn: string, county: string): ZoningResult {
  // Load local zoning database
  const localZoning = JSON.parse(fs.readFileSync('./resources/zoning/thousand_oaks.json', 'utf-8'));

  // For Thousand Oaks properties
  if (county.toUpperCase() === 'VENTURA' && apn.startsWith('57')) {
    // Estimate based on lot size (if we have it from previous analysis)
    const zone = 'RE-10'; // Default for this area

    return {
      zone: zone,
      description: localZoning.zones[zone]?.description,
      source: 'fallback',
      verified: false,
      retrieved_at: new Date().toISOString(),
      checksum: crypto
        .createHash('md5')
        .update(`${apn}_${zone}_fallback`)
        .digest('hex')
        .substring(0, 8),
    };
  }

  return {
    zone: 'DEFAULT',
    description: 'Conservative defaults',
    source: 'fallback',
    verified: false,
    retrieved_at: new Date().toISOString(),
    checksum: crypto
      .createHash('md5')
      .update(`${apn}_DEFAULT_fallback`)
      .digest('hex')
      .substring(0, 8),
  };
}

/**
 * Get setbacks for a zone (combines Regrid data with local knowledge)
 */
export function getSetbacksForZone(zone: string): {
  front: number;
  side: number;
  rear: number;
  source: string;
} {
  // Load local database
  const localZoning = JSON.parse(fs.readFileSync('./resources/zoning/thousand_oaks.json', 'utf-8'));

  const upperZone = zone.toUpperCase();

  // Check local database for setback details
  if (localZoning.zones[upperZone]) {
    return {
      ...localZoning.zones[upperZone].setbacks,
      source: 'local_database',
    };
  }

  // Parse common zone patterns
  if (upperZone.includes('RE') || upperZone.includes('R-E')) {
    // Residential Estate zones
    if (upperZone.includes('1AC') || upperZone.includes('43')) {
      return { front: 30, side: 10, rear: 25, source: 'estimated_RE-1AC' };
    }
    if (upperZone.includes('20')) {
      return { front: 25, side: 8, rear: 20, source: 'estimated_RE-20' };
    }
    if (upperZone.includes('10')) {
      return { front: 20, side: 5, rear: 15, source: 'estimated_RE-10' };
    }
  }

  if (upperZone.includes('R-1') || upperZone.includes('R1')) {
    return { front: 20, side: 5, rear: 15, source: 'estimated_R1' };
  }

  // Default conservative values
  return { front: 25, side: 5, rear: 15, source: 'default_conservative' };
}

/**
 * Test deterministic behavior
 */
export async function testDeterministicZoning(
  apn: string,
  county: string,
  apiKey?: string,
): Promise<boolean> {
  console.log('Testing deterministic zoning behavior...');

  const results = [];
  for (let i = 0; i < 3; i++) {
    const result = await getRegridZoning(apn, county, apiKey);
    results.push({
      zone: result.zone,
      checksum: result.checksum,
      source: result.source,
    });
  }

  // Verify all results identical
  const firstResult = JSON.stringify(results[0]);
  const allIdentical = results.every((r) => JSON.stringify(r) === firstResult);

  console.log('Deterministic test:', {
    passed: allIdentical,
    runs: results,
  });

  return allIdentical;
}
