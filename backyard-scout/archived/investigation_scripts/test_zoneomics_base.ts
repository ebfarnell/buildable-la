/**
 * Test Zoneomics API on working base URL
 */

import { fetch } from 'undici';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';
const BASE_URL = 'https://api.zoneomics.com';

const testProperty = {
  address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
  lat: 34.212931,
  lon: -118.848476
};

async function testZoneomicsBase() {
  console.log('🔧 Testing Zoneomics API on Working Base URL');
  console.log('=' . repeat(60));

  // Test direct endpoints on base URL (no v2)
  const endpoints = [
    '/zoning',
    '/zone',
    '/property',
    '/lookup',
    '/search',
    '/query',
    '/api/zoning',
    '/api/zone',
    '/api/property',
    // Try some other common patterns
    '/reports',
    '/brief',
    '/data',
    '/geo'
  ];

  console.log('\n1️⃣ Testing Endpoints on Base URL:');

  for (const endpoint of endpoints) {
    try {
      console.log(`\n   Testing: ${BASE_URL}${endpoint}`);

      // Try with coordinates
      const params = new URLSearchParams({
        lat: testProperty.lat.toString(),
        lon: testProperty.lon.toString(),
        api_key: ZONEOMICS_API_KEY
      });

      const response = await fetch(`${BASE_URL}${endpoint}?${params}`, {
        headers: {
          'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(15000)
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ SUCCESS! Found data:`);
        console.log(`     ${JSON.stringify(data, null, 2)}`);

        // Look for zoning data
        if (data.zoning || data.zone || data.zone_class) {
          console.log(`     🎯 ZONING DATA FOUND!`);
        }
      } else if (response.status === 401) {
        console.log(`     🔑 Auth issue - might need different auth method`);
      } else if (response.status === 404) {
        console.log(`     ❌ Not found`);
      } else {
        const text = await response.text();
        console.log(`     Response: ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      console.log(`     ❌ ${error.message}`);
    }
  }

  console.log('\n2️⃣ Testing Address-Based Queries:');

  const addressEndpoints = [
    '/zoning',
    '/lookup',
    '/property',
    '/reports',
    '/brief'
  ];

  for (const endpoint of addressEndpoints) {
    try {
      console.log(`\n   Testing: ${BASE_URL}${endpoint} with address`);

      const params = new URLSearchParams({
        address: testProperty.address,
        api_key: ZONEOMICS_API_KEY
      });

      const response = await fetch(`${BASE_URL}${endpoint}?${params}`, {
        headers: {
          'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY
        },
        signal: AbortSignal.timeout(15000)
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ ADDRESS LOOKUP SUCCESS!`);
        console.log(`     ${JSON.stringify(data, null, 2)}`);
      } else if (response.status !== 404) {
        const text = await response.text();
        console.log(`     ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      console.log(`     ❌ ${error.message}`);
    }
  }

  console.log('\n3️⃣ Testing POST Requests:');

  // Try POST requests which might be required
  const postEndpoints = ['/zoning', '/lookup', '/property'];

  for (const endpoint of postEndpoints) {
    try {
      console.log(`\n   Testing POST: ${BASE_URL}${endpoint}`);

      const payload = {
        latitude: testProperty.lat,
        longitude: testProperty.lon,
        address: testProperty.address,
        api_key: ZONEOMICS_API_KEY
      };

      const response = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ POST SUCCESS!`);
        console.log(`     ${JSON.stringify(data, null, 2)}`);
      } else if (response.status !== 404) {
        const text = await response.text();
        console.log(`     ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      console.log(`     ❌ ${error.message}`);
    }
  }

  console.log('\n4️⃣ Testing API Info Endpoints:');

  // Check for API info endpoints
  const infoEndpoints = ['/info', '/version', '/docs', '/health', '/status'];

  for (const endpoint of infoEndpoints) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY
        },
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`\n   ✅ ${endpoint}: ${JSON.stringify(data)}`);
      }
    } catch {
      // Ignore errors for info endpoints
    }
  }

  console.log('\n' + '=' . repeat(60));
  console.log('🎯 ZONEOMICS BASE URL TEST COMPLETE');
  console.log('=' . repeat(60));
}

testZoneomicsBase().catch(console.error);