/**
 * Find the correct v2 API endpoints for Zoneomics
 */

import { fetch } from 'undici';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

const testProperty = {
  address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
  lat: 34.212931,
  lon: -118.848476
};

async function findV2Endpoints() {
  console.log('🔍 Finding Correct v2 API Endpoints');
  console.log('=' . repeat(60));
  console.log('API says: "Please transition to our /v2 APIs"');

  // Try different v2 endpoint structures
  const v2Variations = [
    // Different base URLs for v2
    'https://api.zoneomics.com/v2',
    'https://v2.api.zoneomics.com',
    'https://api-v2.zoneomics.com',

    // Different endpoint patterns within v2
    'https://api.zoneomics.com/v2/zoning-reports',
    'https://api.zoneomics.com/v2/zone-reports',
    'https://api.zoneomics.com/v2/reports',
    'https://api.zoneomics.com/v2/brief',
    'https://api.zoneomics.com/v2/lookup',
    'https://api.zoneomics.com/v2/property-lookup',
    'https://api.zoneomics.com/v2/geocode',
    'https://api.zoneomics.com/v2/search',
    'https://api.zoneomics.com/v2/zones',
    'https://api.zoneomics.com/v2/properties',

    // Try RESTful patterns
    'https://api.zoneomics.com/v2/properties/lookup',
    'https://api.zoneomics.com/v2/zones/lookup',
    'https://api.zoneomics.com/v2/reports/zoning',
    'https://api.zoneomics.com/v2/reports/brief',

    // Try with different HTTP methods patterns
    'https://api.zoneomics.com/v2/query/zoning',
    'https://api.zoneomics.com/v2/api/zoning',
  ];

  console.log('\n1️⃣ Testing v2 Endpoint Variations:');

  for (const endpoint of v2Variations) {
    try {
      console.log(`\n   Testing: ${endpoint}`);

      // Try GET with query params
      const params = new URLSearchParams({
        lat: testProperty.lat.toString(),
        lon: testProperty.lon.toString(),
        latitude: testProperty.lat.toString(),
        longitude: testProperty.lon.toString(),
        address: testProperty.address
      });

      const response = await fetch(`${endpoint}?${params}`, {
        headers: {
          'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(15000)
      });

      console.log(`     GET Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ SUCCESS! GET worked:`);
        console.log(`     ${JSON.stringify(data, null, 2)}`);
        break; // Found working endpoint!
      } else if (response.status === 405) {
        console.log(`     ⚠️ Method not allowed - try POST`);

        // Try POST
        const postResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
            'X-API-Key': ZONEOMICS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            latitude: testProperty.lat,
            longitude: testProperty.lon,
            address: testProperty.address
          }),
          signal: AbortSignal.timeout(15000)
        });

        console.log(`     POST Status: ${postResponse.status}`);

        if (postResponse.ok) {
          const data = await postResponse.json();
          console.log(`     ✅ SUCCESS! POST worked:`);
          console.log(`     ${JSON.stringify(data, null, 2)}`);
          break; // Found working endpoint!
        }
      } else if (response.status === 404) {
        console.log(`     ❌ Not found`);
      } else if (response.status === 401) {
        console.log(`     🔑 Auth issue`);
      } else if (response.status === 403) {
        const text = await response.text();
        if (!text.includes('root API is no longer available')) {
          console.log(`     🔒 Different 403: ${text.substring(0, 100)}`);
        }
      } else {
        const text = await response.text();
        console.log(`     Response: ${text.substring(0, 150)}`);
      }
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        console.log(`     ⏱️ Timeout`);
      } else {
        console.log(`     ❌ ${error.message}`);
      }
    }
  }

  console.log('\n2️⃣ Testing Different API Versions:');

  const versions = ['v1', 'v3', 'v4', '2', '2.0', '2.1', 'api/v2'];

  for (const version of versions) {
    try {
      const endpoint = `https://api.zoneomics.com/${version}/zoning`;
      console.log(`\n   Testing: ${endpoint}`);

      const response = await fetch(`${endpoint}?lat=${testProperty.lat}&lon=${testProperty.lon}`, {
        headers: {
          'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY
        },
        signal: AbortSignal.timeout(10000)
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ Found working version: ${version}`);
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
  console.log('🎯 v2 ENDPOINT DISCOVERY COMPLETE');
  console.log('=' . repeat(60));
  console.log('If no ✅ SUCCESS found, the v2 API might not be publicly accessible');
  console.log('or requires different authentication method.');
}

findV2Endpoints().catch(console.error);