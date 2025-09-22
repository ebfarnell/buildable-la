/**
 * Test Zoneomics v2/zoning-point endpoint based on documentation URL
 */

import { fetch } from 'undici';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

const testProperty = {
  address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
  lat: 34.212931,
  lon: -118.848476
};

async function testZoningPoint() {
  console.log('🎯 Testing Zoneomics v2/zoning-point Endpoint');
  console.log('=' . repeat(60));
  console.log(`Property: ${testProperty.address}`);
  console.log(`Coordinates: ${testProperty.lat}, ${testProperty.lon}`);

  const baseUrl = 'https://api.zoneomics.com';
  const endpoint = '/v2/zoning-point';

  console.log(`\n🔍 Testing: ${baseUrl}${endpoint}`);

  // Try different parameter combinations and auth methods
  const authMethods = [
    { name: 'Bearer Token', headers: { 'Authorization': `Bearer ${ZONEOMICS_API_KEY}` } },
    { name: 'X-API-Key', headers: { 'X-API-Key': ZONEOMICS_API_KEY } },
    { name: 'API-Key', headers: { 'API-Key': ZONEOMICS_API_KEY } },
    { name: 'Query Param', headers: {}, params: { api_key: ZONEOMICS_API_KEY } },
    { name: 'Key Param', headers: {}, params: { key: ZONEOMICS_API_KEY } }
  ];

  for (const auth of authMethods) {
    console.log(`\n1️⃣ Testing ${auth.name} Authentication:`);

    // Test GET request
    try {
      const params = new URLSearchParams({
        lat: testProperty.lat.toString(),
        lon: testProperty.lon.toString(),
        longitude: testProperty.lon.toString(),
        latitude: testProperty.lat.toString(),
        ...auth.params
      });

      const response = await fetch(`${baseUrl}${endpoint}?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...auth.headers
        },
        signal: AbortSignal.timeout(15000)
      });

      console.log(`   GET Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ SUCCESS! GET worked with ${auth.name}:`);
        console.log(`   ${JSON.stringify(data, null, 2)}`);

        // Look for zoning data
        if (data.zone || data.zoning || data.zoneClass || data.designation) {
          console.log(`   🎯 ZONING DATA FOUND!`);
        }

        return; // Exit on first success
      } else if (response.status === 405) {
        console.log(`   ⚠️ Method not allowed - trying POST`);
      } else if (response.status === 404) {
        console.log(`   ❌ Not found`);
      } else if (response.status === 401) {
        console.log(`   🔑 Unauthorized`);
      } else if (response.status === 403) {
        const text = await response.text();
        console.log(`   🔒 Forbidden: ${text.substring(0, 100)}`);
      } else {
        const text = await response.text();
        console.log(`   Response: ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      console.log(`   ❌ GET Error: ${error.message}`);
    }

    // Test POST request
    try {
      console.log(`   Testing POST with ${auth.name}:`);

      const postData = {
        latitude: testProperty.lat,
        longitude: testProperty.lon,
        lat: testProperty.lat,
        lon: testProperty.lon,
        address: testProperty.address,
        ...auth.params
      };

      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...auth.headers
        },
        body: JSON.stringify(postData),
        signal: AbortSignal.timeout(15000)
      });

      console.log(`   POST Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ SUCCESS! POST worked with ${auth.name}:`);
        console.log(`   ${JSON.stringify(data, null, 2)}`);

        if (data.zone || data.zoning || data.zoneClass || data.designation) {
          console.log(`   🎯 ZONING DATA FOUND!`);
        }

        return; // Exit on first success
      } else if (response.status !== 404) {
        const text = await response.text();
        console.log(`   POST Response: ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      console.log(`   ❌ POST Error: ${error.message}`);
    }
  }

  console.log('\n2️⃣ Testing Related Endpoints:');

  // Try related endpoints based on the zoning-point pattern
  const relatedEndpoints = [
    '/v2/zoning-address',
    '/v2/zoning-lookup',
    '/v2/zone-point',
    '/v2/point-zoning',
    '/v2/geocode-zoning',
    '/v2/reports/zoning-point',
    '/v2/reports/point'
  ];

  for (const relatedEndpoint of relatedEndpoints) {
    try {
      console.log(`\n   Testing: ${baseUrl}${relatedEndpoint}`);

      const params = new URLSearchParams({
        lat: testProperty.lat.toString(),
        lon: testProperty.lon.toString()
      });

      const response = await fetch(`${baseUrl}${relatedEndpoint}?${params}`, {
        headers: {
          'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ SUCCESS! Found working endpoint:`);
        console.log(`     ${JSON.stringify(data, null, 2)}`);
        break;
      } else if (response.status !== 404) {
        console.log(`     Status: ${response.status}`);
      }
    } catch (error: any) {
      console.log(`     ❌ ${error.message}`);
    }
  }

  console.log('\n' + '=' . repeat(60));
  console.log('🎯 ZONING-POINT TEST COMPLETE');
  console.log('=' . repeat(60));
}

testZoningPoint().catch(console.error);