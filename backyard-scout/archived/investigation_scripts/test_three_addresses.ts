/**
 * Test Enhanced Zoning Service with Three Specific Addresses
 */

import { getEnhancedZoning } from '../services/enhanced_zoning_service.js';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

// Test addresses with approximate coordinates
const testAddresses = [
  {
    address: "20616 Archwood St, Winnetka, CA, 91306",
    lat: 34.2047,
    lon: -118.5717,
    city: "Winnetka"
  },
  {
    address: "10921 Polaris Dr, San Diego, CA, 92126",
    lat: 32.8983,
    lon: -117.1219,
    city: "San Diego"
  },
  {
    address: "1843 S Bedford St, Los Angeles, CA, 90035",
    lat: 34.0392,
    lon: -118.3617,
    city: "Los Angeles"
  }
];

/**
 * Create a simple parcel GeoJSON from coordinates
 */
function createParcelGeojson(address: string, lat: number, lon: number) {
  // Create a small polygon around the point (approximately 50ft x 100ft lot)
  const latOffset = 0.0001; // ~30 feet
  const lonOffset = 0.0002; // ~60 feet

  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { address },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [lon - lonOffset, lat - latOffset],
          [lon + lonOffset, lat - latOffset],
          [lon + lonOffset, lat + latOffset],
          [lon - lonOffset, lat + latOffset],
          [lon - lonOffset, lat - latOffset]
        ]]
      }
    }]
  };
}

async function testThreeAddresses() {
  console.log('🏠 Testing Enhanced Zoning Service - Three Addresses');
  console.log('=' . repeat(70));

  const results: any[] = [];

  for (let i = 0; i < testAddresses.length; i++) {
    const addr = testAddresses[i];
    console.log(`\n${i + 1}️⃣ Testing: ${addr.address}`);
    console.log(`📍 Coordinates: ${addr.lat}, ${addr.lon}`);
    console.log(`🏛️ City: ${addr.city}`);
    console.log('─'.repeat(50));

    try {
      const parcelGeojson = createParcelGeojson(addr.address, addr.lat, addr.lon);
      const startTime = Date.now();

      const zoningResult = await getEnhancedZoning(parcelGeojson, ZONEOMICS_API_KEY);
      const duration = Date.now() - startTime;

      console.log(`✅ Success! (${duration}ms)`);
      console.log(`Zone Code: ${zoningResult.zone_code}`);
      console.log(`Zone Name: ${zoningResult.zone_name || 'N/A'}`);
      console.log(`Description: ${zoningResult.description || 'N/A'}`);
      console.log(`Source: ${zoningResult.source}`);
      console.log(`Verified: ${zoningResult.verified ? '✅' : '⚠️'}`);
      console.log(`City Found: ${zoningResult.city || 'N/A'}`);

      results.push({
        address: addr.address,
        city: addr.city,
        coordinates: `${addr.lat}, ${addr.lon}`,
        zone_code: zoningResult.zone_code,
        zone_name: zoningResult.zone_name,
        description: zoningResult.description,
        source: zoningResult.source,
        verified: zoningResult.verified,
        duration_ms: duration,
        success: true
      });

      // Validate result
      if (zoningResult.zone_code && zoningResult.zone_code !== 'UNKNOWN') {
        console.log(`🎯 VALID: Found zone code ${zoningResult.zone_code}`);
      } else {
        console.log(`⚠️ WARNING: No valid zone found`);
      }

    } catch (error) {
      console.log(`❌ Error: ${error}`);
      results.push({
        address: addr.address,
        city: addr.city,
        coordinates: `${addr.lat}, ${addr.lon}`,
        error: error?.toString(),
        success: false
      });
    }
  }

  // Summary
  console.log('\n' + '=' . repeat(70));
  console.log('📊 SUMMARY RESULTS');
  console.log('=' . repeat(70));

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);

  if (successful.length > 0) {
    console.log('\n🎯 Successful Zoning Results:');
    successful.forEach((result, i) => {
      console.log(`${i + 1}. ${result.address}`);
      console.log(`   Zone: ${result.zone_code} (${result.source})`);
      console.log(`   Verified: ${result.verified ? 'Yes' : 'No'} | Duration: ${result.duration_ms}ms`);
    });
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed Addresses:');
    failed.forEach((result, i) => {
      console.log(`${i + 1}. ${result.address}`);
      console.log(`   Error: ${result.error}`);
    });
  }

  // Geographic coverage analysis
  console.log('\n🗺️ Geographic Coverage Analysis:');
  const sourceBreakdown = successful.reduce((acc: any, result) => {
    acc[result.source] = (acc[result.source] || 0) + 1;
    return acc;
  }, {});

  Object.entries(sourceBreakdown).forEach(([source, count]) => {
    console.log(`${source}: ${count} address(es)`);
  });

  console.log('\n' + '=' . repeat(70));
  console.log('🏠 THREE ADDRESS ZONING TEST COMPLETE');
  console.log('=' . repeat(70));
}

testThreeAddresses().catch(console.error);