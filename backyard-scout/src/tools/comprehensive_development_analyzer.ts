#!/usr/bin/env tsx
/**
 * Comprehensive Development Analysis for California Properties
 * Analyzes ADU, SB 9 subdivision, and multi-unit development potential
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { getEnhancedZoning, getZoningRequirementsFromResult } from '../services/zoning_enhanced.js';
import { detectBuildings } from '../services/unified_building_detector.js';
import { formatCurrency } from '../formulas/adu_formulas.js';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

interface DevelopmentAnalysis {
  address: string;
  apn: string;
  lotSize: number;
  zone: string;
  currentBuildings: number;
  buildingCoverage: number;

  // ADU Analysis
  aduBuildableArea: number;
  maxAduSize: number;
  aduViable: boolean;

  // SB 9 Analysis
  sb9Eligible: boolean;
  sb9Constraints: string[];
  minLotSize: number;
  resultingLotSizes: number[];
  maxUnitsWithSplit: number;

  // Multi-unit potential
  baseUnitsAllowed: number;
  bonusDensityUnits: number;
  totalPotentialUnits: number;

  // Financial projections
  scenarios: {
    name: string;
    units: number;
    developmentCost: number;
    monthlyRent: number;
    annualNOI: number;
    capRate: number;
    totalValue: number;
  }[];

  bestStrategy: string;
  keyOpportunities: string[];
  constraints: string[];
}

/**
 * Zone-based minimum lot sizes for SB 9 lot splitting
 */
const ZONE_MIN_LOT_SIZES: Record<string, number> = {
  'RS-1': 5000,
  'RS-1-RIO': 5000,
  R1: 5000,
  RD2: 2500, // Multi-family zone
  'EMX-1': 2500, // Mixed use
  PD: 5000, // Planned Development - varies
};

/**
 * Zone-based unit density
 */
const ZONE_DENSITY: Record<string, number> = {
  'RS-1': 1, // Single family
  'RS-1-RIO': 1,
  R1: 1,
  RD2: 2, // Duplex allowed
  'EMX-1': 4, // Mixed use - higher density
  PD: 2, // Planned Development - varies
};

async function getParcel(address: string): Promise<any> {
  const whereClause = `SITE_ADDR LIKE '%${address.split(',')[0].trim().toUpperCase()}%'`;

  const params = new URLSearchParams({
    where: whereClause,
    outFields: '*',
    f: 'json',
    returnGeometry: 'true',
  });

  const response = await fetch(`${CA_PARCELS_URL}/query?${params}`);
  const data = await response.json();

  if (data.features && data.features.length > 0) {
    return data.features[0];
  }

  return null;
}

async function analyzeProperty(address: string): Promise<DevelopmentAnalysis> {
  console.log(`\n🔍 Analyzing: ${address}`);

  // Get parcel data
  const parcel = await getParcel(address);
  if (!parcel) {
    throw new Error(`Parcel not found for ${address}`);
  }

  const attrs = parcel.attributes;
  const geometry = parcel.geometry;

  // Calculate lot area
  const polygon = turf.polygon(geometry.rings);
  const areaM2 = turf.area(polygon);
  const lotSize = Math.round(areaM2 * 10.764); // Convert to sqft

  console.log(`   ✅ Found APN: ${attrs.PARCEL_APN}`);
  console.log(`   📐 Lot Size: ${lotSize.toLocaleString()} sqft`);

  // Get zoning
  const coords = turf.centroid(polygon).geometry.coordinates;
  const zoningResult = await getEnhancedZoning(coords[1], coords[0]);
  const zone = zoningResult?.zone_code || 'RS-1';
  const setbacks = getZoningRequirementsFromResult(zoningResult);

  console.log(`   🏘️ Zone: ${zone}`);

  // Detect buildings
  const buildingResult = await detectBuildings(polygon);
  const buildingArea = buildingResult.totalArea || lotSize * 0.22; // Default 22% coverage
  const buildingCoverage = buildingArea / lotSize;

  console.log(
    `   🏢 Buildings: ${Math.round(buildingArea).toLocaleString()} sqft (${(buildingCoverage * 100).toFixed(1)}%)`,
  );

  // ADU Analysis
  const envelopeArea = lotSize * 0.75; // Simplified - after setbacks
  const aduBuildableArea = Math.max(0, envelopeArea - buildingArea);
  const maxAduSize = Math.min(1200, lotSize * 0.4);
  const aduViable = aduBuildableArea >= 770;

  // SB 9 Analysis
  const minLotSize = ZONE_MIN_LOT_SIZES[zone] || 5000;
  const sb9Eligible = checkSB9Eligibility(lotSize, zone, buildingCoverage);
  const sb9Constraints = getSB9Constraints(attrs, zone, lotSize, buildingCoverage);

  let resultingLotSizes: number[] = [];
  let maxUnitsWithSplit = 1;

  if (sb9Eligible && lotSize >= minLotSize * 2) {
    // Can split into 2 lots (40/60 split allowed)
    const smallerLot = lotSize * 0.4;
    const largerLot = lotSize * 0.6;
    resultingLotSizes = [largerLot, smallerLot];

    // Each lot can have: 1 primary unit + 1 ADU
    // Total: 2 primary units + 2 ADUs = 4 units
    maxUnitsWithSplit = 4;
  }

  // Multi-unit potential (without SB 9)
  const baseUnitsAllowed = ZONE_DENSITY[zone] || 1;
  const bonusDensityUnits = zone.includes('EMX') || zone.includes('RD') ? 2 : 0;
  const totalPotentialUnits = baseUnitsAllowed + bonusDensityUnits + 1; // +1 for ADU

  // Financial Scenarios
  const scenarios = [];

  // Scenario 1: ADU Only
  if (aduViable) {
    const aduSize = Math.min(maxAduSize, aduBuildableArea);
    scenarios.push({
      name: 'ADU Only',
      units: 1,
      developmentCost: aduSize * 195,
      monthlyRent: aduSize * 3,
      annualNOI: aduSize * 3 * 12 * 0.665,
      capRate: (aduSize * 3 * 12 * 0.665) / (aduSize * 195),
      totalValue: (aduSize * 3 * 12 * 0.665) / 0.08, // 8% cap for valuation
    });
  }

  // Scenario 2: SB 9 Subdivision
  if (sb9Eligible && resultingLotSizes.length > 0) {
    const totalSqft = maxUnitsWithSplit * 800; // Assume 800 sqft per unit average
    const totalRent = totalSqft * 3;
    const devCost = totalSqft * 250; // Higher cost for subdivision

    scenarios.push({
      name: 'SB 9 Subdivision (4 units)',
      units: maxUnitsWithSplit,
      developmentCost: devCost,
      monthlyRent: totalRent,
      annualNOI: totalRent * 12 * 0.665,
      capRate: (totalRent * 12 * 0.665) / devCost,
      totalValue: (totalRent * 12 * 0.665) / 0.08,
    });
  }

  // Scenario 3: Multi-unit (if zoning allows)
  if (baseUnitsAllowed > 1) {
    const totalSqft = totalPotentialUnits * 900;
    const totalRent = totalSqft * 3;
    const devCost = totalSqft * 225;

    scenarios.push({
      name: `Multi-Unit (${totalPotentialUnits} units)`,
      units: totalPotentialUnits,
      developmentCost: devCost,
      monthlyRent: totalRent,
      annualNOI: totalRent * 12 * 0.665,
      capRate: (totalRent * 12 * 0.665) / devCost,
      totalValue: (totalRent * 12 * 0.665) / 0.08,
    });
  }

  // Determine best strategy
  const bestScenario = scenarios.reduce(
    (best, current) => (current.totalValue > (best?.totalValue || 0) ? current : best),
    scenarios[0],
  );

  const bestStrategy = bestScenario?.name || 'No viable development';

  // Key opportunities
  const keyOpportunities: string[] = [];
  if (sb9Eligible) keyOpportunities.push('Eligible for SB 9 lot split - up to 4 units possible');
  if (aduViable)
    keyOpportunities.push(
      `${Math.round(aduBuildableArea).toLocaleString()} sqft available for ADU`,
    );
  if (baseUnitsAllowed > 1) keyOpportunities.push(`Zoning allows ${baseUnitsAllowed} base units`);
  if (buildingCoverage < 0.25) keyOpportunities.push('Low existing coverage - easier development');

  // Constraints
  const constraints: string[] = [];
  if (buildingCoverage > 0.4) constraints.push('High existing building coverage');
  if (zone.includes('OVERLAY') || zone.includes('RIO'))
    constraints.push('Overlay zone - additional requirements');
  if (!sb9Eligible && sb9Constraints.length > 0) constraints.push(...sb9Constraints);

  return {
    address,
    apn: attrs.PARCEL_APN,
    lotSize,
    zone,
    currentBuildings: Math.round(buildingArea),
    buildingCoverage,
    aduBuildableArea: Math.round(aduBuildableArea),
    maxAduSize: Math.round(maxAduSize),
    aduViable,
    sb9Eligible,
    sb9Constraints,
    minLotSize,
    resultingLotSizes,
    maxUnitsWithSplit,
    baseUnitsAllowed,
    bonusDensityUnits,
    totalPotentialUnits,
    scenarios,
    bestStrategy,
    keyOpportunities,
    constraints,
  };
}

function checkSB9Eligibility(lotSize: number, zone: string, buildingCoverage: number): boolean {
  // Basic SB 9 requirements
  if (lotSize < 2400) return false; // Minimum 2400 sqft required

  // Check if single-family zone (required for SB 9)
  const eligibleZones = ['RS', 'R1', 'RS-1', 'RS-1-RIO', 'RD1'];
  const zoneBase = zone.split('-')[0];
  if (!eligibleZones.includes(zoneBase) && !eligibleZones.includes(zone)) {
    return false;
  }

  // Building coverage check
  if (buildingCoverage > 0.5) return false; // Too developed

  return true;
}

function getSB9Constraints(attrs: any, zone: string, lotSize: number, coverage: number): string[] {
  const constraints: string[] = [];

  if (lotSize < 2400) constraints.push('Lot too small for SB 9 (min 2400 sqft)');

  const eligibleZones = ['RS', 'R1', 'RS-1', 'RS-1-RIO', 'RD1'];
  const zoneBase = zone.split('-')[0];
  if (!eligibleZones.includes(zoneBase) && !eligibleZones.includes(zone)) {
    constraints.push(`Zone ${zone} not eligible for SB 9 (single-family zones only)`);
  }

  if (coverage > 0.5) constraints.push('Too much existing development for SB 9');

  // Note: Would need to check additional constraints like:
  // - Historic district
  // - Fire hazard zone
  // - Environmental constraints
  // - Owner occupancy requirement

  return constraints;
}

async function main() {
  console.log('🏗️ COMPREHENSIVE DEVELOPMENT ANALYSIS');
  console.log('📅 ' + new Date().toLocaleString());
  console.log('='.repeat(80));

  const addresses = process.argv.slice(2);

  if (addresses.length === 0) {
    console.log('Usage: npx tsx comprehensive_development_analyzer.ts "address1" "address2" ...');
    process.exit(1);
  }

  const results: DevelopmentAnalysis[] = [];

  for (const address of addresses) {
    try {
      const analysis = await analyzeProperty(address);
      results.push(analysis);
    } catch (error) {
      console.error(`❌ Error analyzing ${address}:`, error.message);
    }
  }

  // Display comprehensive results
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPREHENSIVE ANALYSIS RESULTS');
  console.log('='.repeat(80));

  for (const r of results) {
    console.log(`\n🏠 ${r.address}`);
    console.log('   ' + '-'.repeat(76));
    console.log(`   📍 APN: ${r.apn}`);
    console.log(`   📐 Lot Size: ${r.lotSize.toLocaleString()} sqft`);
    console.log(`   🏘️ Zone: ${r.zone}`);
    console.log(
      `   🏢 Current Buildings: ${r.currentBuildings.toLocaleString()} sqft (${(r.buildingCoverage * 100).toFixed(1)}%)`,
    );

    console.log('\n   📈 DEVELOPMENT OPTIONS:');

    // ADU Potential
    console.log(
      `   • ADU Potential: ${r.aduViable ? '✅' : '❌'} ${r.aduViable ? `(${r.aduBuildableArea.toLocaleString()} sqft buildable)` : '(insufficient space)'}`,
    );

    // SB 9 Potential
    console.log(
      `   • SB 9 Subdivision: ${r.sb9Eligible ? '✅' : '❌'} ${r.sb9Eligible ? `(Can create ${r.maxUnitsWithSplit} total units)` : ''}`,
    );
    if (r.sb9Eligible && r.resultingLotSizes.length > 0) {
      console.log(`     - Lot 1: ${Math.round(r.resultingLotSizes[0]).toLocaleString()} sqft`);
      console.log(`     - Lot 2: ${Math.round(r.resultingLotSizes[1]).toLocaleString()} sqft`);
    }

    // Multi-unit Potential
    console.log(`   • Multi-Unit By-Right: ${r.totalPotentialUnits} units possible`);

    console.log('\n   💰 FINANCIAL SCENARIOS:');
    for (const s of r.scenarios) {
      console.log(`   ${s.name}:`);
      console.log(`     - Units: ${s.units}`);
      console.log(`     - Development Cost: ${formatCurrency(s.developmentCost)}`);
      console.log(`     - Monthly Rent: ${formatCurrency(s.monthlyRent)}`);
      console.log(`     - Annual NOI: ${formatCurrency(s.annualNOI)}`);
      console.log(`     - Cap Rate: ${(s.capRate * 100).toFixed(1)}%`);
      console.log(`     - Total Value: ${formatCurrency(s.totalValue)}`);
    }

    console.log(`\n   🎯 RECOMMENDED STRATEGY: ${r.bestStrategy}`);

    if (r.keyOpportunities.length > 0) {
      console.log('\n   ✅ KEY OPPORTUNITIES:');
      r.keyOpportunities.forEach((o) => console.log(`     • ${o}`));
    }

    if (r.constraints.length > 0) {
      console.log('\n   ⚠️ CONSTRAINTS:');
      r.constraints.forEach((c) => console.log(`     • ${c}`));
    }
  }

  // Ranking
  console.log('\n' + '='.repeat(80));
  console.log('🏆 DEVELOPMENT RANKING');
  console.log('='.repeat(80));

  // Rank by SB 9 potential
  console.log('\n📋 BEST FOR SB 9 SUBDIVISION:');
  const sb9Candidates = results
    .filter((r) => r.sb9Eligible)
    .sort((a, b) => b.maxUnitsWithSplit - a.maxUnitsWithSplit);

  if (sb9Candidates.length > 0) {
    sb9Candidates.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.address.split(',')[0]}`);
      console.log(`      - ${r.maxUnitsWithSplit} total units possible`);
      console.log(`      - ${r.lotSize.toLocaleString()} sqft lot`);
      console.log(`      - Zone: ${r.zone}`);
    });
  } else {
    console.log('   ❌ None of the properties qualify for SB 9');
  }

  // Rank by overall development value
  console.log('\n💰 BEST OVERALL DEVELOPMENT VALUE:');
  const byValue = results.sort((a, b) => {
    const aValue = Math.max(...a.scenarios.map((s) => s.totalValue));
    const bValue = Math.max(...b.scenarios.map((s) => s.totalValue));
    return bValue - aValue;
  });

  byValue.forEach((r, i) => {
    const bestValue = Math.max(...r.scenarios.map((s) => s.totalValue));
    console.log(`   ${i + 1}. ${r.address.split(',')[0]}`);
    console.log(`      - Best Strategy: ${r.bestStrategy}`);
    console.log(`      - Estimated Value: ${formatCurrency(bestValue)}`);
  });

  // Save results
  const outputFile = `/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out/comprehensive_analysis_${Date.now()}.json`;
  const fs = await import('fs/promises');
  await fs.writeFile(outputFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 Full analysis saved to: ${outputFile}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
