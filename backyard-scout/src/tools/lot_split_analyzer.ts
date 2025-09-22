#!/usr/bin/env tsx
/**
 * Lot Splitting Feasibility Analyzer
 * Identifies parcels suitable for subdivision in a given area
 *
 * Usage:
 *   npx tsx src/tools/lot_split_analyzer.ts --zip 91301
 *   npx tsx src/tools/lot_split_analyzer.ts --city "Old Agoura" --min-size 20000
 *   npx tsx src/tools/lot_split_analyzer.ts --address "123 Main St, Agoura Hills, CA" --radius 0.5
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { getEnhancedZoning, getZoningRequirementsFromResult } from '../services/zoning_enhanced.js';
import { detectBuildings } from '../services/unified_building_detector.js';
import { formatCurrency } from '../formulas/adu_formulas.js';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

interface LotSplitCandidate {
  apn: string;
  address: string;
  currentSize: number;
  zone: string;
  minLotSize: number;
  maxSplits: number;
  resultingLotSizes: number[];
  existingBuildings: number;
  buildingToLandRatio: number;
  estimatedValue: number;
  splitPotentialScore: number;
  constraints: string[];
  opportunities: string[];
}

interface SearchCriteria {
  zip?: string;
  city?: string;
  address?: string;
  radius?: number; // miles
  minLotSize?: number; // sqft
  maxLotSize?: number; // sqft
  limit?: number;
}

/**
 * Zone-based minimum lot sizes for lot splitting (California typical)
 */
const ZONE_MIN_LOT_SIZES: Record<string, number> = {
  RA: 43560, // Rural Agricultural - 1 acre minimum
  RE: 20000, // Rural Estate - ~0.5 acre
  R1: 7500, // Single Family - typical
  RS: 7500, // Single Family Standard
  'R-1': 7500,
  'RS-1': 6000, // Smaller single family
  RD: 5000, // Residential Dense
  R2: 4000, // Two-family
  R3: 3000, // Multi-family
  PD: 10000, // Planned Development
  A: 43560, // Agricultural
  A1: 43560,
  A2: 87120, // 2 acres
  DEFAULT: 7500,
};

/**
 * Search for parcels in an area
 */
async function searchParcels(criteria: SearchCriteria): Promise<any[]> {
  console.log('\n🔍 Searching for parcels...');

  let whereClause = '1=1';

  if (criteria.zip) {
    whereClause = `SITE_ZIP = '${criteria.zip}'`;
  } else if (criteria.city) {
    whereClause = `UPPER(SITE_CITY) LIKE '%${criteria.city.toUpperCase()}%'`;
  } else if (criteria.address && criteria.radius) {
    // For radius search, we'd need to implement spatial query
    // For now, search in the same ZIP
    const zipMatch = criteria.address.match(/(\d{5})$/);
    if (zipMatch) {
      whereClause = `SITE_ZIP = '${zipMatch[1]}'`;
    }
  }

  // Add size filters
  if (criteria.minLotSize) {
    whereClause += ` AND SHAPE_Area >= ${criteria.minLotSize / 10.7639}`; // Convert sqft to m²
  }
  if (criteria.maxLotSize) {
    whereClause += ` AND SHAPE_Area <= ${criteria.maxLotSize / 10.7639}`;
  }

  const params = new URLSearchParams({
    f: 'json',
    where: whereClause,
    outFields: 'PARCEL_APN,SITE_ADDR,SITE_CITY,SITE_ZIP,SHAPE_Area,COUNTYNAME',
    returnGeometry: 'true',
    orderByFields: 'SHAPE_Area DESC',
    resultRecordCount: String(criteria.limit || 50),
  });

  try {
    const response = await fetch(`${CA_PARCELS_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as any;

    if (data.features && data.features.length > 0) {
      console.log(`   ✅ Found ${data.features.length} parcels`);
      return data.features;
    } else {
      console.log('   ❌ No parcels found matching criteria');
      return [];
    }
  } catch (error: any) {
    console.log(`   ❌ Search error: ${error.message}`);
    return [];
  }
}

/**
 * Analyze lot splitting potential
 */
async function analyzeLotSplit(parcel: any): Promise<LotSplitCandidate | null> {
  const attrs = parcel.attributes;
  const geometry = parcel.geometry;

  // Calculate area
  const polygon = turf.polygon(geometry.rings);
  const areaSqft = Math.round(turf.area(polygon) * 10.7639);
  const centroid = turf.centroid(polygon);

  // Get zoning
  let zone = 'UNKNOWN';
  let minLotSize = ZONE_MIN_LOT_SIZES.DEFAULT;

  try {
    const zoningData = await getEnhancedZoning(
      centroid.geometry.coordinates[1],
      centroid.geometry.coordinates[0],
    );

    if (zoningData?.zone_code) {
      zone = zoningData.zone_code;

      // Extract base zone for minimum lot size lookup
      const baseZone = zone.replace(/-.*$/, '').toUpperCase();
      minLotSize = ZONE_MIN_LOT_SIZES[baseZone] || ZONE_MIN_LOT_SIZES.DEFAULT;
    }
  } catch (error) {
    console.log(`   ⚠️ Could not get zoning for ${attrs.PARCEL_APN}`);
  }

  // Skip if lot is too small to split
  if (areaSqft < minLotSize * 2) {
    return null;
  }

  // Get existing buildings
  let buildingArea = 0;
  try {
    const buildingData = await detectBuildings(geometry, attrs.PARCEL_APN, attrs.COUNTYNAME);
    buildingArea = buildingData.total_area_sqft;
  } catch (error) {
    // Use estimate if detection fails
    buildingArea = areaSqft * 0.15; // Conservative estimate
  }

  // Calculate splitting potential
  const maxSplits = Math.floor(areaSqft / minLotSize);
  const resultingLotSizes: number[] = [];

  // Calculate optimal split sizes
  if (maxSplits === 2) {
    // Simple 50/50 split
    resultingLotSizes.push(areaSqft / 2, areaSqft / 2);
  } else if (maxSplits > 2) {
    // Try to create equal-sized lots
    const equalSize = areaSqft / maxSplits;
    for (let i = 0; i < maxSplits; i++) {
      resultingLotSizes.push(equalSize);
    }
  }

  // Calculate building to land ratio
  const buildingToLandRatio = buildingArea / areaSqft;

  // Score the split potential (0-100)
  let score = 0;

  // Size score (bigger lots that can be split more get higher scores)
  if (maxSplits >= 4) score += 40;
  else if (maxSplits === 3) score += 30;
  else if (maxSplits === 2) score += 20;

  // Building ratio score (less developed = better for splitting)
  if (buildingToLandRatio < 0.1) score += 30;
  else if (buildingToLandRatio < 0.2) score += 20;
  else if (buildingToLandRatio < 0.3) score += 10;

  // Lot efficiency score (how well it divides)
  const efficiency = (resultingLotSizes[0] * maxSplits) / areaSqft;
  score += efficiency * 20;

  // Zone desirability score
  if (['R1', 'RS', 'RS-1'].includes(zone.split('-')[0])) score += 10;

  // Identify constraints and opportunities
  const constraints: string[] = [];
  const opportunities: string[] = [];

  if (buildingToLandRatio > 0.25) {
    constraints.push('Existing buildings may complicate subdivision');
  }

  if (zone.includes('RIO') || zone.includes('OVERLAY')) {
    constraints.push('Overlay zone may have additional requirements');
  }

  if (maxSplits > 2) {
    opportunities.push(
      `Can create ${maxSplits} lots of ${Math.round(resultingLotSizes[0]).toLocaleString()} sqft each`,
    );
  }

  if (buildingToLandRatio < 0.15) {
    opportunities.push('Low existing development - easier to subdivide');
  }

  // Rough value estimate (very simplified)
  const landValuePerSqft = 50; // $50/sqft baseline
  const subdivisionPremium = 1.5; // 50% premium for subdividable land
  const estimatedValue = areaSqft * landValuePerSqft * (maxSplits > 1 ? subdivisionPremium : 1);

  return {
    apn: attrs.PARCEL_APN,
    address: attrs.SITE_ADDR || 'Unknown',
    currentSize: areaSqft,
    zone,
    minLotSize,
    maxSplits,
    resultingLotSizes,
    existingBuildings: Math.round(buildingArea),
    buildingToLandRatio,
    estimatedValue,
    splitPotentialScore: Math.round(score),
    constraints,
    opportunities,
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('🏘️ LOT SPLITTING FEASIBILITY ANALYZER');
  console.log('📅 ' + new Date().toLocaleString());
  console.log('='.repeat(60));

  // Parse command line arguments
  const args = process.argv.slice(2);
  const criteria: SearchCriteria = {
    minLotSize: 15000, // Default: look for lots > 15,000 sqft
    limit: 20,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--zip':
        criteria.zip = value;
        break;
      case '--city':
        criteria.city = value;
        break;
      case '--address':
        criteria.address = value;
        break;
      case '--radius':
        criteria.radius = parseFloat(value);
        break;
      case '--min-size':
        criteria.minLotSize = parseInt(value);
        break;
      case '--max-size':
        criteria.maxLotSize = parseInt(value);
        break;
      case '--limit':
        criteria.limit = parseInt(value);
        break;
    }
  }

  // Default to Old Agoura if no location specified
  if (!criteria.zip && !criteria.city && !criteria.address) {
    criteria.zip = '91301';
    console.log('\n📍 Defaulting to ZIP 91301 (Old Agoura area)');
  }

  console.log('\n🔎 Search Criteria:');
  if (criteria.zip) console.log(`   ZIP: ${criteria.zip}`);
  if (criteria.city) console.log(`   City: ${criteria.city}`);
  if (criteria.minLotSize)
    console.log(`   Min Lot Size: ${criteria.minLotSize.toLocaleString()} sqft`);
  if (criteria.maxLotSize)
    console.log(`   Max Lot Size: ${criteria.maxLotSize.toLocaleString()} sqft`);
  console.log(`   Result Limit: ${criteria.limit}`);

  // Search for parcels
  const parcels = await searchParcels(criteria);

  if (parcels.length === 0) {
    console.log('\n❌ No parcels found. Try adjusting search criteria.');
    return;
  }

  // Analyze each parcel
  console.log('\n📊 Analyzing lot splitting potential...\n');
  const candidates: LotSplitCandidate[] = [];

  for (const parcel of parcels) {
    const result = await analyzeLotSplit(parcel);
    if (result) {
      candidates.push(result);
    }
  }

  // Sort by score
  candidates.sort((a, b) => b.splitPotentialScore - a.splitPotentialScore);

  // Display top candidates
  console.log('\n🏆 TOP LOT SPLITTING CANDIDATES:');
  console.log('='.repeat(60));

  const topCandidates = candidates.slice(0, 10);

  for (let i = 0; i < topCandidates.length; i++) {
    const c = topCandidates[i];

    console.log(`\n${i + 1}. ${c.address}`);
    console.log('   ' + '-'.repeat(56));
    console.log(`   📍 APN: ${c.apn}`);
    console.log(
      `   📐 Current Size: ${c.currentSize.toLocaleString()} sqft (${(c.currentSize / 43560).toFixed(2)} acres)`,
    );
    console.log(`   🏘️ Zone: ${c.zone} (Min lot: ${c.minLotSize.toLocaleString()} sqft)`);
    console.log(`   ✂️ Max Splits: ${c.maxSplits} lots`);

    if (c.resultingLotSizes.length > 0) {
      console.log(
        `   📏 Resulting Lots: ${c.maxSplits} × ${Math.round(c.resultingLotSizes[0]).toLocaleString()} sqft`,
      );
    }

    console.log(
      `   🏢 Existing Buildings: ${c.existingBuildings.toLocaleString()} sqft (${(c.buildingToLandRatio * 100).toFixed(1)}% coverage)`,
    );
    console.log(`   💰 Estimated Land Value: ${formatCurrency(c.estimatedValue)}`);
    console.log(`   ⭐ Split Potential Score: ${c.splitPotentialScore}/100`);

    if (c.opportunities.length > 0) {
      console.log(`   ✅ Opportunities:`);
      c.opportunities.forEach((o) => console.log(`      • ${o}`));
    }

    if (c.constraints.length > 0) {
      console.log(`   ⚠️ Constraints:`);
      c.constraints.forEach((con) => console.log(`      • ${con}`));
    }
  }

  // Summary statistics
  console.log('\n📈 SUMMARY STATISTICS:');
  console.log('='.repeat(60));
  console.log(`   Total Parcels Analyzed: ${candidates.length}`);
  console.log(`   Subdividable Parcels: ${candidates.filter((c) => c.maxSplits >= 2).length}`);
  console.log(`   Parcels for 3+ Lots: ${candidates.filter((c) => c.maxSplits >= 3).length}`);

  const avgSize = candidates.reduce((sum, c) => sum + c.currentSize, 0) / candidates.length;
  console.log(`   Average Parcel Size: ${Math.round(avgSize).toLocaleString()} sqft`);

  const avgScore =
    candidates.reduce((sum, c) => sum + c.splitPotentialScore, 0) / candidates.length;
  console.log(`   Average Split Score: ${Math.round(avgScore)}/100`);

  // Save results
  const outputFile = `lot_split_analysis_${Date.now()}.json`;
  const fs = await import('fs/promises');
  await fs.writeFile(outputFile, JSON.stringify({ criteria, candidates: topCandidates }, null, 2));
  console.log(`\n💾 Results saved to: ${outputFile}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
