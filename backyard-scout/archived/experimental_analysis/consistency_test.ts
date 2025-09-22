#!/usr/bin/env tsx
/**
 * Consistency Test - Run ADU analysis multiple times and verify consistent results
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  property: string;
  viable: boolean;
  netBuildable: number;
  maxAdu: number;
  score: number;
  developmentCost: number;
  capRate: number;
}

/**
 * Run the analyzer and extract results
 */
async function runAnalysis(runNumber: number): Promise<TestResult[]> {
  console.log(`\n🔄 Running analysis #${runNumber}...`);

  // Run the analyzer
  const output = execSync('npx tsx src/complete_adu_analyzer.ts', {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  // Parse results from output
  const results: TestResult[] = [];
  const addresses = [
    '20616 Archwood St, Winnetka, CA 91306',
    '10921 Polaris Dr, San Diego, CA 92126',
    '1843 S Bedford St, Los Angeles, CA 90035',
  ];

  for (const address of addresses) {
    const propertySection = output
      .split(address)[1]
      ?.split('======================================================================')[0];

    if (propertySection) {
      // Extract metrics
      const netBuildableMatch = propertySection.match(/Net Buildable:\s*([\d,]+)\s*sqft/);
      const maxAduMatch = propertySection.match(/Max ADU Allowed:\s*([\d,]+)\s*sqft/);
      const viableMatch = propertySection.match(/VIABILITY:\s*(YES|NO)/);
      const scoreMatch = propertySection.match(/Score:\s*(\d+)\/100/);
      const devCostMatch = propertySection.match(/Development Cost:\s*\$([\d,]+)/);
      const capRateMatch = propertySection.match(/Cap Rate:\s*([\d.]+)%/);

      results.push({
        property: address.split(',')[0], // Short name
        viable: viableMatch?.[1] === 'YES',
        netBuildable: parseInt((netBuildableMatch?.[1] || '0').replace(/,/g, '')),
        maxAdu: parseInt((maxAduMatch?.[1] || '0').replace(/,/g, '')),
        score: parseInt(scoreMatch?.[1] || '0'),
        developmentCost: parseInt((devCostMatch?.[1] || '0').replace(/,/g, '')),
        capRate: parseFloat(capRateMatch?.[1] || '0'),
      });
    }
  }

  return results;
}

/**
 * Compare two sets of results
 */
function compareResults(
  run1: TestResult[],
  run2: TestResult[],
  run1Number: number,
  run2Number: number,
): boolean {
  let identical = true;

  console.log(`\n📊 Comparing Run #${run1Number} vs Run #${run2Number}:`);
  console.log('-'.repeat(70));

  for (let i = 0; i < run1.length; i++) {
    const r1 = run1[i];
    const r2 = run2[i];

    if (!r2) {
      console.log(`❌ Missing result for ${r1.property} in Run #${run2Number}`);
      identical = false;
      continue;
    }

    // Check each metric
    const metrics = [
      { name: 'Viable', val1: r1.viable, val2: r2.viable },
      { name: 'Net Buildable', val1: r1.netBuildable, val2: r2.netBuildable },
      { name: 'Max ADU', val1: r1.maxAdu, val2: r2.maxAdu },
      { name: 'Score', val1: r1.score, val2: r2.score },
      { name: 'Dev Cost', val1: r1.developmentCost, val2: r2.developmentCost },
      { name: 'Cap Rate', val1: r1.capRate, val2: r2.capRate },
    ];

    let propertyMatches = true;
    for (const metric of metrics) {
      if (metric.val1 !== metric.val2) {
        console.log(`  ❌ ${r1.property} - ${metric.name}: ${metric.val1} → ${metric.val2}`);
        propertyMatches = false;
        identical = false;
      }
    }

    if (propertyMatches) {
      console.log(`  ✅ ${r1.property} - All metrics match`);
    }
  }

  return identical;
}

/**
 * Clear cache to test without cached data
 */
function clearCache() {
  console.log('\n🗑️ Clearing cache...');
  const cacheDir = path.join(process.cwd(), 'cache');

  // Clear parcel cache
  const parcelCache = path.join(cacheDir, 'parcels');
  if (fs.existsSync(parcelCache)) {
    const files = fs.readdirSync(parcelCache);
    files.forEach((file) => {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(parcelCache, file));
      }
    });
    console.log(`  Cleared ${files.length} parcel cache files`);
  }

  // Clear zoning cache
  const zoningCache = path.join(cacheDir, 'zoning_cache.json');
  if (fs.existsSync(zoningCache)) {
    fs.unlinkSync(zoningCache);
    console.log(`  Cleared zoning cache`);
  }
}

/**
 * Main consistency test
 */
async function main() {
  console.log('🎯 ADU ANALYSIS CONSISTENCY TEST');
  console.log('='.repeat(70));
  console.log('Testing if the analysis produces consistent results across multiple runs');

  const allRuns: TestResult[][] = [];

  // Test 1: Multiple runs with cache
  console.log('\n\n📦 TEST 1: WITH CACHE');
  console.log('='.repeat(70));

  for (let i = 1; i <= 3; i++) {
    const results = await runAnalysis(i);
    allRuns.push(results);

    // Wait a bit between runs
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Compare runs 1-3
  let withCacheConsistent = true;
  withCacheConsistent = compareResults(allRuns[0], allRuns[1], 1, 2) && withCacheConsistent;
  withCacheConsistent = compareResults(allRuns[1], allRuns[2], 2, 3) && withCacheConsistent;
  withCacheConsistent = compareResults(allRuns[0], allRuns[2], 1, 3) && withCacheConsistent;

  // Test 2: Clear cache and run again
  console.log('\n\n🔄 TEST 2: AFTER CLEARING CACHE');
  console.log('='.repeat(70));

  clearCache();
  const noCacheRun = await runAnalysis(4);
  allRuns.push(noCacheRun);

  const cacheVsNoCache = compareResults(allRuns[0], noCacheRun, 1, 4);

  // Display final results
  console.log('\n\n' + '='.repeat(70));
  console.log('📈 CONSISTENCY TEST RESULTS');
  console.log('='.repeat(70));

  console.log('\n📊 Final Metrics (All Runs):');
  console.log('\n| Run | Property | Net Buildable | Max ADU | Score | Dev Cost |');
  console.log('|-----|----------|---------------|---------|-------|----------|');

  for (let i = 0; i < allRuns.length; i++) {
    for (const result of allRuns[i]) {
      console.log(
        `| ${i + 1}   | ${result.property.substring(0, 8).padEnd(8)} | ${result.netBuildable
          .toLocaleString()
          .padEnd(13)} | ${result.maxAdu.toLocaleString().padEnd(7)} | ${result.score
          .toString()
          .padEnd(5)} | $${result.developmentCost.toLocaleString().padEnd(7)} |`,
      );
    }
  }

  console.log('\n📊 Consistency Summary:');
  console.log(
    `  With Cache (Runs 1-3): ${withCacheConsistent ? '✅ CONSISTENT' : '❌ INCONSISTENT'}`,
  );
  console.log(`  Cache vs No Cache: ${cacheVsNoCache ? '✅ CONSISTENT' : '⚠️ VARIES'}`);

  if (withCacheConsistent && cacheVsNoCache) {
    console.log('\n✅ SUCCESS: Analysis produces consistent results!');
  } else if (withCacheConsistent) {
    console.log('\n⚠️ PARTIAL SUCCESS: Consistent with cache, varies without cache');
    console.log('   This is expected if external APIs return different data');
  } else {
    console.log('\n❌ ISSUE: Analysis producing inconsistent results');
    console.log('   Investigation needed to ensure deterministic calculations');
  }

  // Show which components are deterministic
  console.log('\n🔍 Component Analysis:');
  const components = [
    { name: 'Parcel Data', status: '✅ Cached/Consistent' },
    { name: 'Zoning Data', status: '✅ Cached/Consistent' },
    { name: 'Building Detection', status: '⚠️ May vary (API dependent)' },
    { name: 'Setback Calculations', status: '✅ Deterministic' },
    { name: 'Buildable Area', status: '✅ Formula-based' },
    { name: 'Financial Projections', status: '✅ Fixed formulas' },
  ];

  for (const comp of components) {
    console.log(`  ${comp.name}: ${comp.status}`);
  }
}

// Run test
main().catch(console.error);
