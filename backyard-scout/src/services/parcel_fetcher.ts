/**
 * Robust Parcel Boundary Fetcher
 * Fetches exact parcel boundaries with fallback options and caching
 */

import { fetch } from 'undici';
import * as fs from 'fs';
import * as path from 'path';
import * as turf from '@turf/turf';
import californiaServices from '../config/california_services.json';

interface ParcelResult {
  apn: string;
  address: string;
  city: string;
  county: string;
  geometry: any;
  area_sqft: number;
  source: string;
  cached?: boolean;
}

interface QueryOptions {
  useCache?: boolean;
  timeout?: number;
  retries?: number;
}

// Cache directory
const CACHE_DIR = path.join(process.cwd(), 'cache', 'parcels');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Get cache key for a query
 */
function getCacheKey(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Check cache for existing parcel data
 */
function checkCache(address: string): ParcelResult | null {
  const cacheKey = getCacheKey(address);
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (fs.existsSync(cacheFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      // Check if cache is less than 7 days old
      const cacheAge = Date.now() - data.cached_at;
      if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
        console.log(`   📦 Using cached parcel data`);
        return { ...data.result, cached: true };
      }
    } catch (_error) {
      // Invalid cache, will refetch
    }
  }
  return null;
}

/**
 * Save parcel data to cache
 */
function saveToCache(address: string, result: ParcelResult) {
  const cacheKey = getCacheKey(address);
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);

  try {
    fs.writeFileSync(
      cacheFile,
      JSON.stringify(
        {
          cached_at: Date.now(),
          address,
          result,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(`   ⚠️ Could not cache result: ${error}`);
  }
}

/**
 * Parse address to extract components
 */
function parseAddress(address: string) {
  const match = address.match(/^(\d+)\s+(.+?),\s*(.+?),\s*CA\s*(\d{5})?/i);
  if (!match) {
    throw new Error(`Cannot parse address: ${address}`);
  }

  const [_, streetNum, streetName, city, zip] = match;

  // Clean street name
  const cleanStreet = streetName
    .replace(
      /\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Pl|Place|Ct|Court|Blvd|Boulevard)$/i,
      '',
    )
    .trim()
    .toUpperCase();

  return {
    streetNum,
    streetName: cleanStreet,
    city: city.toUpperCase(),
    zip,
    searchQuery: `SITE_ADDR LIKE '%${streetNum}%${cleanStreet.split(' ').join('%')}%'`,
  };
}

/**
 * Determine county from city name
 */
function getCountyFromCity(city: string): string | null {
  const cityUpper = city.toUpperCase();

  for (const [_countyKey, countyData] of Object.entries(californiaServices.counties)) {
    const county = countyData as any;
    if (county.cities) {
      const found = county.cities.some(
        (c: string) =>
          c.toUpperCase() === cityUpper ||
          c.toUpperCase().includes(cityUpper) ||
          cityUpper.includes(c.toUpperCase()),
      );
      if (found) {
        return county.name;
      }
    }
  }
  return null;
}

/**
 * Query statewide parcel service
 */
async function queryStatewideService(searchQuery: string, timeout: number = 15000): Promise<any> {
  const url = californiaServices.statewide.parcels.url;

  const params = new URLSearchParams({
    f: 'json',
    where: searchQuery,
    outFields: '*',
    returnGeometry: 'true',
    resultRecordCount: '10',
  });

  console.log(`   🌐 Querying California Statewide Parcels...`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url + '/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = (await response.json()) as any;

    if (data.features && data.features.length > 0) {
      return data;
    }
    return null;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Query county-specific parcel service
 */
async function queryCountyService(
  countyKey: string,
  searchQuery: string,
  timeout: number = 10000,
): Promise<any> {
  const county = (californiaServices.counties as any)[countyKey];
  if (!county?.additional_services?.parcels_local) {
    return null;
  }

  const url = county.additional_services.parcels_local;

  const params = new URLSearchParams({
    f: 'json',
    where: searchQuery.replace('SITE_ADDR', 'SITUS_ADDR'), // Some counties use different field names
    outFields: '*',
    returnGeometry: 'true',
    resultRecordCount: '10',
  });

  console.log(`   🏛️ Trying ${county.name} local service...`);

  try {
    const response = await fetch(url + '/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(timeout),
    });

    const data = (await response.json()) as any;

    if (data.features && data.features.length > 0) {
      return data;
    }
    return null;
  } catch (error) {
    console.log(`      County service failed: ${error}`);
    return null;
  }
}

/**
 * Geocode address to get approximate location
 */
async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const url =
    `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?` +
    `SingleLine=${encodeURIComponent(address)}&f=json&outFields=*&maxLocations=1`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = (await response.json()) as any;

    if (data.candidates && data.candidates.length > 0) {
      const location = data.candidates[0].location;
      return { lat: location.y, lon: location.x };
    }
  } catch (error) {
    console.log(`   ⚠️ Geocoding failed: ${error}`);
  }
  return null;
}

/**
 * Query by location (point-in-polygon)
 */
async function queryByLocation(
  lat: number,
  lon: number,
  service: string = californiaServices.statewide.parcels.url,
  timeout: number = 10000,
): Promise<any> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lon, y: lat }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
  });

  console.log(`   📍 Querying by location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);

  try {
    const response = await fetch(service + '/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(timeout),
    });

    const data = (await response.json()) as any;

    if (data.features && data.features.length > 0) {
      return data;
    }
    return null;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Location query timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Process parcel feature data
 */
function processParcelFeature(feature: any, source: string): ParcelResult {
  const attrs = feature.attributes;
  const geometry = feature.geometry;

  // Calculate area
  let areaSqft = 0;
  if (geometry && geometry.rings) {
    try {
      const polygon = turf.polygon(geometry.rings);
      areaSqft = Math.round(turf.area(polygon) * 10.7639);
    } catch (error) {
      console.log(`   ⚠️ Could not calculate area: ${error}`);
    }
  }

  return {
    apn: attrs.PARCEL_APN || attrs.APN || attrs.APN_1 || 'Unknown',
    address: attrs.SITE_ADDR || attrs.SITUS_ADDR || attrs.SITUS || 'Unknown',
    city: attrs.SITE_CITY || attrs.CITY || 'Unknown',
    county: attrs.COUNTYNAME || attrs.COUNTY || 'Unknown',
    geometry: geometry,
    area_sqft: areaSqft,
    source: source,
  };
}

/**
 * Main function to fetch parcel with multiple strategies
 */
export async function fetchParcelBoundary(
  address: string,
  options: QueryOptions = {},
): Promise<ParcelResult | null> {
  const { useCache = true, timeout = 15000, retries = 2 } = options;

  console.log(`\n🗺️ Fetching parcel boundary for: ${address}`);

  // Check cache first
  if (useCache) {
    const cached = checkCache(address);
    if (cached) {
      return cached;
    }
  }

  // Parse address
  let addressParts;
  try {
    addressParts = parseAddress(address);
  } catch (error: any) {
    console.log(`   ❌ ${error.message}`);
    return null;
  }

  console.log(
    `   📝 Search: ${addressParts.streetNum} ${addressParts.streetName}, ${addressParts.city}`,
  );

  // Determine county
  const county = getCountyFromCity(addressParts.city);
  const countyKey = county ? county.toLowerCase().replace(/\s+/g, '_') : null;

  // Strategy 1: Try address-based search
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`   🔄 Attempt ${attempt}/${retries} - Address search`);

      // Try statewide service first
      const statewideData = await queryStatewideService(addressParts.searchQuery, timeout);

      if (statewideData) {
        const feature = statewideData.features[0];
        const result = processParcelFeature(feature, 'CA Statewide Parcels');
        console.log(
          `   ✅ Found parcel: ${result.apn} (${result.area_sqft.toLocaleString()} sqft)`,
        );

        if (useCache) {
          saveToCache(address, result);
        }
        return result;
      }

      // Try county-specific service if available
      if (countyKey) {
        const countyData = await queryCountyService(
          countyKey,
          addressParts.searchQuery,
          timeout / 2,
        );

        if (countyData) {
          const feature = countyData.features[0];
          const result = processParcelFeature(feature, `${county} County Service`);
          console.log(
            `   ✅ Found parcel: ${result.apn} (${result.area_sqft.toLocaleString()} sqft)`,
          );

          if (useCache) {
            saveToCache(address, result);
          }
          return result;
        }
      }
    } catch (error: any) {
      console.log(`   ⚠️ Attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) {
        console.log(`   ❌ Address search failed after ${retries} attempts`);
      } else {
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // Strategy 2: Try geocoding + point-in-polygon
  console.log(`   🗺️ Falling back to location-based search...`);

  const location = await geocodeAddress(address);
  if (location) {
    try {
      // Try statewide service
      const locationData = await queryByLocation(
        location.lat,
        location.lon,
        californiaServices.statewide.parcels.url,
        timeout,
      );

      if (locationData) {
        const feature = locationData.features[0];
        const result = processParcelFeature(feature, 'CA Statewide Parcels (geocoded)');
        console.log(
          `   ✅ Found parcel by location: ${result.apn} (${result.area_sqft.toLocaleString()} sqft)`,
        );

        if (useCache) {
          saveToCache(address, result);
        }
        return result;
      }

      // Try county service by location
      if (countyKey) {
        const county = (californiaServices.counties as any)[countyKey];
        if (county?.additional_services?.parcels_local) {
          const countyLocationData = await queryByLocation(
            location.lat,
            location.lon,
            county.additional_services.parcels_local,
            timeout / 2,
          );

          if (countyLocationData) {
            const feature = countyLocationData.features[0];
            const result = processParcelFeature(feature, `${county.name} County (geocoded)`);
            console.log(
              `   ✅ Found parcel by location: ${result.apn} (${result.area_sqft.toLocaleString()} sqft)`,
            );

            if (useCache) {
              saveToCache(address, result);
            }
            return result;
          }
        }
      }
    } catch (error: any) {
      console.log(`   ❌ Location search failed: ${error.message}`);
    }
  }

  console.log(`   ❌ Could not fetch parcel boundary`);
  return null;
}

/**
 * Batch fetch multiple parcels with progress reporting
 */
export async function fetchMultipleParcels(
  addresses: string[],
  options: QueryOptions = {},
): Promise<Map<string, ParcelResult | null>> {
  const results = new Map<string, ParcelResult | null>();

  console.log(`\n📦 Fetching ${addresses.length} parcels...`);

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    console.log(`\n[${i + 1}/${addresses.length}] ${address}`);

    const result = await fetchParcelBoundary(address, options);
    results.set(address, result);

    // Small delay between requests to avoid rate limiting
    if (i < addresses.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Summary
  const successful = Array.from(results.values()).filter((r) => r !== null).length;
  console.log(`\n✅ Successfully fetched ${successful}/${addresses.length} parcels`);

  return results;
}

/**
 * Clear cache for specific address or all
 */
export function clearCache(address?: string) {
  if (address) {
    const cacheKey = getCacheKey(address);
    const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
      console.log(`Cleared cache for: ${address}`);
    }
  } else {
    // Clear all cache
    const files = fs.readdirSync(CACHE_DIR);
    files.forEach((file) => {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
    });
    console.log(`Cleared all parcel cache (${files.length} files)`);
  }
}
