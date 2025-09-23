#!/usr/bin/env tsx
/**
 * Property Comparison & Ranking Tool
 * Compares multiple properties and ranks them by various criteria
 *
 * Usage:
 *   npx tsx src/tools/property_compare.ts "address1" "address2" "address3"
 *   npx tsx src/tools/property_compare.ts --file properties.txt
 *   npx tsx src/tools/property_compare.ts --criteria "adu,split,investment"
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { getEnhancedZoning, getZoningRequirementsFromResult } from '../services/zoning_enhanced.js';
import { detectBuildings } from '../services/unified_building_detector.js';
import {
  calcBuildableEnvelope,
  calcNetBuildableArea,
  calcMaxADUSize,
  isADUViable,
  calcTotalDevelopmentCost,
  calcMonthlyRent,
  calcAnnualNOI,
  calcCapRate,
  formatCurrency,
  formatPercent,
} from '../formulas/adu_formulas.js';
import { promises as fs } from 'fs';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

interface PropertyAnalysis {
  address: string;
  apn: string;
  county: string;

  // Land metrics
  lotSize: number;
  zone: string;
  setbacks: { front: number; side: number; rear: number };

  // Building metrics
  existingBuildings: number;
  buildingCoverage: number;
  buildingDataQuality: string;

  // ADU potential
  aduBuildableArea: number;
  aduMaxSize: number;
  aduRecommendedSize: number;
  aduViable: boolean;
  aduDevelopmentCost: number;
  aduMonthlyRent: number;
  aduCapRate: number;

  // Lot splitting potential
  splitPossible: boolean;
  maxSplits: number;
  minLotSizeRequired: number;

  // Scores
  aduScore: number;
  splitScore: number;
  investmentScore: number;
  overallScore: number;

  // Rankings (filled after all properties analyzed)
  aduRank?: number;
  splitRank?: number;
  investmentRank?: number;
  overallRank?: number;
}

/**
 * Fetch and analyze a single property
 */
async function analyzeProperty(address: string): Promise<PropertyAnalysis | null> {
  console.log(`\n🔍 Analyzing: ${address}`);

  // Parse address
  const match = address.match(/(\d+)\s+(.+?)\s*,\s*([^,]+)\s*,\s*CA/i);
  if (!match) {
    console.log('   ❌ Cannot parse address');
    return null;
  }

  const [_, streetNum, streetName, city] = match;
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

  // Fetch parcel
  const params = new URLSearchParams({
    f: 'json',
    where: searchQuery,
    outFields: '*',
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

    if (!data.features || data.features.length === 0) {
      console.log('   ❌ No parcel found');
      return null;
    }

    const feature = data.features[0];
    const attrs = feature.attributes;
    const geometry = feature.geometry;

    // Calculate area and dimensions
    const polygon = turf.polygon(geometry.rings);
    const areaSqft = Math.round(turf.area(polygon) * 10.7639);
    const centroid = turf.centroid(polygon);
    const bbox = turf.bbox(polygon);
    const width = Math.round((bbox[2] - bbox[0]) * 364000);
    const depth = Math.round((bbox[3] - bbox[1]) * 365000);

    console.log(`   ✅ Found: APN ${attrs.PARCEL_APN}`);
    console.log(`   📐 Lot: ${areaSqft.toLocaleString()} sqft`);

    // Get zoning
    let zone = 'UNKNOWN';
    let setbacks = { front: 20, side: 5, rear: 15 };
    let minLotSize = 7500;

    try {
      const zoningData = await getEnhancedZoning(
        centroid.geometry.coordinates[1],
        centroid.geometry.coordinates[0],
      );

      if (zoningData?.zone_code) {
        zone = zoningData.zone_code;
        const requirements = getZoningRequirementsFromResult(zoningData);
        if (requirements?.setback_requirements) {
          setbacks = requirements.setback_requirements;
        }

        // Determine minimum lot size for splitting
        const baseZone = zone.replace(/-.*$/, '').toUpperCase();
        const zoneMins: Record<string, number> = {
          RA: 43560,
          RE: 20000,
          R1: 7500,
          RS: 7500,
          'RS-1': 6000,
          RD: 5000,
          R2: 4000,
        };
        minLotSize = zoneMins[baseZone] || 7500;
      }
    } catch (error) {
      console.log('   ⚠️ Could not fetch zoning');
    }

    // Get buildings
    let buildingArea = 0;
    let buildingDataQuality = 'estimated';

    try {
      const buildingData = await detectBuildings(geometry, attrs.PARCEL_APN, attrs.COUNTYNAME);
      buildingArea = buildingData.total_area_sqft;
      buildingDataQuality = buildingData.data_quality;
      console.log(
        `   🏢 Buildings: ${buildingArea.toLocaleString()} sqft (${buildingDataQuality})`,
      );
    } catch (error) {
      buildingArea = areaSqft * 0.22;
      console.log(`   🏢 Buildings: ${buildingArea.toLocaleString()} sqft (estimated)`);
    }

    // Calculate ADU potential
    const envelopeSqft = calcBuildableEnvelope(
      width,
      depth,
      setbacks.front,
      setbacks.side,
      setbacks.rear,
    );
    const netBuildable = calcNetBuildableArea(envelopeSqft, buildingArea);
    const maxAduSize = calcMaxADUSize(areaSqft);
    const recommendedSize = Math.min(maxAduSize, netBuildable, 1200);
    const aduViable = isADUViable(netBuildable);

    // Financial calculations
    const developmentCost = calcTotalDevelopmentCost(recommendedSize);
    const monthlyRent = calcMonthlyRent(recommendedSize);
    const annualNOI = calcAnnualNOI(monthlyRent);
    const capRate = calcCapRate(annualNOI, developmentCost);

    // Calculate lot splitting potential
    const maxSplits = Math.floor(areaSqft / minLotSize);
    const splitPossible = maxSplits >= 2;

    // Calculate scores (0-100 for each category)

    // ADU Score
    let aduScore = 0;
    if (aduViable) {
      aduScore += 20; // Base viability
      aduScore += Math.min(30, (netBuildable / 1200) * 30); // Buildable area
      aduScore += Math.min(25, capRate * 250); // Financial return
      aduScore += Math.min(15, (1 - buildingArea / areaSqft) * 15); // Low existing coverage
      if (buildingDataQuality === 'high') aduScore += 10;
      else if (buildingDataQuality === 'medium') aduScore += 5;
    }

    // Split Score
    let splitScore = 0;
    if (splitPossible) {
      splitScore += 30; // Base splittable
      splitScore += Math.min(40, (maxSplits - 1) * 20); // Number of splits
      splitScore += Math.min(20, (1 - buildingArea / areaSqft) * 20); // Low coverage
      splitScore += 10; // Bonus for being splittable at all
    }

    // Investment Score (combination of ADU + split potential)
    let investmentScore = 0;
    investmentScore += aduScore * 0.6; // 60% weight on ADU
    investmentScore += splitScore * 0.4; // 40% weight on splitting

    // Additional investment factors
    if (capRate >= 0.08) investmentScore = Math.min(100, investmentScore + 10);
    if (areaSqft >= 10000) investmentScore = Math.min(100, investmentScore + 5);

    // Overall Score (balanced)
    const overallScore = (aduScore + splitScore + investmentScore) / 3;

    return {
      address,
      apn: attrs.PARCEL_APN,
      county: attrs.COUNTYNAME,
      lotSize: areaSqft,
      zone,
      setbacks,
      existingBuildings: Math.round(buildingArea),
      buildingCoverage: buildingArea / areaSqft,
      buildingDataQuality,
      aduBuildableArea: Math.round(netBuildable),
      aduMaxSize: maxAduSize,
      aduRecommendedSize: Math.round(recommendedSize),
      aduViable,
      aduDevelopmentCost: developmentCost,
      aduMonthlyRent: monthlyRent,
      aduCapRate: capRate,
      splitPossible,
      maxSplits,
      minLotSizeRequired: minLotSize,
      aduScore: Math.round(aduScore),
      splitScore: Math.round(splitScore),
      investmentScore: Math.round(investmentScore),
      overallScore: Math.round(overallScore),
    };
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Display comparison table
 */
function displayComparison(properties: PropertyAnalysis[]) {
  console.log('\n📊 PROPERTY COMPARISON TABLE:');
  console.log('='.repeat(100));

  // Header
  console.log('\n🏠 BASIC INFORMATION:');
  console.log('-'.repeat(100));
  console.log(
    'Rank | Address                                    | Lot Size    | Zone      | County',
  );
  console.log('-'.repeat(100));

  properties.forEach((p, i) => {
    const addr = p.address.substring(0, 40).padEnd(40);
    const size = `${p.lotSize.toLocaleString()} sqft`.padEnd(11);
    const zone = (p.zone || 'UNKNOWN').substring(0, 9).padEnd(9);
    console.log(`#${(i + 1).toString().padEnd(3)} | ${addr} | ${size} | ${zone} | ${p.county}`);
  });

  console.log('\n🏗️ ADU POTENTIAL:');
  console.log('-'.repeat(100));
  console.log('Rank | Viable | Buildable | Max ADU  | Dev Cost     | Rent/mo  | Cap Rate | Score');
  console.log('-'.repeat(100));

  properties.sort((a, b) => b.aduScore - a.aduScore);
  properties.forEach((p, i) => {
    p.aduRank = i + 1;
    const viable = p.aduViable ? '✅ Yes' : '❌ No ';
    const buildable = `${p.aduBuildableArea.toLocaleString()} sf`.padEnd(9);
    const maxAdu = `${p.aduRecommendedSize} sf`.padEnd(8);
    const cost = formatCurrency(p.aduDevelopmentCost).padEnd(12);
    const rent = formatCurrency(p.aduMonthlyRent).padEnd(8);
    const cap = formatPercent(p.aduCapRate).padEnd(8);
    console.log(
      `#${i + 1}   | ${viable} | ${buildable} | ${maxAdu} | ${cost} | ${rent} | ${cap} | ${p.aduScore}/100`,
    );
  });

  console.log('\n✂️ LOT SPLITTING POTENTIAL:');
  console.log('-'.repeat(100));
  console.log("Rank | Splittable | Max Lots | Min Req'd | Current Coverage | Score");
  console.log('-'.repeat(100));

  properties.sort((a, b) => b.splitScore - a.splitScore);
  properties.forEach((p, i) => {
    p.splitRank = i + 1;
    const splittable = p.splitPossible ? '✅ Yes' : '❌ No ';
    const maxLots = p.maxSplits.toString().padEnd(8);
    const minReq = `${p.minLotSizeRequired.toLocaleString()} sf`.padEnd(9);
    const coverage = `${(p.buildingCoverage * 100).toFixed(1)}%`.padEnd(16);
    console.log(
      `#${i + 1}   | ${splittable}     | ${maxLots} | ${minReq} | ${coverage} | ${p.splitScore}/100`,
    );
  });

  console.log('\n💰 INVESTMENT POTENTIAL:');
  console.log('-'.repeat(100));
  console.log('Rank | Overall Score | ADU Score | Split Score | Investment Score');
  console.log('-'.repeat(100));

  properties.sort((a, b) => b.overallScore - a.overallScore);
  properties.forEach((p, i) => {
    p.overallRank = i + 1;
    const overall = `${p.overallScore}/100`.padEnd(13);
    const adu = `${p.aduScore}/100`.padEnd(9);
    const split = `${p.splitScore}/100`.padEnd(11);
    const invest = `${p.investmentScore}/100`.padEnd(16);
    console.log(`#${i + 1}   | ${overall} | ${adu} | ${split} | ${invest}`);
  });

  // Winner summary
  console.log('\n🏆 TOP RECOMMENDATIONS:');
  console.log('='.repeat(100));

  const topOverall = properties[0];
  console.log(`\n🥇 BEST OVERALL: ${topOverall.address}`);
  console.log(`   Score: ${topOverall.overallScore}/100`);
  console.log(`   ${topOverall.lotSize.toLocaleString()} sqft lot in ${topOverall.zone} zone`);
  if (topOverall.aduViable) {
    console.log(`   ✅ Can build ${topOverall.aduRecommendedSize} sqft ADU`);
    console.log(`   💰 ${formatPercent(topOverall.aduCapRate)} cap rate`);
  }
  if (topOverall.splitPossible) {
    console.log(`   ✅ Can split into ${topOverall.maxSplits} lots`);
  }

  // Best for ADU
  const bestAdu = properties.sort((a, b) => b.aduScore - a.aduScore)[0];
  if (bestAdu.address !== topOverall.address) {
    console.log(`\n🏠 BEST FOR ADU: ${bestAdu.address}`);
    console.log(`   ADU Score: ${bestAdu.aduScore}/100`);
    console.log(`   ${bestAdu.aduBuildableArea.toLocaleString()} sqft buildable area`);
    console.log(`   💰 ${formatCurrency(bestAdu.aduMonthlyRent)}/month potential rent`);
  }

  // Best for splitting
  const bestSplit = properties.sort((a, b) => b.splitScore - a.splitScore)[0];
  if (bestSplit.splitPossible && bestSplit.address !== topOverall.address) {
    console.log(`\n✂️ BEST FOR SPLITTING: ${bestSplit.address}`);
    console.log(`   Split Score: ${bestSplit.splitScore}/100`);
    console.log(
      `   Can create ${bestSplit.maxSplits} lots from ${bestSplit.lotSize.toLocaleString()} sqft`,
    );
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🏘️ PROPERTY COMPARISON & RANKING TOOL');
  console.log('📅 ' + new Date().toLocaleString());
  console.log('='.repeat(100));

  // Parse arguments
  const args = process.argv.slice(2);
  let addresses: string[] = [];

  // Check for file input
  if (args[0] === '--file' && args[1]) {
    try {
      const fileContent = await fs.readFile(args[1], 'utf-8');
      addresses = fileContent.split('\n').filter((line) => line.trim());
    } catch (error) {
      console.error(`❌ Could not read file: ${args[1]}`);
      return;
    }
  } else {
    // Direct addresses from command line
    addresses = args.filter((arg) => !arg.startsWith('--'));
  }

  // Default addresses if none provided
  if (addresses.length === 0) {
    console.log('\n⚠️  No addresses provided. Using example properties:');
    addresses = [
      '20616 Archwood St, Winnetka, CA 91306',
      '10921 Polaris Dr, San Diego, CA 92126',
      '1843 S Bedford St, Los Angeles, CA 90035',
    ];
  }

  console.log(`\n📋 Comparing ${addresses.length} properties:`);
  addresses.forEach((addr, i) => console.log(`   ${i + 1}. ${addr}`));

  // Analyze each property
  const results: PropertyAnalysis[] = [];

  for (const address of addresses) {
    const analysis = await analyzeProperty(address);
    if (analysis) {
      results.push(analysis);
    }
  }

  if (results.length === 0) {
    console.log('\n❌ No properties could be analyzed');
    return;
  }

  // Display comparison
  displayComparison(results);

  // Save results
  const outputFile = `property_comparison_${Date.now()}.json`;
  await fs.writeFile(
    outputFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        properties: results,
      },
      null,
      2,
    ),
  );
  console.log(`\n💾 Detailed results saved to: ${outputFile}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
