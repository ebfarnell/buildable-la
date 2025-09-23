/**
 * Zoneomics Tiles Service - Extract zoning data from protobuf tiles
 */

import { fetch } from 'undici';
import * as protobuf from 'protobufjs';

export interface ZoneomicsZone {
  zone_code?: string;
  zone_name?: string;
  zone_type?: string;
  zone_sub_type?: string;
  geometry?: any;
}

export interface ZoneomicsTileData {
  zones: ZoneomicsZone[];
}

export interface ZoningResult {
  zone_code: string;
  zone_name?: string;
  zone_type?: string;
  zone_sub_type?: string;
  source: 'zoneomics_tiles';
}

/**
 * Convert lat/lon to tile coordinates for a given zoom level
 */
function latLonToTile(lat: number, lon: number, zoom: number) {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
  const y = Math.floor(
    ((1 -
      Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      Math.pow(2, zoom),
  );
  return { x, y, z: zoom };
}

/**
 * Extract zone information from protobuf data using a more sophisticated approach
 * Since we don't have the exact schema, we'll extract readable strings and patterns
 */
function extractZoneFromProtobuf(buffer: ArrayBuffer): ZoneomicsZone[] {
  const zones: ZoneomicsZone[] = [];

  try {
    // Convert to string to find readable text
    const uint8Array = new Uint8Array(buffer);

    // Create a more readable version by extracting sequences of printable characters
    let textContent = '';
    let currentString = '';

    for (let i = 0; i < uint8Array.length; i++) {
      const byte = uint8Array[i];
      if (byte >= 32 && byte <= 126) {
        // Printable ASCII
        currentString += String.fromCharCode(byte);
      } else {
        if (currentString.length >= 2) {
          // Only keep strings of 2+ chars
          textContent += currentString + ' ';
        }
        currentString = '';
      }
    }

    // Add final string
    if (currentString.length >= 2) {
      textContent += currentString;
    }

    console.log('📝 Extracted text from protobuf:', textContent.substring(0, 400) + '...');

    // Look for zone code patterns in the extracted text
    // Based on the output, I can see patterns like: RPD-7U, RPD-2.57U-SP, R-E-1AC
    const zoneCodePatterns = [
      // Complex patterns like RPD-2.57U-SP
      /\b[A-Z]{1,4}-[0-9]*\.?[0-9]*[A-Z]*-?[A-Z]*\b/g,
      // Simpler patterns like RPD-7U, R-E-1AC
      /\b[A-Z]{1,2}-?[A-Z]{0,2}-?[0-9]{0,2}[A-Z]{0,2}\b/g,
      // Basic patterns like R1, C1, etc.
      /\b[A-Z]{1,2}[0-9]{1,2}\b/g,
    ];

    let foundZones: string[] = [];

    // Extract all potential zone codes
    for (const pattern of zoneCodePatterns) {
      const matches = textContent.match(pattern);
      if (matches) {
        foundZones.push(...matches);
      }
    }

    // Filter and clean up zone codes
    const validZones = foundZones
      .filter((code) => {
        // Remove common false positives
        const excludeList = ['OK', 'ID', 'NO', 'OR', 'SO', 'US', 'CA', 'CO'];
        return !excludeList.includes(code) && code.length >= 2;
      })
      .map((code) => code.replace(/[^A-Z0-9.-]/g, '')) // Clean up
      .filter((code, index, arr) => arr.indexOf(code) === index); // Remove duplicates

    console.log('🔍 Found potential zone codes:', validZones);

    if (validZones.length > 0) {
      // Try to extract zone names from the text for each code
      for (const zoneCode of validZones.slice(0, 3)) {
        // Limit to first 3 to avoid noise
        const zone: ZoneomicsZone = { zone_code: zoneCode };

        // Try to find the description that follows the zone code
        const codeIndex = textContent.indexOf(zoneCode);
        if (codeIndex !== -1) {
          // Look for text after the zone code that might be the description
          const afterCode = textContent.substring(
            codeIndex + zoneCode.length,
            codeIndex + zoneCode.length + 100,
          );
          const descMatch = afterCode.match(/[^"]*([A-Za-z\s]+)[^"]*"/);
          if (descMatch && descMatch[1]) {
            const description = descMatch[1].trim();
            if (description.length > 3 && description.length < 50) {
              zone.zone_name = description;
            }
          }
        }

        zones.push(zone);
        console.log('🎯 Extracted zone:', zone);
      }
    }

    // Fallback: Look for common residential patterns if no zones found
    if (zones.length === 0) {
      const words = textContent.split(/\s+/).filter((word) => word.length > 0);
      const residentialPatterns = words.filter(
        (word) =>
          /^R[-]?[0-9]{0,2}$/.test(word) ||
          /^RS/.test(word) ||
          /^RM/.test(word) ||
          /^RES/.test(word),
      );

      if (residentialPatterns.length > 0) {
        console.log('🏠 Found residential zone pattern:', residentialPatterns[0]);
        zones.push({ zone_code: residentialPatterns[0] });
      }
    }
  } catch (error) {
    console.error('Error extracting zone from protobuf:', error);
  }

  return zones;
}

/**
 * Get zoning data for a specific coordinate using Zoneomics tiles
 */
export async function getZoneomicsZoning(
  lat: number,
  lon: number,
  apiKey: string,
  zoom: number = 17,
): Promise<ZoningResult | null> {
  try {
    const tile = latLonToTile(lat, lon, zoom);
    const baseUrl = 'https://api.zoneomics.com/v2';

    const params = new URLSearchParams({
      x: tile.x.toString(),
      y: tile.y.toString(),
      z: tile.z.toString(),
      api_key: apiKey,
    });

    console.log(`🗺️ Fetching Zoneomics tile: zoom=${zoom}, x=${tile.x}, y=${tile.y}`);

    const response = await fetch(`${baseUrl}/tiles?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`Zoneomics tiles API error: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('protobuf')) {
      console.error('Expected protobuf response, got:', contentType);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const zones = extractZoneFromProtobuf(buffer);

    if (zones.length > 0) {
      const primaryZone = zones[0];
      console.log(`✅ Found zoning data:`, primaryZone);

      return {
        zone_code: primaryZone.zone_code || 'UNKNOWN',
        zone_name: primaryZone.zone_name,
        zone_type: primaryZone.zone_type,
        zone_sub_type: primaryZone.zone_sub_type,
        source: 'zoneomics_tiles',
      };
    }

    console.log('No zoning data found in tile');
    return null;
  } catch (error) {
    console.error('Error fetching Zoneomics zoning:', error);
    return null;
  }
}

/**
 * Get zoning data with fallback to different zoom levels
 */
export async function getZoneomicsZoningWithFallback(
  lat: number,
  lon: number,
  apiKey: string,
): Promise<ZoningResult | null> {
  const zoomLevels = [17, 16, 15]; // Try different zoom levels

  for (const zoom of zoomLevels) {
    const result = await getZoneomicsZoning(lat, lon, apiKey, zoom);
    if (result) {
      return result;
    }
  }

  return null;
}
