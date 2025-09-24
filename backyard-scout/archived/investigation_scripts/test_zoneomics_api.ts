/**
 * Test Zoneomics API with user's API key
 */

import { fetch } from 'undici';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

// Test property: 1618 Burning Tree Dr, Thousand Oaks, CA 91362
const testProperty = {
  address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
  lat: 34.212931,
  lon: -118.848476,
  apn: '570019111',
};

async function testZoneomicsAPI() {
  console.log('🌟 Testing Zoneomics API with User Key');
  console.log('='.repeat(60));
  console.log(`Property: ${testProperty.address}`);
  console.log(`Coordinates: ${testProperty.lat}, ${testProperty.lon}`);

  // Common API base URLs to try
  const possibleBases = [
    'https://api.zoneomics.com',
    'https://api.zoneomics.com/v2',
    'https://zoneomics.com/api',
    'https://zoneomics.com/api/v2',
    'https://app.zoneomics.com/api',
    'https://app.zoneomics.com/api/v2',
  ];

  // Common endpoint patterns
  const endpointPatterns = ['/zoning', '/zone', '/property', '/lookup', '/search', '/query'];

  console.log('\n1️⃣ Testing API Base URLs:');

  for (const base of possibleBases) {
    try {
      console.log(`\n   Testing: ${base}`);

      // Test basic connectivity
      const response = await fetch(`${base}`, {
        headers: {
          Authorization: `Bearer ${ZONEOMICS_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        try {
          const data = await response.json();
          console.log(`     ✅ Response received: ${JSON.stringify(data).substring(0, 100)}...`);
        } catch {
          const text = await response.text();
          console.log(`     Response text: ${text.substring(0, 100)}...`);
        }
      } else if (response.status === 401) {
        console.log(`     🔑 Auth required - this might be the right base URL`);
      } else if (response.status === 404) {
        console.log(`     ❌ Not found`);
      } else {
        console.log(`     ⚠️ Status ${response.status}`);
      }
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        console.log(`     ⏱️ Timeout`);
      } else {
        console.log(`     ❌ Error: ${error.message}`);
      }
    }
  }

  console.log('\n2️⃣ Testing Common Endpoint Patterns:');

  // Try most promising base with different endpoints
  const baseUrl = 'https://api.zoneomics.com/v2';

  for (const endpoint of endpointPatterns) {
    console.log(`\n   Testing: ${baseUrl}${endpoint}`);

    // Test with coordinates
    try {
      const params = new URLSearchParams({
        lat: testProperty.lat.toString(),
        lon: testProperty.lon.toString(),
        lng: testProperty.lon.toString(), // Some APIs use lng instead of lon
        longitude: testProperty.lon.toString(),
        latitude: testProperty.lat.toString(),
      });

      const response = await fetch(`${baseUrl}${endpoint}?${params}`, {
        headers: {
          Authorization: `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ SUCCESS! Found data:`);
        console.log(`     ${JSON.stringify(data, null, 2).substring(0, 500)}...`);

        // Look for zoning-related fields
        const zoneFields = ['zone', 'zoning', 'zone_class', 'zone_code', 'district'];
        for (const field of zoneFields) {
          if (data[field]) {
            console.log(`     🎯 ZONING FOUND: ${field} = ${data[field]}`);
          }
        }
      } else {
        const text = await response.text();
        console.log(`     Response: ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        console.log(`     ⏱️ Timeout`);
      } else {
        console.log(`     ❌ ${error.message}`);
      }
    }
  }

  console.log('\n3️⃣ Testing Address-Based Queries:');

  // Try address-based queries
  const addressEndpoints = [
    `/zoning?address=${encodeURIComponent(testProperty.address)}`,
    `/lookup?address=${encodeURIComponent(testProperty.address)}`,
    `/property?address=${encodeURIComponent(testProperty.address)}`,
    `/search?q=${encodeURIComponent(testProperty.address)}`,
  ];

  for (const endpoint of addressEndpoints) {
    try {
      console.log(`\n   Testing: ${baseUrl}${endpoint}`);

      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${ZONEOMICS_API_KEY}`,
          'X-API-Key': ZONEOMICS_API_KEY,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      console.log(`     Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`     ✅ SUCCESS! Address lookup worked:`);
        console.log(`     ${JSON.stringify(data, null, 2).substring(0, 300)}...`);
      } else {
        console.log(`     Status: ${response.status}`);
      }
    } catch (error: any) {
      console.log(`     ❌ ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎯 ZONEOMICS API TEST COMPLETE');
  console.log('='.repeat(60));
  console.log('Look for ✅ SUCCESS messages above for working endpoints!');
}

testZoneomicsAPI().catch(console.error);
