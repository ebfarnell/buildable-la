#!/usr/bin/env tsx
/**
 * Quick Feasibility Check Tool
 * Rapid assessment of property potential with minimal API calls
 *
 * Usage:
 *   npx tsx src/tools/quick_check.ts "123 Main St, City, CA 12345"
 *   npx tsx src/tools/quick_check.ts --apn 1234567890
 *   npx tsx src/tools/quick_check.ts --batch addresses.txt
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { formatCurrency, formatPercent } from '../formulas/adu_formulas.js';
import { promises as fs } from 'fs';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

interface QuickAssessment {
  address: string;
  apn: string;
  status: '🟢 EXCELLENT' | '🟡 GOOD' | '🟠 FAIR' | '🔴 POOR';
  lotSize: number;
  estimatedAduSize: number;
  estimatedSplitPotential: number;
  estimatedMonthlyRent: number;
  keyFactors: string[];
  nextSteps: string[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Zone-based quick estimates
 */
const QUICK_ZONE_DATA: Record<string, { coverage: number; minLot: number; aduFactor: number }> = {
  R1: { coverage: 0.25, minLot: 7500, aduFactor: 0.85 },
  RS: { coverage: 0.25, minLot: 7500, aduFactor: 0.85 },
  'RS-1': { coverage: 0.28, minLot: 6000, aduFactor: 0.85 },
  RE: { coverage: 0.15, minLot: 20000, aduFactor: 0.8 },
  RA: { coverage: 0.12, minLot: 43560, aduFactor: 0.75 },
  R2: { coverage: 0.35, minLot: 4000, aduFactor: 0.7 },
  R3: { coverage: 0.4, minLot: 3000, aduFactor: 0.6 },
  DEFAULT: { coverage: 0.22, minLot: 7500, aduFactor: 0.8 },
};

/**
 * Quick assessment based on minimal data
 */
async function quickCheck(
  addressOrApn: string,
  isApn: boolean = false,
): Promise<QuickAssessment | null> {
  console.log(`\n⚡ Quick checking: ${addressOrApn}`);

  let whereClause: string;

  if (isApn) {
    // Search by APN
    whereClause = `PARCEL_APN = '${addressOrApn}'`;
  } else {
    // Parse address for search
    const match = addressOrApn.match(/(\d+)\s+(.+?)\s*,\s*([^,]+)\s*,\s*CA/i);
    if (!match) {
      console.log('   ❌ Cannot parse address');
      return null;
    }

    const [_, streetNum, streetName] = match;
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
    whereClause = `SITE_ADDR LIKE '${searchTerms.join('')}'`;
  }

  // Single API call for parcel data
  const params = new URLSearchParams({
    f: 'json',
    where: whereClause,
    outFields: 'PARCEL_APN,SITE_ADDR,SITE_CITY,SITE_ZIP,SHAPE_Area,YR_BLT,COUNTYNAME',
    returnGeometry: 'true',
    resultRecordCount: '1',
  });

  try {
    const response = await fetch(`${CA_PARCELS_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as any;

    if (!data.features || data.features.length === 0) {
      console.log('   ❌ Property not found');
      return null;
    }

    const feature = data.features[0];
    const attrs = feature.attributes;
    const geometry = feature.geometry;

    // Calculate lot size
    const polygon = turf.polygon(geometry.rings);
    const areaSqft = Math.round(turf.area(polygon) * 10.7639);

    console.log(`   ✅ Found: ${attrs.SITE_ADDR || attrs.PARCEL_APN}`);
    console.log(`   📐 Lot: ${areaSqft.toLocaleString()} sqft`);

    // Quick zone estimation based on lot size and county
    let estimatedZone = 'R1';
    let confidence: 'high' | 'medium' | 'low' = 'low';

    if (areaSqft >= 40000) estimatedZone = 'RA';
    else if (areaSqft >= 15000) estimatedZone = 'RE';
    else if (areaSqft >= 6000) estimatedZone = 'R1';
    else if (areaSqft >= 4000) estimatedZone = 'R2';
    else estimatedZone = 'R3';

    // Adjust for county patterns
    if (attrs.COUNTYNAME === 'LOS ANGELES' || attrs.COUNTYNAME === 'ORANGE') {
      confidence = 'medium'; // These counties have predictable zoning
    }

    const zoneData = QUICK_ZONE_DATA[estimatedZone] || QUICK_ZONE_DATA.DEFAULT;

    // Quick building estimation
    const yearBuilt = attrs.YR_BLT;
    let buildingCoverage = zoneData.coverage;

    if (yearBuilt) {
      // Adjust based on age - older homes tend to be smaller
      if (yearBuilt < 1950) buildingCoverage *= 0.8;
      else if (yearBuilt < 1970) buildingCoverage *= 0.9;
      else if (yearBuilt > 2000) buildingCoverage *= 1.1;
    }

    const estimatedBuildingArea = areaSqft * buildingCoverage;

    // Quick ADU calculation
    const setbackReduction = 0.25; // Assume 25% lot reduction from setbacks
    const buildableEnvelope = areaSqft * (1 - setbackReduction);
    const netBuildable = buildableEnvelope - estimatedBuildingArea;
    const maxAduByLot = Math.min(areaSqft * 0.4, 1200); // 40% coverage or 1200 max
    const estimatedAduSize = Math.min(Math.max(0, netBuildable), maxAduByLot);

    // Quick split calculation
    const estimatedSplits = Math.floor(areaSqft / zoneData.minLot);

    // Financial quick estimate
    const rentPerSqft = 3.0; // $3/sqft baseline
    const estimatedRent = estimatedAduSize * rentPerSqft;

    // Determine status
    let status: '🟢 EXCELLENT' | '🟡 GOOD' | '🟠 FAIR' | '🔴 POOR';
    const keyFactors: string[] = [];
    const nextSteps: string[] = [];

    if (estimatedAduSize >= 1000 && estimatedSplits >= 2) {
      status = '🟢 EXCELLENT';
      keyFactors.push('Can build 1000+ sqft ADU');
      keyFactors.push('Lot is splittable');
      nextSteps.push('Run detailed analysis for exact numbers');
      nextSteps.push('Check local zoning for specific requirements');
    } else if (estimatedAduSize >= 770 || estimatedSplits >= 2) {
      status = '🟡 GOOD';
      if (estimatedAduSize >= 770)
        keyFactors.push(`Viable for ${Math.round(estimatedAduSize)} sqft ADU`);
      if (estimatedSplits >= 2) keyFactors.push('Potential lot split opportunity');
      nextSteps.push('Verify zoning and setback requirements');
      nextSteps.push('Get actual building footprint data');
    } else if (estimatedAduSize >= 500) {
      status = '🟠 FAIR';
      keyFactors.push('Limited ADU potential');
      keyFactors.push(`Only ${Math.round(estimatedAduSize)} sqft available`);
      nextSteps.push('Consider garage conversion instead');
      nextSteps.push('Check for alternative development options');
    } else {
      status = '🔴 POOR';
      keyFactors.push('Insufficient space for ADU');
      if (areaSqft < 4000) keyFactors.push('Lot too small');
      if (buildingCoverage > 0.4) keyFactors.push('High existing coverage');
      nextSteps.push('Not recommended for ADU development');
      nextSteps.push('Consider other investment properties');
    }

    // Additional factors
    if (areaSqft >= 10000) {
      keyFactors.push(`Large ${(areaSqft / 43560).toFixed(2)} acre lot`);
    }
    if (yearBuilt && yearBuilt < 1960) {
      keyFactors.push(`Older home (${yearBuilt}) - check condition`);
    }

    return {
      address: attrs.SITE_ADDR || addressOrApn,
      apn: attrs.PARCEL_APN,
      status,
      lotSize: areaSqft,
      estimatedAduSize: Math.round(estimatedAduSize),
      estimatedSplitPotential: estimatedSplits,
      estimatedMonthlyRent: Math.round(estimatedRent),
      keyFactors,
      nextSteps,
      confidence,
    };
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Display quick assessment
 */
function displayAssessment(assessment: QuickAssessment) {
  console.log(`\n${assessment.status} ${assessment.address}`);
  console.log('='.repeat(60));
  console.log(`📍 APN: ${assessment.apn}`);
  console.log(
    `📐 Lot Size: ${assessment.lotSize.toLocaleString()} sqft (${(assessment.lotSize / 43560).toFixed(2)} acres)`,
  );

  console.log('\n📊 QUICK ESTIMATES:');
  if (assessment.estimatedAduSize > 0) {
    console.log(`   🏠 ADU Potential: ${assessment.estimatedAduSize.toLocaleString()} sqft`);
    console.log(`   💰 Est. Rent: ${formatCurrency(assessment.estimatedMonthlyRent)}/month`);
  } else {
    console.log(`   🏠 ADU Potential: Not viable`);
  }

  if (assessment.estimatedSplitPotential >= 2) {
    console.log(`   ✂️ Split Potential: Can create ${assessment.estimatedSplitPotential} lots`);
  } else {
    console.log(`   ✂️ Split Potential: Not splittable`);
  }

  console.log(`   📈 Confidence: ${assessment.confidence.toUpperCase()}`);

  if (assessment.keyFactors.length > 0) {
    console.log('\n🔑 KEY FACTORS:');
    assessment.keyFactors.forEach((factor) => console.log(`   • ${factor}`));
  }

  if (assessment.nextSteps.length > 0) {
    console.log('\n👉 NEXT STEPS:');
    assessment.nextSteps.forEach((step) => console.log(`   • ${step}`));
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('⚡ QUICK PROPERTY FEASIBILITY CHECK');
  console.log('📅 ' + new Date().toLocaleString());
  console.log('='.repeat(60));

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('\nUsage:');
    console.log('  Quick check: npx tsx src/tools/quick_check.ts "123 Main St, City, CA 12345"');
    console.log('  By APN: npx tsx src/tools/quick_check.ts --apn 1234567890');
    console.log('  Batch: npx tsx src/tools/quick_check.ts --batch addresses.txt');
    return;
  }

  let assessments: QuickAssessment[] = [];

  if (args[0] === '--batch' && args[1]) {
    // Batch mode
    try {
      const fileContent = await fs.readFile(args[1], 'utf-8');
      const lines = fileContent.split('\n').filter((line) => line.trim());

      console.log(`\n📋 Batch checking ${lines.length} properties...`);

      for (const line of lines) {
        const assessment = await quickCheck(line.trim());
        if (assessment) {
          assessments.push(assessment);
          displayAssessment(assessment);
        }
      }
    } catch (error) {
      console.error(`❌ Could not read file: ${args[1]}`);
      return;
    }
  } else if (args[0] === '--apn' && args[1]) {
    // APN mode
    const assessment = await quickCheck(args[1], true);
    if (assessment) {
      assessments.push(assessment);
      displayAssessment(assessment);
    }
  } else {
    // Single address mode
    const address = args.join(' ');
    const assessment = await quickCheck(address);
    if (assessment) {
      assessments.push(assessment);
      displayAssessment(assessment);
    }
  }

  // Summary for batch mode
  if (assessments.length > 1) {
    console.log('\n📈 BATCH SUMMARY:');
    console.log('='.repeat(60));

    const excellent = assessments.filter((a) => a.status.includes('EXCELLENT')).length;
    const good = assessments.filter((a) => a.status.includes('GOOD')).length;
    const fair = assessments.filter((a) => a.status.includes('FAIR')).length;
    const poor = assessments.filter((a) => a.status.includes('POOR')).length;

    console.log(`🟢 Excellent: ${excellent}`);
    console.log(`🟡 Good: ${good}`);
    console.log(`🟠 Fair: ${fair}`);
    console.log(`🔴 Poor: ${poor}`);

    const viable = assessments.filter((a) => a.estimatedAduSize >= 770).length;
    const splittable = assessments.filter((a) => a.estimatedSplitPotential >= 2).length;

    console.log(`\n✅ ADU Viable: ${viable}/${assessments.length}`);
    console.log(`✂️ Splittable: ${splittable}/${assessments.length}`);

    // Save results
    const outputFile = `quick_check_${Date.now()}.json`;
    await fs.writeFile(
      outputFile,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          assessments,
        },
        null,
        2,
      ),
    );
    console.log(`\n💾 Results saved to: ${outputFile}`);
  }

  console.log('\n⚠️  Note: These are quick estimates only.');
  console.log('Run detailed analysis tools for accurate assessments.');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
