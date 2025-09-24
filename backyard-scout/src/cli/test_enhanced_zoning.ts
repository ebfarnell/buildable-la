/**
 * Test the Enhanced Zoning Service with fallback capabilities
 */

import { getEnhancedZoning } from '../services/enhanced_zoning_service.js';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

// Test property GeoJSON
const testParcelGeojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-118.849, 34.212],
            [-118.848, 34.212],
            [-118.848, 34.213],
            [-118.849, 34.213],
            [-118.849, 34.212],
          ],
        ],
      },
    },
  ],
};

async function testEnhancedZoning() {
  console.log('🧪 Testing Enhanced Zoning Service');
  console.log('='.repeat(60));
  console.log('Property: 1618 Burning Tree Dr, Thousand Oaks, CA 91362');

  try {
    console.log('\n🔍 Running enhanced zoning lookup...');

    const startTime = Date.now();
    const result = await getEnhancedZoning(testParcelGeojson, ZONEOMICS_API_KEY);
    const duration = Date.now() - startTime;

    console.log('\n🎉 Enhanced Zoning Result:');
    console.log('─'.repeat(50));
    console.log(`Zone Code: ${result.zone_code}`);
    console.log(`Zone Name: ${result.zone_name || 'N/A'}`);
    console.log(`Zone Type: ${result.zone_type || 'N/A'}`);
    console.log(`Description: ${result.description || 'N/A'}`);
    console.log(`Source: ${result.source}`);
    console.log(`Verified: ${result.verified ? '✅' : '⚠️'}`);
    console.log(`City: ${result.city || 'N/A'}`);
    console.log(`Retrieved: ${result.retrieved_at}`);
    console.log(`Checksum: ${result.checksum}`);
    console.log(`Duration: ${duration}ms`);
    console.log('─'.repeat(50));

    // Validate the result
    if (result.zone_code && result.zone_code !== 'UNKNOWN') {
      console.log('\n✅ SUCCESS: Valid zone code retrieved!');
      console.log(`🏆 Property is zoned: ${result.zone_code}`);

      if (result.source === 'arcgis_layers') {
        console.log('📍 Source: Local ArcGIS layers (LOCAL-FIRST approach)');
      } else if (result.source === 'zoneomics_tiles') {
        console.log('🗺️ Source: Zoneomics tiles API (fallback)');
      } else if (result.source === 'local_estimate') {
        console.log('🔍 Source: Local estimate (fallback)');
      } else if (result.source === 'cache') {
        console.log('📦 Source: Cached result (deterministic)');
      }
    } else {
      console.log('\n⚠️ WARNING: No valid zone code found');
    }

    // Test caching by running again
    console.log('\n🔄 Testing cache (running same query again)...');
    const cachedStartTime = Date.now();
    const cachedResult = await getEnhancedZoning(testParcelGeojson, ZONEOMICS_API_KEY);
    const cachedDuration = Date.now() - cachedStartTime;

    if (cachedResult.source === 'cache') {
      console.log(`✅ Cache working! Cached lookup took ${cachedDuration}ms vs ${duration}ms`);
      console.log(`🔍 Cached zone: ${cachedResult.zone_code}`);
    } else {
      console.log('⚠️ Cache not working as expected');
    }
  } catch (error) {
    console.error('\n❌ Error testing enhanced zoning:', error);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🧪 ENHANCED ZONING TEST COMPLETE');
  console.log('='.repeat(60));
}

testEnhancedZoning().catch(console.error);
