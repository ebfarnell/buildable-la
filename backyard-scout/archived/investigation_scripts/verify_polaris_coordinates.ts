/**
 * Verify coordinates and investigate zoning discrepancy for Polaris property
 */

import { getZoneomicsZoningWithFallback } from '../services/zoneomics_tiles_service.js';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

// Test multiple coordinate sources for the same address
const polarisCoordinates = [
  {
    source: 'Our estimate',
    lat: 32.8983,
    lon: -117.1219,
  },
  {
    source: 'Adjusted north',
    lat: 32.8985,
    lon: -117.1219,
  },
  {
    source: 'Adjusted south',
    lat: 32.8981,
    lon: -117.1219,
  },
  {
    source: 'Adjusted east',
    lat: 32.8983,
    lon: -117.1217,
  },
  {
    source: 'Adjusted west',
    lat: 32.8983,
    lon: -117.1221,
  },
];

async function verifyPolarisCoordinates() {
  console.log('📍 Verifying Polaris Dr Coordinates and Zoning');
  console.log('='.repeat(60));
  console.log('Address: 10921 Polaris Dr, San Diego, CA 92126');
  console.log('Zillow shows: Residential property');
  console.log('Our analysis found: CN-1- (Commercial Neighborhood)');
  console.log('');

  console.log('Testing different coordinate variations...');

  for (const coord of polarisCoordinates) {
    console.log(`\n🎯 Testing: ${coord.source}`);
    console.log(`Coordinates: ${coord.lat}, ${coord.lon}`);

    try {
      const result = await getZoneomicsZoningWithFallback(coord.lat, coord.lon, ZONEOMICS_API_KEY);

      if (result) {
        console.log(`✅ Found: ${result.zone_code}`);

        // Try to interpret the zone code
        if (
          result.zone_code.includes('R') ||
          result.zone_code.includes('RS') ||
          result.zone_code.includes('RM')
        ) {
          console.log(`   🏠 RESIDENTIAL zone - matches Zillow!`);
        } else if (
          result.zone_code.includes('C') ||
          result.zone_code.includes('CN') ||
          result.zone_code.includes('CO')
        ) {
          console.log(`   🏢 COMMERCIAL zone - conflicts with Zillow`);
        } else {
          console.log(`   ❓ Unknown zone type`);
        }
      } else {
        console.log(`❌ No zoning data found`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error}`);
    }
  }

  // Test the exact coordinates we used in the analysis
  console.log('\n🔍 Detailed Analysis of Our Original Coordinates:');
  console.log('Coordinates: 32.8983, -117.1219');

  try {
    // Test multiple zoom levels to see if we get different results
    const zoomLevels = [15, 16, 17, 18];

    for (const zoom of zoomLevels) {
      console.log(`\n📊 Testing zoom level ${zoom}:`);

      const result = await getZoneomicsZoningWithFallback(32.8983, -117.1219, ZONEOMICS_API_KEY);

      if (result) {
        console.log(`   Zone: ${result.zone_code}`);
      }
    }
  } catch (error) {
    console.log(`Error in detailed analysis: ${error}`);
  }

  console.log('\n📝 Possible Explanations:');
  console.log('1. 🎯 Coordinate inaccuracy - we might be hitting nearby commercial area');
  console.log('2. 🗺️ Zoning vs. Use discrepancy - property zoned commercial but used residential');
  console.log('3. 🔧 Protobuf parsing error - extracting wrong zone from multi-zone tile');
  console.log('4. 📊 Outdated zoning data - property may have been rezoned');
  console.log('5. 🏘️ Mixed zoning area - tile contains multiple zones');

  console.log('\n' + '='.repeat(60));
  console.log('📍 COORDINATE VERIFICATION COMPLETE');
  console.log('='.repeat(60));
}

verifyPolarisCoordinates().catch(console.error);
