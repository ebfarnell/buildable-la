/**
 * Test Zoneomics endpoints that returned 400 (meaning they exist)
 * with proper parameters
 */

import { fetch } from 'undici';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

const testProperty = {
  address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
  lat: 34.212931,
  lon: -118.848476,
};

// Convert lat/lon to tile coordinates
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

async function testWorkingEndpoints() {
  console.log('🔧 Testing Zoneomics Endpoints with Proper Parameters');
  console.log('='.repeat(60));
  console.log(`Property: ${testProperty.address}`);
  console.log(`Coordinates: ${testProperty.lat}, ${testProperty.lon}`);

  const baseUrl = 'https://api.zoneomics.com/v2';

  // Test 1: tiles endpoint
  console.log('\n1️⃣ Testing tiles endpoint:');

  const zoomLevels = [15, 16, 17]; // API requires z >= 15

  for (const zoom of zoomLevels) {
    try {
      const tile = latLonToTile(testProperty.lat, testProperty.lon, zoom);
      console.log(`\n   Testing zoom ${zoom}: x=${tile.x}, y=${tile.y}, z=${tile.z}`);

      const params = new URLSearchParams({
        x: tile.x.toString(),
        y: tile.y.toString(),
        z: tile.z.toString(),
        api_key: ZONEOMICS_API_KEY,
      });

      const response = await fetch(`${baseUrl}/tiles?${params}`, {
        signal: AbortSignal.timeout(15000),
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const contentType = response.headers.get('content-type');
        console.log(`     ✅ SUCCESS! Content-Type: ${contentType}`);

        if (contentType?.includes('image')) {
          console.log(
            `     🗺️ Received image tile (${response.headers.get('content-length')} bytes)`,
          );
        } else if (contentType?.includes('json')) {
          const data = await response.json();
          console.log(`     📄 JSON Response: ${JSON.stringify(data, null, 2)}`);
        } else {
          const text = await response.text();
          console.log(`     📄 Response: ${text.substring(0, 200)}`);
        }
      } else {
        const text = await response.text();
        console.log(`     Response: ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      console.log(`     ❌ Error: ${error.message}`);
    }
  }

  // Test 2: strDetail endpoint
  console.log('\n2️⃣ Testing strDetail endpoint:');

  try {
    const params = new URLSearchParams({
      lat: testProperty.lat.toString(),
      lon: testProperty.lon.toString(),
      lng: testProperty.lon.toString(),
      latitude: testProperty.lat.toString(),
      longitude: testProperty.lon.toString(),
      api_key: ZONEOMICS_API_KEY,
    });

    const response = await fetch(`${baseUrl}/strDetail?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ SUCCESS! STR Detail data:`);
      console.log(`   ${JSON.stringify(data, null, 2)}`);

      // Look for any zoning information in STR data
      const dataStr = JSON.stringify(data).toLowerCase();
      if (dataStr.includes('zone') || dataStr.includes('zoning')) {
        console.log(`   🎯 ZONING INFO FOUND IN STR DATA!`);
      }
    } else {
      const text = await response.text();
      console.log(`   Response: ${text.substring(0, 300)}`);
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 3: parkingDetail endpoint
  console.log('\n3️⃣ Testing parkingDetail endpoint:');

  try {
    const params = new URLSearchParams({
      lat: testProperty.lat.toString(),
      lon: testProperty.lon.toString(),
      api_key: ZONEOMICS_API_KEY,
    });

    const response = await fetch(`${baseUrl}/parkingDetail?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ SUCCESS! Parking Detail data:`);
      console.log(`   ${JSON.stringify(data, null, 2)}`);

      // Look for zoning info in parking data
      const dataStr = JSON.stringify(data).toLowerCase();
      if (dataStr.includes('zone') || dataStr.includes('zoning')) {
        console.log(`   🎯 ZONING INFO FOUND IN PARKING DATA!`);
      }
    } else {
      const text = await response.text();
      console.log(`   Response: ${text.substring(0, 300)}`);
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // Test 4: Try some other common endpoints with api_key parameter
  console.log('\n4️⃣ Testing other endpoints with api_key parameter:');

  const otherEndpoints = [
    'zone-info',
    'zoning-info',
    'property-info',
    'location-info',
    'zone-lookup',
    'property-lookup',
  ];

  for (const endpoint of otherEndpoints) {
    try {
      const params = new URLSearchParams({
        lat: testProperty.lat.toString(),
        lon: testProperty.lon.toString(),
        api_key: ZONEOMICS_API_KEY,
      });

      const response = await fetch(`${baseUrl}/${endpoint}?${params}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`\n   ✅ FOUND WORKING ENDPOINT: ${endpoint}`);
        console.log(`   ${JSON.stringify(data, null, 2)}`);
        break; // Found a working endpoint!
      } else if (response.status === 400) {
        console.log(`\n   ${endpoint}: 400 (exists but needs different params)`);
      }
    } catch (error) {
      // Ignore errors, just testing
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎯 WORKING ENDPOINTS TEST COMPLETE');
  console.log('='.repeat(60));
}

testWorkingEndpoints().catch(console.error);
