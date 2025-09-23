#!/usr/bin/env tsx
/**
 * Test script for Unified Building Detector
 * Tests building detection across various California counties
 */

import { detectBuildings, clearBuildingCache } from './services/unified_building_detector.js';
import { fetch } from 'undici';

// Test addresses across different counties
const TEST_ADDRESSES = [
  {
    address: '20616 Archwood St, Winnetka, CA 91306',
    county: 'LOS ANGELES',
    expectedBuildings: true,
  },
  {
    address: '10921 Polaris Dr, San Diego, CA 92126',
    county: 'SAN DIEGO',
    expectedBuildings: true,
  },
  {
    address: '123 Main St, San Francisco, CA 94105',
    county: 'SAN FRANCISCO',
    expectedBuildings: true,
  },
  {
    address: '456 Oak Ave, Orange, CA 92866',
    county: 'ORANGE',
    expectedBuildings: true,
  },
  {
    address: '789 Pine Rd, Ventura, CA 93001',
    county: 'VENTURA',
    expectedBuildings: true,
  },
];

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

async function getParcelGeometry(address: string): Promise<{ geometry: any; apn: string } | null> {
  console.log(`\n🔍 Fetching parcel for: ${address}`);

  // Parse address
  const match = address.match(/(\d+)\s+(.+?)\s*,\s*([^,]+)\s*,\s*CA/i);
  if (!match) {
    console.log('   ❌ Cannot parse address');
    return null;
  }

  const [_, streetNum, streetName, _city] = match;
  const streetParts = streetName
    .replace(
      /\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Pl|Place|Ct|Court|Blvd|Boulevard)$/i,
      '',
    )
    .trim()
    .split(/\s+/)
    .map((part) => part.toUpperCase());

  const searchTerms = [`%${streetNum}%`];
  streetParts.forEach((part) => searchTerms.push(`%${part}%`));
  const searchQuery = `SITE_ADDR LIKE '${searchTerms.join('')}'`;

  const params = new URLSearchParams({
    f: 'json',
    where: searchQuery,
    outFields: 'PARCEL_APN,COUNTYNAME,SITE_ADDR',
    returnGeometry: 'true',
    resultRecordCount: '5',
  });

  try {
    const response = await fetch(`${CA_PARCELS_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as any;

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      console.log(`   ✅ Found parcel: ${feature.attributes.PARCEL_APN}`);
      return {
        geometry: feature.geometry,
        apn: feature.attributes.PARCEL_APN,
      };
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  console.log('   ❌ No parcel found');
  return null;
}

async function testAddress(test: (typeof TEST_ADDRESSES)[0]): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`📍 Testing: ${test.address}`);
  console.log(`   County: ${test.county}`);
  console.log('='.repeat(60));

  // Get parcel geometry
  const parcelData = await getParcelGeometry(test.address);

  if (!parcelData) {
    console.log('⚠️  Skipping - no parcel data found\n');
    return;
  }

  // Test building detection
  console.log('\n📊 Building Detection Results:');

  try {
    // Test without cache
    const result1 = await detectBuildings(parcelData.geometry, parcelData.apn, test.county, {
      skipCache: true,
    });

    console.log(`   Buildings: ${result1.buildings.length}`);
    console.log(`   Total Area: ${result1.total_area_sqft.toLocaleString()} sqft`);
    console.log(`   Lot Coverage: ${result1.lot_coverage_percent.toFixed(1)}%`);
    console.log(`   Detection Method: ${result1.detection_method}`);
    console.log(`   Data Quality: ${result1.data_quality}`);
    console.log(`   Confidence: ${(result1.confidence_score * 100).toFixed(0)}%`);
    console.log(`   Sources Checked: ${result1.sources_checked.join(', ')}`);

    // Test with cache (should be faster)
    console.log('\n   Testing cache...');
    const start = Date.now();
    const result2 = await detectBuildings(parcelData.geometry, parcelData.apn, test.county);
    const cacheTime = Date.now() - start;

    if (result2.cache_hit) {
      console.log(`   ✅ Cache working (${cacheTime}ms)`);
    } else {
      console.log(`   ⚠️  Cache miss (${cacheTime}ms)`);
    }

    // Verify results match
    if (result1.total_area_sqft === result2.total_area_sqft) {
      console.log('   ✅ Results consistent');
    } else {
      console.log('   ❌ Results inconsistent!');
    }

    // Check if real data was found
    if (result1.data_quality === 'high' || result1.data_quality === 'medium') {
      console.log('   ✅ Real building data found');
    } else if (result1.data_quality === 'low') {
      console.log('   ⚠️  Limited building data');
    } else {
      console.log('   ⚠️  Using estimated data');
    }
  } catch (error: any) {
    console.log(`   ❌ Detection failed: ${error.message}`);
  }
}

async function main() {
  console.log('🏢 UNIFIED BUILDING DETECTOR TEST SUITE');
  console.log('📅 ' + new Date().toLocaleString());

  // Clear cache for clean testing
  console.log('\n🧹 Clearing cache...');
  await clearBuildingCache();

  // Test each address
  for (const test of TEST_ADDRESSES) {
    await testAddress(test);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Test suite complete');
  console.log('='.repeat(60));
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
