/**
 * Simplified Corrected ADU Analysis - Focusing on Building Data Impact
 */

import { getBuildingFootprints } from './services/building_footprints_deterministic.js';
import { promises as fs } from 'node:fs';

interface SimplifiedAnalysis {
  address: string;
  apn: string;
  county: string;
  building_analysis: {
    previous_estimate_sqft: number;
    actual_osm_data_sqft: number;
    difference_sqft: number;
    difference_percent: number;
    source: string;
    building_count: number;
  };
  buildable_estimate: {
    rough_buildable_with_estimates: number;
    rough_buildable_with_osm: number;
    improvement_sqft: number;
    notes: string;
  };
  viability_assessment: {
    viable_with_estimates: boolean;
    viable_with_osm: boolean;
    status_change: string;
  };
  key_insights: string[];
}

// Property data from previous testing
const PROPERTY_DATA = [
  {
    address: '20616 Archwood St, Winnetka, CA, 91306',
    apn: '2148020015',
    county: 'LOS ANGELES',
    lot_size: 7504,
    geometry: {
      rings: [
        [
          [-118.5827, 34.1914],
          [-118.5826, 34.1914],
          [-118.5826, 34.1915],
          [-118.5827, 34.1915],
          [-118.5827, 34.1914],
        ],
      ],
    },
  },
  {
    address: '10921 Polaris Dr, San Diego, CA, 92126',
    apn: '3181941500',
    county: 'SAN DIEGO',
    lot_size: 5079,
    geometry: {
      rings: [
        [
          [-117.1314, 32.918],
          [-117.1313, 32.918],
          [-117.1313, 32.9181],
          [-117.1314, 32.9181],
          [-117.1314, 32.918],
        ],
      ],
    },
  },
  {
    address: '1843 S Bedford St, Los Angeles, CA, 90035',
    apn: '4303015010',
    county: 'LOS ANGELES',
    lot_size: 8212,
    geometry: {
      rings: [
        [
          [-118.3829, 34.0444],
          [-118.3828, 34.0444],
          [-118.3828, 34.0445],
          [-118.3829, 34.0445],
          [-118.3829, 34.0444],
        ],
      ],
    },
  },
];

/**
 * Rough buildable area calculation using simplified assumptions
 */
function calculateRoughBuildable(lotSize: number, buildingArea: number): number {
  // Assume 20% setback reduction and subtract buildings
  const setbackArea = lotSize * 0.8; // 80% usable after setbacks
  return Math.max(0, setbackArea - buildingArea);
}

async function analyzeSimplified() {
  console.log('🏠 SIMPLIFIED BUILDING DATA IMPACT ANALYSIS');
  console.log('Focus: Real OSM Data vs. Previous Estimates');
  console.log('='.repeat(70));

  const results: SimplifiedAnalysis[] = [];

  for (const property of PROPERTY_DATA) {
    console.log(`\n📍 ${property.address}`);
    console.log(`   Lot: ${property.lot_size.toLocaleString()} sqft, County: ${property.county}`);

    try {
      // Get building footprints
      const buildings = await getBuildingFootprints(
        property.geometry,
        property.county,
        property.apn,
      );

      const actualBuildingArea = buildings.reduce((sum, b) => sum + b.area_sqft, 0);
      const estimatedBuildingArea = Math.round(property.lot_size * 0.3); // 30% rule
      const source = buildings[0]?.source || 'UNKNOWN';

      const difference = actualBuildingArea - estimatedBuildingArea;
      const percentDiff = Math.round((difference / estimatedBuildingArea) * 100);

      console.log(`   Buildings: ${buildings.length} found (${source})`);
      console.log(`   Previous Estimate: ${estimatedBuildingArea.toLocaleString()} sqft`);
      console.log(`   Actual Data: ${actualBuildingArea.toLocaleString()} sqft`);
      console.log(
        `   Difference: ${difference >= 0 ? '+' : ''}${difference.toLocaleString()} sqft (${percentDiff >= 0 ? '+' : ''}${percentDiff}%)`,
      );

      // Rough buildable calculations
      const buildableWithEstimates = calculateRoughBuildable(
        property.lot_size,
        estimatedBuildingArea,
      );
      const buildableWithOSM = calculateRoughBuildable(property.lot_size, actualBuildingArea);
      const buildableImprovement = buildableWithOSM - buildableWithEstimates;

      console.log(`   Buildable (Est.): ${buildableWithEstimates.toLocaleString()} sqft`);
      console.log(`   Buildable (OSM): ${buildableWithOSM.toLocaleString()} sqft`);
      console.log(
        `   Improvement: ${buildableImprovement >= 0 ? '+' : ''}${buildableImprovement.toLocaleString()} sqft`,
      );

      // Viability assessment
      const viableWithEst = buildableWithEstimates >= 770;
      const viableWithOSM = buildableWithOSM >= 770;

      let statusChange = 'No change';
      if (viableWithEst && !viableWithOSM) statusChange = 'Changed from VIABLE to NON-VIABLE';
      else if (!viableWithEst && viableWithOSM) statusChange = 'Changed from NON-VIABLE to VIABLE';
      else if (viableWithEst && viableWithOSM) statusChange = 'Remains VIABLE';
      else statusChange = 'Remains NON-VIABLE';

      console.log(`   ADU Status: ${statusChange}`);

      // Key insights
      const insights = [];
      if (source === 'OSM') {
        insights.push('✅ Using real OpenStreetMap building data instead of estimates');
      } else {
        insights.push('⚠️ Still using estimates - OSM query may have failed');
      }

      if (Math.abs(percentDiff) > 25) {
        insights.push(
          `📊 Building area was ${Math.abs(percentDiff)}% ${percentDiff > 0 ? 'larger' : 'smaller'} than estimated`,
        );
      }

      if (buildings.length > 1) {
        insights.push(`🏘️ Multiple structures detected (${buildings.length} buildings)`);
      }

      if (statusChange.includes('Changed')) {
        insights.push(`🚨 VIABILITY STATUS CHANGED: ${statusChange}`);
      }

      if (Math.abs(buildableImprovement) > 500) {
        insights.push(
          `📈 Significant buildable area change: ${Math.abs(buildableImprovement).toLocaleString()} sqft ${buildableImprovement > 0 ? 'increase' : 'decrease'}`,
        );
      }

      const analysis: SimplifiedAnalysis = {
        address: property.address,
        apn: property.apn,
        county: property.county,
        building_analysis: {
          previous_estimate_sqft: estimatedBuildingArea,
          actual_osm_data_sqft: actualBuildingArea,
          difference_sqft: difference,
          difference_percent: percentDiff,
          source: source,
          building_count: buildings.length,
        },
        buildable_estimate: {
          rough_buildable_with_estimates: buildableWithEstimates,
          rough_buildable_with_osm: buildableWithOSM,
          improvement_sqft: buildableImprovement,
          notes: 'Simplified calculation: 80% lot usable after setbacks, minus building area',
        },
        viability_assessment: {
          viable_with_estimates: viableWithEst,
          viable_with_osm: viableWithOSM,
          status_change: statusChange,
        },
        key_insights: insights,
      };

      results.push(analysis);
    } catch (error) {
      console.error(`❌ Error analyzing ${property.address}:`, error);
    }
  }

  // Generate summary report
  console.log('\n' + '='.repeat(70));
  console.log('📊 IMPACT SUMMARY');
  console.log('='.repeat(70));

  const viableBeforeCount = results.filter(
    (r) => r.viability_assessment.viable_with_estimates,
  ).length;
  const viableAfterCount = results.filter((r) => r.viability_assessment.viable_with_osm).length;
  const changedCount = results.filter((r) =>
    r.viability_assessment.status_change.includes('Changed'),
  ).length;

  console.log(`Properties analyzed: ${results.length}`);
  console.log(`Viable before (estimates): ${viableBeforeCount}/${results.length}`);
  console.log(`Viable after (OSM data): ${viableAfterCount}/${results.length}`);
  console.log(`Status changes: ${changedCount} properties`);

  // Individual summaries
  for (const result of results) {
    console.log(`\n📍 ${result.address}:`);
    console.log(
      `   Building Data: ${result.building_analysis.source} (${result.building_analysis.difference_percent >= 0 ? '+' : ''}${result.building_analysis.difference_percent}% vs estimates)`,
    );
    console.log(
      `   Buildable Area: ${result.buildable_estimate.improvement_sqft >= 0 ? '+' : ''}${result.buildable_estimate.improvement_sqft.toLocaleString()} sqft change`,
    );
    console.log(`   Status: ${result.viability_assessment.status_change}`);

    if (result.key_insights.length > 0) {
      console.log(`   Key Insights:`);
      result.key_insights.forEach((insight) => console.log(`     • ${insight}`));
    }
  }

  // Save results
  const outDir = '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out';
  const resultsPath = `${outDir}/simplified_building_data_impact.json`;
  await fs.writeFile(
    resultsPath,
    JSON.stringify(
      {
        summary: {
          properties_analyzed: results.length,
          viable_before: viableBeforeCount,
          viable_after: viableAfterCount,
          status_changes: changedCount,
          analysis_date: new Date().toISOString(),
        },
        properties: results,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(`\n✅ Detailed results saved: ${resultsPath}`);

  return results;
}

// Execute
analyzeSimplified().catch(console.error);
