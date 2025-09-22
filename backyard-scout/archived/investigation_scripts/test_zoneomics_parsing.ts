/**
 * Test the new Zoneomics tiles parsing service
 */

import { getZoneomicsZoningWithFallback } from '../services/zoneomics_tiles_service.js';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

const testProperty = {
  address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362',
  lat: 34.212931,
  lon: -118.848476
};

async function testZoneomicsParsing() {
  console.log('🧪 Testing Zoneomics Tiles Parsing Service');
  console.log('=' . repeat(60));
  console.log(`Property: ${testProperty.address}`);
  console.log(`Coordinates: ${testProperty.lat}, ${testProperty.lon}`);

  try {
    console.log('\n🔍 Fetching zoning data from Zoneomics tiles...');

    const zoningResult = await getZoneomicsZoningWithFallback(
      testProperty.lat,
      testProperty.lon,
      ZONEOMICS_API_KEY
    );

    if (zoningResult) {
      console.log('\n🎉 SUCCESS! Extracted zoning data:');
      console.log('─'.repeat(40));
      console.log(`Zone Code: ${zoningResult.zone_code}`);
      console.log(`Zone Name: ${zoningResult.zone_name || 'N/A'}`);
      console.log(`Zone Type: ${zoningResult.zone_type || 'N/A'}`);
      console.log(`Zone Sub-Type: ${zoningResult.zone_sub_type || 'N/A'}`);
      console.log(`Source: ${zoningResult.source}`);
      console.log('─'.repeat(40));

      // Validate the result
      if (zoningResult.zone_code && zoningResult.zone_code !== 'UNKNOWN') {
        console.log('\n✅ VALIDATION: Found valid zone code!');
        console.log(`🏆 1618 Burning Tree Dr is zoned: ${zoningResult.zone_code}`);
      } else {
        console.log('\n⚠️ VALIDATION: Zone code not extracted properly');
      }
    } else {
      console.log('\n❌ No zoning data found');
      console.log('This could mean:');
      console.log('- Property is outside Zoneomics coverage area');
      console.log('- Protobuf parsing needs adjustment');
      console.log('- API returned empty tiles');
    }

  } catch (error) {
    console.error('\n❌ Error testing Zoneomics parsing:', error);
  }

  console.log('\n' + '=' . repeat(60));
  console.log('🧪 ZONEOMICS PARSING TEST COMPLETE');
  console.log('=' . repeat(60));
}

testZoneomicsParsing().catch(console.error);