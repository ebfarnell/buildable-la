/**
 * Test which areas ARE included in Regrid trial
 */

import { fetch } from 'undici';

const API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJyZWdyaWQuY29tIiwiaWF0IjoxNzU4MzI3MzM3LCJleHAiOjE3NjA5MTkzMzcsInUiOjU5MTY5OCwiZyI6MjMxNTMsImNhcCI6InBhOnRzOnBzOmJmOm1hOnR5OmVvOnpvOnNiIn0.ajlbLQRjQCDSfd_aq7eNEuON_V_dMmWPXaYpO5ObN-0';

// Test locations likely to be in trial (major metro areas)
const testLocations = [
  { name: 'Los Angeles County', lat: 34.0522, lon: -118.2437, county: 'Los Angeles' },
  { name: 'Orange County', lat: 33.7175, lon: -117.8311, county: 'Orange' },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194, county: 'San Francisco' },
  { name: 'New York City', lat: 40.7128, lon: -74.0060, county: 'New York' },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298, county: 'Cook' },
  { name: 'Miami-Dade', lat: 25.7617, lon: -80.1918, county: 'Miami-Dade' },
  { name: 'King County (Seattle)', lat: 47.6062, lon: -122.3321, county: 'King' },
];

async function testTrialAreas() {
  console.log('🗺️ Testing Which Areas Are Included in Regrid Trial');
  console.log('=' . repeat(60));

  for (const location of testLocations) {
    console.log(`\n📍 Testing: ${location.name}`);

    try {
      // Test coordinate search
      const response = await fetch(
        `https://app.regrid.com/api/v2/parcels/point?lat=${location.lat}&lon=${location.lon}&token=${API_KEY}`
      );

      console.log(`   Status: ${response.status}`);

      if (response.status === 200) {
        const data = await response.json() as any;
        const parcelCount = data.parcels?.length || 0;
        console.log(`   ✅ INCLUDED - Found ${parcelCount} parcels`);

        if (parcelCount > 0) {
          const sample = data.parcels[0];
          console.log(`      Sample APN: ${sample.parcelnumb || 'N/A'}`);
          console.log(`      Zoning: ${sample.zoning || 'N/A'}`);
          console.log(`      County: ${sample.county || 'N/A'}`);
          console.log(`      State: ${sample.state2 || 'N/A'}`);
        }
      } else if (response.status === 403) {
        const errorData = await response.json() as any;
        if (errorData.message?.includes('not included in API trials')) {
          console.log(`   ❌ NOT INCLUDED in trial`);
        } else {
          console.log(`   ❌ 403 Error: ${errorData.message || 'Unknown'}`);
        }
      } else {
        console.log(`   ❌ Error: ${response.status}`);
      }
    } catch (error) {
      console.log(`   ❌ Request failed: ${error}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '=' . repeat(60));
  console.log('🎯 TRIAL COVERAGE ANALYSIS COMPLETE');
  console.log('=' . repeat(60));
  console.log('Areas marked as ✅ INCLUDED have trial data access');
  console.log('Areas marked as ❌ NOT INCLUDED require paid subscription');
}

testTrialAreas().catch(console.error);