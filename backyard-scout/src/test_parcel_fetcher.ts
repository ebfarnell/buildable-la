#!/usr/bin/env tsx
/**
 * Test the robust parcel fetcher with sample properties
 */

import { fetchParcelBoundary, fetchMultipleParcels, clearCache } from './services/parcel_fetcher';

const TEST_ADDRESSES = [
  '20616 Archwood St, Winnetka, CA 91306',
  '10921 Polaris Dr, San Diego, CA 92126',
  '1843 S Bedford St, Los Angeles, CA 90035',
];

async function testSingleFetch() {
  console.log('='.repeat(70));
  console.log('TESTING SINGLE PARCEL FETCH');
  console.log('='.repeat(70));

  for (const address of TEST_ADDRESSES) {
    const result = await fetchParcelBoundary(address, {
      useCache: true,
      timeout: 20000,
      retries: 2,
    });

    if (result) {
      console.log(`\n✅ SUCCESS: ${address}`);
      console.log(`   APN: ${result.apn}`);
      console.log(`   County: ${result.county}`);
      console.log(`   Area: ${result.area_sqft.toLocaleString()} sqft`);
      console.log(`   Source: ${result.source}`);
      console.log(`   Geometry: ${result.geometry ? 'Yes (polygon)' : 'No'}`);
      console.log(`   Cached: ${result.cached ? 'Yes' : 'No'}`);
    } else {
      console.log(`\n❌ FAILED: ${address}`);
    }
  }
}

async function testBatchFetch() {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING BATCH PARCEL FETCH');
  console.log('='.repeat(70));

  const results = await fetchMultipleParcels(TEST_ADDRESSES, {
    useCache: true,
    timeout: 15000,
    retries: 1,
  });

  console.log('\nBatch Results:');
  for (const [address, result] of results) {
    if (result) {
      console.log(`✅ ${address.substring(0, 30)}... - ${result.area_sqft.toLocaleString()} sqft`);
    } else {
      console.log(`❌ ${address.substring(0, 30)}... - Failed`);
    }
  }
}

async function testCachePerformance() {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING CACHE PERFORMANCE');
  console.log('='.repeat(70));

  const address = TEST_ADDRESSES[0];

  // First fetch (no cache)
  console.log('\n1st fetch (no cache):');
  const start1 = Date.now();
  await fetchParcelBoundary(address, { useCache: false });
  const time1 = Date.now() - start1;
  console.log(`   Time: ${time1}ms`);

  // Second fetch (with cache)
  console.log('\n2nd fetch (with cache):');
  const start2 = Date.now();
  const cached = await fetchParcelBoundary(address, { useCache: true });
  const time2 = Date.now() - start2;
  console.log(`   Time: ${time2}ms`);
  console.log(`   From cache: ${cached?.cached ? 'Yes' : 'No'}`);
  console.log(`   Speed improvement: ${Math.round(time1 / time2)}x faster`);
}

async function main() {
  console.log('🏠 PARCEL FETCHER TEST SUITE');
  console.log(`📅 ${new Date().toLocaleString()}`);

  // Clear cache to start fresh
  console.log('\nClearing cache...');
  clearCache();

  // Run tests
  await testSingleFetch();
  await testBatchFetch();
  await testCachePerformance();

  console.log('\n' + '='.repeat(70));
  console.log('✅ ALL TESTS COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
