/**
 * Test the updated building footprint service with OSM as priority 1
 */

import { getBuildingFootprints } from '../services/building_footprints_deterministic.js';

// Test properties with their real parcel geometries
const testProperties = [
  {
    name: '20616 Archwood St, Winnetka, CA',
    county: 'LOS ANGELES',
    apn: '2148020015',
    // Approximate parcel geometry for Winnetka property
    geometry: {
      rings: [
        [
          [-118.5718, 34.2046],
          [-118.5716, 34.2046],
          [-118.5716, 34.2048],
          [-118.5718, 34.2048],
          [-118.5718, 34.2046],
        ],
      ],
    },
  },
  {
    name: '10921 Polaris Dr, San Diego, CA',
    county: 'SAN DIEGO',
    apn: '3181941500',
    geometry: {
      rings: [
        [
          [-117.122, 32.8982],
          [-117.1218, 32.8982],
          [-117.1218, 32.8984],
          [-117.122, 32.8984],
          [-117.122, 32.8982],
        ],
      ],
    },
  },
  {
    name: '1843 S Bedford St, Los Angeles, CA',
    county: 'LOS ANGELES',
    apn: '4303015010',
    geometry: {
      rings: [
        [
          [-118.3618, 34.0391],
          [-118.3616, 34.0391],
          [-118.3616, 34.0393],
          [-118.3618, 34.0393],
          [-118.3618, 34.0391],
        ],
      ],
    },
  },
];

async function testUpdatedBuildingService() {
  console.log('🏗️ Testing Updated Building Footprint Service');
  console.log('='.repeat(60));
  console.log('Expected: OSM data instead of estimates');

  for (const property of testProperties) {
    console.log(`\n📍 Testing: ${property.name}`);
    console.log(`County: ${property.county}, APN: ${property.apn}`);

    try {
      const startTime = Date.now();
      const buildings = await getBuildingFootprints(
        property.geometry,
        property.county,
        property.apn,
      );
      const duration = Date.now() - startTime;

      console.log(`Duration: ${duration}ms`);
      console.log(`Buildings found: ${buildings.length}`);

      if (buildings.length > 0) {
        buildings.forEach((building, i) => {
          console.log(`  Building ${i + 1}:`);
          console.log(`    ID: ${building.id}`);
          console.log(`    Area: ${building.area_sqft.toLocaleString()} sqft`);
          console.log(`    Source: ${building.source}`);
          console.log(`    Retrieved: ${building.retrieved_at}`);
          console.log(`    Checksum: ${building.checksum}`);
        });

        const totalArea = buildings.reduce((sum, b) => sum + b.area_sqft, 0);
        console.log(`✅ Total building area: ${totalArea.toLocaleString()} sqft`);

        // Check if we got real data vs estimates
        const hasRealData = buildings.some((b) => b.source === 'OSM');
        const hasEstimates = buildings.some(
          (b) => b.source === 'ESTIMATED' || b.source === 'ESTIMATED_FALLBACK',
        );

        if (hasRealData) {
          console.log(`🎯 SUCCESS: Got real OSM building data!`);
        } else if (hasEstimates) {
          console.log(`⚠️ Still using estimates - OSM query may have failed`);
        }
      } else {
        console.log(`❌ No buildings found`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏗️ UPDATED BUILDING SERVICE TEST COMPLETE');
  console.log('='.repeat(60));
}

testUpdatedBuildingService().catch(console.error);
