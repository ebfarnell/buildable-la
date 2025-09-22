#!/usr/bin/env tsx
/**
 * Test script to verify building footprints and zoning APIs are working
 */

import { getBuildingFootprints } from './src/services/building_footprints_deterministic.js';
import { getEnhancedZoning } from './src/services/enhanced_zoning_service.js';

// Test property: 1843 S Bedford St, Los Angeles, CA 90035
const TEST_GEOMETRY = {
  rings: [[
    [-118.3896, 34.0522],
    [-118.3895, 34.0522],
    [-118.3895, 34.0521],
    [-118.3896, 34.0521],
    [-118.3896, 34.0522]
  ]]
};

async function testBuildingAPI() {
  console.log('\n🔍 Testing Building Footprints API...');
  console.log('----------------------------------------');

  try {
    const buildings = await getBuildingFootprints(
      TEST_GEOMETRY,
      'LOS ANGELES',
      '4303015010'
    );

    console.log(`✅ SUCCESS: Retrieved ${buildings.length} building(s)`);

    for (const building of buildings) {
      console.log(`   - ID: ${building.id}`);
      console.log(`     Area: ${building.area_sqft.toLocaleString()} sqft`);
      console.log(`     Source: ${building.source}`);
    }
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
  }
}

async function testZoningAPI() {
  console.log('\n🔍 Testing Enhanced Zoning API...');
  console.log('----------------------------------------');

  const parcelGeoJson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: TEST_GEOMETRY.rings
      },
      properties: {}
    }]
  };

  try {
    const zoning = await getEnhancedZoning(parcelGeoJson);

    console.log(`✅ SUCCESS: Retrieved zoning data`);
    console.log(`   - Zone Code: ${zoning.zone_code}`);
    console.log(`   - Zone Name: ${zoning.zone_name || 'N/A'}`);
    console.log(`   - Source: ${zoning.source}`);
    console.log(`   - Verified: ${zoning.verified}`);
  } catch (error: any) {
    console.log(`❌ FAILED: ${error.message}`);
  }
}

async function main() {
  console.log('====================================');
  console.log('API SERVICE TEST - BUILDING & ZONING');
  console.log('====================================');

  await testBuildingAPI();
  await testZoningAPI();

  console.log('\n====================================');
  console.log('TEST COMPLETE');
  console.log('====================================\n');
}

main().catch(console.error);