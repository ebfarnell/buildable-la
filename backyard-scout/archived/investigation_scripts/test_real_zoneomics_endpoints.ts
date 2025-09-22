/**
 * Test REAL Zoneomics v2 endpoints from documentation
 */

import { fetch } from 'undici';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

const testProperty = {
  address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
  lat: 34.212931,
  lon: -118.848476,
};

async function testRealZoneomicsEndpoints() {
  console.log('🎯 Testing REAL Zoneomics v2 Endpoints');
  console.log('='.repeat(60));
  console.log(`Property: ${testProperty.address}`);
  console.log(`Coordinates: ${testProperty.lat}, ${testProperty.lon}`);

  const baseUrl = 'https://api.zoneomics.com/v2';

  // Real endpoints from documentation
  const endpoints = [
    'zoning-area', // Area-based zoning
    'zoning-point', // Point-based zoning (if exists)
    'zone-screenshots', // Visual zoning maps
    'get-permits', // Permit information
    'request', // General request
    'tiles', // Map tiles
    'strDetail', // Short-term rental details
    'parkingDetail', // Parking information
    'flum-point', // Future land use map point
    'flum-area', // Future land use map area
  ];

  for (const endpoint of endpoints) {
    console.log(`\n📍 Testing: ${baseUrl}/${endpoint}`);

    // Test GET with query params
    try {
      const params = new URLSearchParams({
        lat: testProperty.lat.toString(),
        lon: testProperty.lon.toString(),
        latitude: testProperty.lat.toString(),
        longitude: testProperty.lon.toString(),
        address: testProperty.address,
      });

      const response = await fetch(`${baseUrl}/${endpoint}?${params}`, {
        headers: {
          Authorization: `Bearer ${ZONEOMICS_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(20000),
      });

      console.log(`   GET Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ SUCCESS! GET worked:`);
        console.log(`   ${JSON.stringify(data, null, 2)}`);

        // Check for zoning-related data
        const zoningFields = [
          'zone',
          'zoning',
          'zoneClass',
          'zone_class',
          'designation',
          'district',
          'zoneCode',
        ];
        let foundZoning = false;
        for (const field of zoningFields) {
          if (data[field] || (data.data && data.data[field])) {
            console.log(`   🎯 ZONING FOUND: ${field} = ${data[field] || data.data[field]}`);
            foundZoning = true;
          }
        }

        if (foundZoning) {
          console.log(`   🏆 THIS IS THE ZONING ENDPOINT WE NEED!`);
        }

        continue; // Test next endpoint
      } else if (response.status === 400) {
        console.log(`   ⚠️ Bad Request - trying different parameters`);

        // Try with different parameter structure
        const altParams = new URLSearchParams({
          lat: testProperty.lat.toString(),
          lng: testProperty.lon.toString(),
        });

        const altResponse = await fetch(`${baseUrl}/${endpoint}?${altParams}`, {
          headers: {
            Authorization: `Bearer ${ZONEOMICS_API_KEY}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        });

        console.log(`   Alt GET Status: ${altResponse.status}`);

        if (altResponse.ok) {
          const data = await altResponse.json();
          console.log(`   ✅ SUCCESS with alt params!`);
          console.log(`   ${JSON.stringify(data, null, 2)}`);
        }
      } else if (response.status === 405) {
        console.log(`   ⚠️ Method not allowed - trying POST`);

        // Try POST
        const postData = {
          lat: testProperty.lat,
          lng: testProperty.lon,
          latitude: testProperty.lat,
          longitude: testProperty.lon,
          address: testProperty.address,
        };

        const postResponse = await fetch(`${baseUrl}/${endpoint}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ZONEOMICS_API_KEY}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(postData),
          signal: AbortSignal.timeout(15000),
        });

        console.log(`   POST Status: ${postResponse.status}`);

        if (postResponse.ok) {
          const data = await postResponse.json();
          console.log(`   ✅ SUCCESS! POST worked:`);
          console.log(`   ${JSON.stringify(data, null, 2)}`);
        } else if (postResponse.status !== 404) {
          const text = await postResponse.text();
          console.log(`   POST Response: ${text.substring(0, 300)}`);
        }
      } else if (response.status === 404) {
        console.log(`   ❌ Not found`);
      } else if (response.status === 401) {
        console.log(`   🔑 Unauthorized`);
      } else if (response.status === 403) {
        const text = await response.text();
        console.log(`   🔒 Forbidden: ${text.substring(0, 200)}`);
      } else {
        const text = await response.text();
        console.log(`   Response (${response.status}): ${text.substring(0, 300)}`);
      }
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        console.log(`   ⏱️ Request timeout`);
      } else {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎯 REAL ZONEOMICS ENDPOINTS TEST COMPLETE');
  console.log('='.repeat(60));
  console.log('Look for ✅ SUCCESS and 🎯 ZONING FOUND messages above!');
}

testRealZoneomicsEndpoints().catch(console.error);
