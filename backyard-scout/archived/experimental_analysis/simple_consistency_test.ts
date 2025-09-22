#!/usr/bin/env tsx
/**
 * Simple Consistency Test - Run analysis 5 times and compare results
 */

import { execSync } from 'child_process';

// Run the analyzer 5 times and capture results
console.log('🎯 CONSISTENCY TEST - Running ADU Analysis 5 times');
console.log('='.repeat(70));

const runs: any[] = [];

for (let i = 1; i <= 5; i++) {
  console.log(`\n🔄 RUN ${i}:`);

  try {
    const output = execSync('npx tsx src/complete_adu_analyzer.ts 2>&1', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    // Extract key metrics from the summary table
    const summaryMatch = output.match(/SUMMARY TABLE[\s\S]*?\n\n/);
    if (summaryMatch) {
      const summarySection = summaryMatch[0];

      // Parse the table rows
      const rows = summarySection
        .split('\n')
        .filter((line) => line.includes('|') && line.includes('sqft'));

      rows.forEach((row) => {
        const parts = row.split('|').map((p) => p.trim());
        if (parts.length >= 5) {
          const property = parts[1].substring(0, 20);
          const netBuildable = parts[3];
          const maxAdu = parts[4];
          const score = parts[5];

          console.log(`  ${property}: Net=${netBuildable}, Max=${maxAdu}, Score=${score}`);
        }
      });
    }
  } catch (error) {
    console.error(`  Error in run ${i}:`, error);
  }
}

console.log('\n' + '='.repeat(70));
console.log('✅ Test complete. Review the results above for consistency.');
console.log('All runs should show identical values for each property.');
