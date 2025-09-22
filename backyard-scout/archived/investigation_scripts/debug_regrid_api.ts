/**
 * Debug Regrid API to understand why we're not getting data
 */

import { fetch } from 'undici';

const API_KEY =
  'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJyZWdyaWQuY29tIiwiaWF0IjoxNzU4MzI3MzM3LCJleHAiOjE3NjA5MTkzMzcsInUiOjU5MTY5OCwiZyI6MjMxNTMsImNhcCI6InBhOnRzOnBzOmJmOm1hOnR5OmVvOnpvOnNiIn0.ajlbLQRjQCDSfd_aq7eNEuON_V_dMmWPXaYpO5ObN-0';

async function debugRegridAPI() {
  console.log('🔍 Debugging Regrid API Integration');
  console.log('='.repeat(60));

  // Test 1: Basic API connectivity
  console.log('\n1️⃣ Testing Basic API Connectivity:');
  try {
    const response = await fetch(
      `https://app.regrid.com/api/v2/parcels/query?token=${API_KEY}&limit=1`,
    );
    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      const data = (await response.json()) as any;
      console.log(`   ✅ API Connected`);
      console.log(`   Sample Response Keys: ${Object.keys(data)}`);
      console.log(`   Total Parcels Available: ${data.parcels?.length || 0}`);
      if (data.parcels?.[0]) {
        const sample = data.parcels[0];
        console.log(`   Sample Fields: ${Object.keys(sample).slice(0, 10).join(', ')}`);
      }
    } else {
      console.log(`   ❌ API Error: ${response.status}`);
      const text = await response.text();
      console.log(`   Response: ${text.substring(0, 200)}`);
    }
  } catch (error) {
    console.log(`   ❌ Connection Error: ${error}`);
  }

  // Test 2: Search by coordinates (known to work from examples)
  console.log('\n2️⃣ Testing Coordinate Search (Thousand Oaks area):');
  try {
    // Coordinates for 1618 Burning Tree Dr
    const lat = 34.212931;
    const lon = -118.848476;

    const response = await fetch(
      `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lon}&token=${API_KEY}`,
    );

    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      const data = (await response.json()) as any;
      console.log(`   ✅ Found ${data.parcels?.length || 0} parcels at coordinates`);

      if (data.parcels?.[0]) {
        const parcel = data.parcels[0];
        console.log(`   APN: ${parcel.parcelnumb || 'N/A'}`);
        console.log(`   Address: ${parcel.situs || 'N/A'}`);
        console.log(`   Zoning: ${parcel.zoning || 'N/A'}`);
        console.log(`   County: ${parcel.county || 'N/A'}`);
        console.log(`   State: ${parcel.state2 || 'N/A'}`);
      }
    } else {
      console.log(`   ❌ Error: ${response.status}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  // Test 3: Search by address
  console.log('\n3️⃣ Testing Address Search:');
  try {
    const address = encodeURIComponent('1618 Burning Tree Dr');
    const path = encodeURIComponent('/us/ca/ventura/thousand-oaks');

    const response = await fetch(
      `https://app.regrid.com/api/v2/parcels/address?query=${address}&path=${path}&token=${API_KEY}`,
    );

    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      const data = (await response.json()) as any;
      console.log(`   ✅ Found ${data.parcels?.length || 0} parcels by address`);

      if (data.parcels?.[0]) {
        const parcel = data.parcels[0];
        console.log(`   APN: ${parcel.parcelnumb || 'N/A'}`);
        console.log(`   Zoning: ${parcel.zoning || 'N/A'}`);
      }
    } else {
      console.log(`   ❌ Error: ${response.status}`);
      const text = await response.text();
      console.log(`   Response: ${text.substring(0, 200)}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  // Test 4: Try different APN formats
  console.log('\n4️⃣ Testing Different APN Formats:');
  const apnVariations = [
    '570019111', // Original
    '570-019-111', // With dashes
    '57-001-9111', // Different dash pattern
    '5700-19-111', // Another pattern
  ];

  for (const apn of apnVariations) {
    try {
      console.log(`   Testing APN: ${apn}`);

      const response = await fetch(
        `https://app.regrid.com/api/v2/parcels/query?token=${API_KEY}&fields[parcelnumb][eq]=${encodeURIComponent(apn)}`,
      );

      if (response.ok) {
        const data = (await response.json()) as any;
        console.log(`     Found: ${data.parcels?.length || 0} parcels`);

        if (data.parcels?.[0]) {
          const parcel = data.parcels[0];
          console.log(
            `     ✅ Match! APN: ${parcel.parcelnumb}, Zoning: ${parcel.zoning || 'N/A'}`,
          );
        }
      } else {
        console.log(`     Status: ${response.status}`);
      }
    } catch (error) {
      console.log(`     Error: ${error}`);
    }
  }

  // Test 5: Search in broader Ventura County
  console.log('\n5️⃣ Testing Broader County Search:');
  try {
    const response = await fetch(
      `https://app.regrid.com/api/v2/parcels/query?token=${API_KEY}&fields[county][ilike]=ventura&limit=5`,
    );

    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      const data = (await response.json()) as any;
      console.log(`   ✅ Found ${data.parcels?.length || 0} parcels in Ventura County`);

      if (data.parcels?.length > 0) {
        console.log('   Sample Ventura County parcels:');
        data.parcels.slice(0, 3).forEach((parcel: any, i: number) => {
          console.log(
            `     ${i + 1}. APN: ${parcel.parcelnumb}, City: ${parcel.cityname}, Zoning: ${parcel.zoning || 'N/A'}`,
          );
        });
      }
    } else {
      console.log(`   ❌ Error: ${response.status}`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  // Test 6: Check account limits
  console.log('\n6️⃣ Checking Account Status:');
  try {
    const response = await fetch(`https://app.regrid.com/api/v2/account?token=${API_KEY}`);

    if (response.ok) {
      const data = (await response.json()) as any;
      console.log(`   ✅ Account Active`);
      console.log(`   Plan: ${data.plan || 'Unknown'}`);
      console.log(`   Usage: ${data.usage || 'Unknown'}`);
    } else {
      console.log(`   Status: ${response.status}`);
    }
  } catch (error) {
    console.log(`   Account check failed: ${error}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎯 DIAGNOSIS COMPLETE');
  console.log('='.repeat(60));
}

debugRegridAPI().catch(console.error);
