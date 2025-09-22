/**
 * Zoneomics API Service - Using the correct zoneDetail endpoint
 * Based on official Zoneomics API documentation
 */

import { fetch } from 'undici';

export interface ZoneomicsResponse {
  zone_code?: string;
  zone_name?: string;
  zone_type?: string;
  permitted_land_uses?: string[];
  controls?: {
    max_height?: number;
    setback_front?: number;
    setback_side?: number;
    setback_rear?: number;
    far?: number; // Floor Area Ratio
    lot_coverage?: number;
  };
  parcel_info?: any;
  ordinance_link?: string;
  success: boolean;
  error?: string;
}

/**
 * Query Zoneomics zoneDetail API endpoint
 * This is the correct endpoint according to official documentation
 */
export async function queryZoneomicsAPI(
  lat: number,
  lon: number,
  apiKey?: string,
): Promise<ZoneomicsResponse> {
  const key = apiKey || process.env.ZONEOMICS_API_KEY || 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

  // Construct the zoneDetail API URL using lat/lng
  const baseUrl = 'https://api.zoneomics.com/v2/zoneDetail';

  const params = new URLSearchParams({
    lat: lat.toString(),
    lng: lon.toString(),
    apikey: key,
    output_fields: 'zoning,plu,controls,parcels',
  });

  const url = `${baseUrl}?${params}`;

  console.log(`🔍 Querying Zoneomics zoneDetail API...`);
  console.log(`   Location: ${lat}, ${lon}`);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.log(`   ⚠️ Zoneomics API returned status ${response.status}`);

      // If 404, the API structure may have changed
      if (response.status === 404) {
        // Try alternative URL structure
        const altUrl = `https://api.zoneomics.com/api/v2/zoneDetail?${params}`;
        const altResponse = await fetch(altUrl, {
          signal: AbortSignal.timeout(10000),
        });

        if (altResponse.ok) {
          const data = (await altResponse.json()) as any;
          return parseZoneomicsResponse(data);
        }
      }

      return {
        success: false,
        error: `API returned status ${response.status}`,
      };
    }

    const data = (await response.json()) as any;
    return parseZoneomicsResponse(data);
  } catch (error: any) {
    console.log(`   ❌ Zoneomics API error: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Query using address instead of coordinates
 */
export async function queryZoneomicsByAddress(
  address: string,
  apiKey?: string,
): Promise<ZoneomicsResponse> {
  const key = apiKey || process.env.ZONEOMICS_API_KEY || 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

  const baseUrl = 'https://api.zoneomics.com/v2/zoneDetail';

  const params = new URLSearchParams({
    address: address,
    apikey: key,
    output_fields: 'zoning,plu,controls,parcels',
  });

  const url = `${baseUrl}?${params}`;

  console.log(`🔍 Querying Zoneomics by address: ${address}`);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `API returned status ${response.status}`,
      };
    }

    const data = (await response.json()) as any;
    return parseZoneomicsResponse(data);
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Parse Zoneomics API response into a standardized format
 */
function parseZoneomicsResponse(data: any): ZoneomicsResponse {
  if (!data) {
    return {
      success: false,
      error: 'No data received',
    };
  }

  // Check for error responses
  if (data.error || data.status === 'error') {
    return {
      success: false,
      error: data.error || data.message || 'Unknown error',
    };
  }

  // Parse zoning information
  const zoneCode = data.zoning?.zone_code || data.zone?.code || data.zone_code || data.zoning;

  if (!zoneCode) {
    return {
      success: false,
      error: 'No zoning data found in response',
    };
  }

  // Parse development controls/setbacks
  let controls: any = {};
  if (data.controls) {
    controls = {
      max_height: data.controls.max_height || data.controls.height_max,
      setback_front: parseSetback(data.controls.setback_front || data.controls.front_setback),
      setback_side: parseSetback(data.controls.setback_side || data.controls.side_setback),
      setback_rear: parseSetback(data.controls.setback_rear || data.controls.rear_setback),
      far: data.controls.far || data.controls.floor_area_ratio,
      lot_coverage: data.controls.lot_coverage || data.controls.coverage_max,
    };
  }

  console.log(`   ✅ Found zoning: ${zoneCode}`);
  if (controls.setback_front) {
    console.log(
      `   📏 Setbacks: Front ${controls.setback_front}', Side ${controls.setback_side}', Rear ${controls.setback_rear}'`,
    );
  }

  return {
    zone_code: zoneCode,
    zone_name: data.zoning?.zone_name || data.zone?.name,
    zone_type: data.zoning?.zone_type || data.zone?.type,
    permitted_land_uses: data.plu || data.permitted_uses || [],
    controls,
    parcel_info: data.parcels || data.parcel,
    ordinance_link: data.ordinance_url || data.ordinance_link,
    success: true,
  };
}

/**
 * Parse setback values which may come in various formats
 */
function parseSetback(value: any): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    // Extract number from strings like "20 ft", "20'", "20"
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      return parseFloat(match[1]);
    }
  }

  // Default setback if not specified
  return 0;
}

/**
 * Get setback requirements from Zoneomics response
 */
export function getSetbacksFromZoneomics(response: ZoneomicsResponse): {
  front: number;
  side: number;
  rear: number;
} {
  if (!response.success || !response.controls) {
    // Return California default setbacks if no data
    return {
      front: 20,
      side: 5,
      rear: 15,
    };
  }

  return {
    front: response.controls.setback_front || 20,
    side: response.controls.setback_side || 5,
    rear: response.controls.setback_rear || 15,
  };
}

/**
 * Test Zoneomics API connection
 */
export async function testZoneomicsConnection(): Promise<boolean> {
  // Test with a known location in Los Angeles
  const testLat = 34.0522;
  const testLon = -118.2437;

  const result = await queryZoneomicsAPI(testLat, testLon);

  if (result.success) {
    console.log('✅ Zoneomics API is working');
    console.log(`   Test zone: ${result.zone_code}`);
    return true;
  } else {
    console.log('❌ Zoneomics API test failed:', result.error);
    return false;
  }
}
