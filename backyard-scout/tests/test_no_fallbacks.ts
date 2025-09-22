#!/usr/bin/env tsx
/**
 * Test script to verify NO FALLBACKS exist
 * Ensures only real data is used, no estimates
 */

import { getBuildingFootprints } from '../src/services/building_footprints_enhanced.js';
import { getEnhancedZoning } from '../src/services/zoning_enhanced.js';

const TEST_PROPERTIES = [
  {
    address: '20616 Archwood St, Winnetka, CA 91306',
    county: 'LOS ANGELES',
    apn: '2148020015',
    geometry: {
      rings: [
        [
          [-118.582767, 34.191297],
          [-118.582568, 34.191297],
          [-118.582568, 34.191641],
          [-118.582767, 34.191641],
          [-118.582767, 34.191297],
        ],
      ],
    },
  },
  {
    address: '10921 Polaris Dr, San Diego, CA 92126',
    county: 'SAN DIEGO',
    apn: '3181941500',
    geometry: {
      rings: [
        [
          [-117.131535, 32.917926],
          [-117.131204, 32.917926],
          [-117.131204, 32.918071],
          [-117.131535, 32.918071],
          [-117.131535, 32.917926],
        ],
      ],
    },
  },
  {
    address: '1843 S Bedford St, Los Angeles, CA 90035',
    county: 'LOS ANGELES',
    apn: '4303015010',
    geometry: {
      rings: [
        [
          [-118.383144, 34.044247],
          [-118.382685, 34.044247],
          [-118.382685, 34.04453],
          [-118.383144, 34.04453],
          [-118.383144, 34.044247],
        ],
      ],
    },
  },
];

async function testNoFallbacks() {
  console.log('================================================');
  console.log('🧪 TESTING: NO FALLBACK VERIFICATION');
  console.log('================================================\n');

  let allPassed = true;

  for (const property of TEST_PROPERTIES) {
    console.log(`\n📍 Testing: ${property.address}`);
    console.log('----------------------------------------');

    // Test Building Footprints
    console.log('\n1. BUILDING FOOTPRINTS TEST:');
    try {
      const buildings = await getBuildingFootprints(
        property.geometry,
        property.county,
        property.apn,
      );

      if (buildings.length === 0) {
        console.log('   ✅ PASS: Returned empty array (no fallback estimate)');
      } else {
        // Check that none of the buildings are estimates
        const hasEstimate = buildings.some(
          (b) =>
            b.source.includes('ESTIMATE') ||
            b.source.includes('FALLBACK') ||
            b.source.includes('DEFAULT'),
        );

        if (hasEstimate) {
          console.log('   ❌ FAIL: Found estimated data in results');
          console.log(`   Sources: ${buildings.map((b) => b.source).join(', ')}`);
          allPassed = false;
        } else {
          console.log('   ✅ PASS: All data from real sources');
          console.log(`   Sources: ${[...new Set(buildings.map((b) => b.source))].join(', ')}`);
          console.log(`   Buildings found: ${buildings.length}`);
        }
      }
    } catch (error: any) {
      console.log(`   ❌ ERROR: ${error.message}`);
      allPassed = false;
    }

    // Test Zoning
    console.log('\n2. ZONING DATA TEST:');
    try {
      const parcelGeoJson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: property.geometry.rings,
            },
            properties: {},
          },
        ],
      };

      const zoning = await getEnhancedZoning(parcelGeoJson, property.county);

      if (zoning === null) {
        console.log('   ✅ PASS: Returned null (no fallback defaults)');
      } else {
        // Check that zoning is not an estimate
        const isEstimate =
          zoning.source.includes('estimate') ||
          zoning.source.includes('fallback') ||
          zoning.source.includes('default') ||
          zoning.zone_code === 'UNKNOWN';

        if (isEstimate) {
          console.log('   ❌ FAIL: Found estimated/default zoning data');
          console.log(`   Source: ${zoning.source}`);
          console.log(`   Zone: ${zoning.zone_code}`);
          allPassed = false;
        } else {
          console.log('   ✅ PASS: Real zoning data found');
          console.log(`   Source: ${zoning.source}`);
          console.log(`   Zone: ${zoning.zone_code}`);
          if (zoning.setbacks) {
            console.log(
              `   Setbacks: F${zoning.setbacks.front}' S${zoning.setbacks.side}' R${zoning.setbacks.rear}'`,
            );
          }
        }
      }
    } catch (error: any) {
      console.log(`   ❌ ERROR: ${error.message}`);
      allPassed = false;
    }
  }

  // Final Summary
  console.log('\n================================================');
  console.log('📊 TEST SUMMARY');
  console.log('================================================');

  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - No fallbacks detected');
    console.log('✅ System is using only real data sources');
  } else {
    console.log('❌ TESTS FAILED - Fallbacks or estimates detected');
    console.log('⚠️  Review the results above for details');
  }

  console.log('\n📋 KEY VERIFICATION POINTS:');
  console.log('   • Building data returns empty array if no real data');
  console.log('   • Zoning returns null if no real data');
  console.log('   • No "ESTIMATED", "FALLBACK", or "DEFAULT" sources');
  console.log('   • No "UNKNOWN" zone codes with default values');
  console.log('   • All data must come from verified API sources');

  return allPassed;
}

// Run tests
testNoFallbacks()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
