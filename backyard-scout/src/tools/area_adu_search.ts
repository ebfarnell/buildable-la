#!/usr/bin/env tsx
/**
 * Area-Wide ADU Opportunity Search
 * Finds all properties in an area and ranks them by ADU development potential
 *
 * Usage:
 *   npx tsx src/tools/area_adu_search.ts --zip 91301
 *   npx tsx src/tools/area_adu_search.ts --city "Agoura Hills"
 *   npx tsx src/tools/area_adu_search.ts --neighborhood "Old Agoura"
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
  calcCapRate,
  formatCurrency,
  formatPercent,
} from '../formulas/adu_formulas.js';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

interface ADUOpportunity {
  apn: string;
  address: string;
  lotSize: number;
  zone: string;
  buildableArea: number;
  maxAduSize: number;
  recommendedSize: number;
  viable: boolean;
  developmentCost: number;
  monthlyRent: number;
  capRate: number;
  opportunityScore: number;
  dataQuality: 'high' | 'medium' | 'low';
  constraints: string[];
  advantages: string[];
}

interface SearchOptions {
  zip?: string;
  city?: string;
  neighborhood?: string;
  minLotSize?: number;
  maxLotSize?: number;
  zonesOnly?: string[]; // Filter by specific zones
  excludeZones?: string[]; // Exclude specific zones
  limit?: number;
  onlyViable?: boolean;
}

/**
 * Search for parcels in an area
 */
async function searchAreaParcels(options: SearchOptions): Promise<any[]> {
  console.log('\n🔍 Searching for parcels in area...');

  let whereClause = '1=1';

  // Location filters
  if (options.zip) {
    whereClause = `SITE_ZIP = '${options.zip}'`;
  } else if (options.city) {
    whereClause = `UPPER(SITE_CITY) LIKE '%${options.city.toUpperCase()}%'`;
  } else if (options.neighborhood) {
    // Neighborhoods are typically part of city names or addresses
    whereClause = `UPPER(SITE_ADDR) LIKE '%${options.neighborhood.toUpperCase()}%' OR UPPER(SITE_CITY) LIKE '%${options.neighborhood.toUpperCase()}%'`;
  }

  // Size filters
  if (options.minLotSize) {
    whereClause += ` AND SHAPE_Area >= ${options.minLotSize / 10.7639}`;
  }
  if (options.maxLotSize) {
    whereClause += ` AND SHAPE_Area <= ${options.maxLotSize / 10.7639}`;
  }

  // Exclude very small lots that can't support ADUs
  whereClause += ` AND SHAPE_Area >= ${3000 / 10.7639}`; // Min 3000 sqft

  const params = new URLSearchParams({
    f: 'json',
    where: whereClause,
    outFields: 'PARCEL_APN,SITE_ADDR,SITE_CITY,SITE_ZIP,SHAPE_Area,COUNTYNAME,YR_BLT',
    returnGeometry: 'true',
    orderByFields: 'SHAPE_Area DESC',
    resultRecordCount: String(options.limit || 100),
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
      console.log('   ❌ No parcels found in area');
      return [];
    }
  } catch (error: any) {
    console.log(`   ❌ Search error: ${error.message}`);
    return [];
  }
}

/**
 * Analyze ADU potential for a parcel
 */
async function analyzeADUPotential(parcel: any): Promise<ADUOpportunity | null> {
  const attrs = parcel.attributes;
  const geometry = parcel.geometry;

  // Calculate area
  const polygon = turf.polygon(geometry.rings);
  const areaSqft = Math.round(turf.area(polygon) * 10.7639);
  const centroid = turf.centroid(polygon);

  // Skip tiny lots
  if (areaSqft < 3000) return null;

  // Calculate dimensions (approximate)
  const bbox = turf.bbox(polygon);
  const width = Math.round((bbox[2] - bbox[0]) * 364000);
  const depth = Math.round((bbox[3] - bbox[1]) * 365000);

  // Get zoning
  let zone = 'UNKNOWN';
  let setbacks = { front: 20, side: 5, rear: 15 }; // Defaults
  let dataQuality: 'high' | 'medium' | 'low' = 'low';

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
        dataQuality = 'high';
      }
    }
  } catch (_error) {
    // Use defaults
  }

  // Filter by zone if specified
  // (This would normally be done in the query, but parcel API doesn't have zoning)
  // So we do it here after fetching zoning data

  // Get existing buildings
  let buildingArea = 0;
  let buildingDataQuality = 'low';

  try {
    const buildingData = await detectBuildings(geometry, attrs.PARCEL_APN, attrs.COUNTYNAME);
    buildingArea = buildingData.total_area_sqft;

    if (buildingData.data_quality === 'high' || buildingData.data_quality === 'medium') {
      buildingDataQuality = buildingData.data_quality as 'high' | 'medium';
    }
  } catch (_error) {
    // Use estimate
    buildingArea = areaSqft * 0.22;
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
  const viable = isADUViable(netBuildable);

  if (!viable && !recommendedSize) return null;

  // Financial calculations
  const developmentCost = calcTotalDevelopmentCost(recommendedSize);
  const monthlyRent = calcMonthlyRent(recommendedSize);
  const annualNOI = monthlyRent * 12 * 0.665; // 66.5% NOI margin
  const capRate = calcCapRate(annualNOI, developmentCost);

  // Calculate opportunity score (0-100)
  let score = 0;

  // Buildable area score (more space = better)
  if (netBuildable >= 1200) score += 30;
  else if (netBuildable >= 1000) score += 25;
  else if (netBuildable >= 770) score += 15;
  else score += 5;

  // Financial score (better returns = higher score)
  if (capRate >= 0.1) score += 30;
  else if (capRate >= 0.08) score += 25;
  else if (capRate >= 0.06) score += 20;
  else if (capRate >= 0.04) score += 10;

  // Lot efficiency (less existing building = better)
  const lotEfficiency = 1 - buildingArea / areaSqft;
  score += lotEfficiency * 20;

  // Data quality bonus
  if (dataQuality === 'high' && buildingDataQuality === 'high') score += 10;
  else if (dataQuality === 'high' || buildingDataQuality === 'high') score += 5;

  // Zone desirability
  if (['R1', 'RS', 'RS-1', 'RD'].includes(zone.split('-')[0])) score += 10;

  // Identify constraints and advantages
  const constraints: string[] = [];
  const advantages: string[] = [];

  if (buildingArea > areaSqft * 0.35) {
    constraints.push('High existing building coverage');
  }
  if (netBuildable < 900) {
    constraints.push(`Limited buildable area (${Math.round(netBuildable)} sqft)`);
  }
  if (zone === 'UNKNOWN') {
    constraints.push('Zoning data unavailable - verify with city');
  }

  if (netBuildable >= 1200) {
    advantages.push('Can build maximum 1,200 sqft ADU');
  }
  if (capRate >= 0.08) {
    advantages.push(`Strong ${formatPercent(capRate)} cap rate`);
  }
  if (areaSqft >= 10000) {
    advantages.push('Large lot provides flexibility');
  }
  if (buildingArea < areaSqft * 0.2) {
    advantages.push('Low existing development');
  }

  // Combine data quality
  const overallQuality =
    dataQuality === 'high' && buildingDataQuality === 'high'
      ? 'high'
      : dataQuality === 'high' || buildingDataQuality === 'high'
        ? 'medium'
        : 'low';

  return {
    apn: attrs.PARCEL_APN,
    address: attrs.SITE_ADDR || 'Address not available',
    lotSize: areaSqft,
    zone,
    buildableArea: Math.round(netBuildable),
    maxAduSize,
    recommendedSize: Math.round(recommendedSize),
    viable,
    developmentCost,
    monthlyRent,
    capRate,
    opportunityScore: Math.round(score),
    dataQuality: overallQuality,
    constraints,
    advantages,
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('🏡 AREA-WIDE ADU OPPORTUNITY SEARCH');
  console.log('📅 ' + new Date().toLocaleString());
  console.log('='.repeat(60));

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options: SearchOptions = {
    minLotSize: 4000, // Default minimum
    limit: 50,
    onlyViable: true,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--zip':
        options.zip = value;
        break;
      case '--city':
        options.city = value;
        break;
      case '--neighborhood':
        options.neighborhood = value;
        break;
      case '--min-lot':
        options.minLotSize = parseInt(value);
        break;
      case '--max-lot':
        options.maxLotSize = parseInt(value);
        break;
      case '--limit':
        options.limit = parseInt(value);
        break;
      case '--all':
        options.onlyViable = false;
        break;
    }
  }

  // Default search
  if (!options.zip && !options.city && !options.neighborhood) {
    console.log('\n⚠️  No location specified. Use --zip, --city, or --neighborhood');
    console.log('Example: npx tsx src/tools/area_adu_search.ts --zip 91301');
    return;
  }

  console.log('\n🔎 Search Parameters:');
  if (options.zip) console.log(`   ZIP Code: ${options.zip}`);
  if (options.city) console.log(`   City: ${options.city}`);
  if (options.neighborhood) console.log(`   Neighborhood: ${options.neighborhood}`);
  console.log(`   Min Lot Size: ${options.minLotSize?.toLocaleString()} sqft`);
  if (options.maxLotSize)
    console.log(`   Max Lot Size: ${options.maxLotSize.toLocaleString()} sqft`);
  console.log(`   Showing: ${options.onlyViable ? 'Viable properties only' : 'All properties'}`);

  // Search parcels
  const parcels = await searchAreaParcels(options);

  if (parcels.length === 0) {
    console.log('\n❌ No parcels found. Try different search criteria.');
    return;
  }

  // Analyze each parcel
  console.log('\n📊 Analyzing ADU potential for each property...\n');
  const opportunities: ADUOpportunity[] = [];

  let processed = 0;
  for (const parcel of parcels) {
    processed++;
    if (processed % 10 === 0) {
      console.log(`   Processed ${processed}/${parcels.length} properties...`);
    }

    const analysis = await analyzeADUPotential(parcel);
    if (analysis && (!options.onlyViable || analysis.viable)) {
      opportunities.push(analysis);
    }
  }

  // Sort by opportunity score
  opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);

  // Display results
  console.log('\n🏆 TOP ADU DEVELOPMENT OPPORTUNITIES:');
  console.log('='.repeat(60));

  const topOpportunities = opportunities.slice(0, 15);

  for (let i = 0; i < topOpportunities.length; i++) {
    const opp = topOpportunities[i];

    console.log(`\n${i + 1}. ${opp.address}`);
    console.log('   ' + '-'.repeat(56));
    console.log(`   📍 APN: ${opp.apn}`);
    console.log(`   📐 Lot Size: ${opp.lotSize.toLocaleString()} sqft`);
    console.log(`   🏘️ Zone: ${opp.zone}`);
    console.log(`   🏗️ Buildable Area: ${opp.buildableArea.toLocaleString()} sqft`);
    console.log(`   🏠 Recommended ADU: ${opp.recommendedSize.toLocaleString()} sqft`);
    console.log(`   💰 Development Cost: ${formatCurrency(opp.developmentCost)}`);
    console.log(`   📈 Monthly Rent: ${formatCurrency(opp.monthlyRent)}`);
    console.log(`   💵 Cap Rate: ${formatPercent(opp.capRate)}`);
    console.log(`   ⭐ Opportunity Score: ${opp.opportunityScore}/100`);
    console.log(`   📊 Data Quality: ${opp.dataQuality.toUpperCase()}`);

    if (opp.advantages.length > 0) {
      console.log(`   ✅ Advantages:`);
      opp.advantages.forEach((adv) => console.log(`      • ${adv}`));
    }

    if (opp.constraints.length > 0) {
      console.log(`   ⚠️ Constraints:`);
      opp.constraints.forEach((con) => console.log(`      • ${con}`));
    }
  }

  // Summary statistics
  console.log('\n📈 AREA SUMMARY:');
  console.log('='.repeat(60));
  console.log(`   Total Properties Analyzed: ${parcels.length}`);
  console.log(`   Viable ADU Properties: ${opportunities.filter((o) => o.viable).length}`);
  console.log(
    `   Properties with 1000+ sqft ADU Potential: ${opportunities.filter((o) => o.recommendedSize >= 1000).length}`,
  );

  const avgLotSize = opportunities.reduce((sum, o) => sum + o.lotSize, 0) / opportunities.length;
  console.log(`   Average Lot Size: ${Math.round(avgLotSize).toLocaleString()} sqft`);

  const avgBuildable =
    opportunities.reduce((sum, o) => sum + o.buildableArea, 0) / opportunities.length;
  console.log(`   Average Buildable Area: ${Math.round(avgBuildable).toLocaleString()} sqft`);

  const avgCapRate = opportunities.reduce((sum, o) => sum + o.capRate, 0) / opportunities.length;
  console.log(`   Average Cap Rate: ${formatPercent(avgCapRate)}`);

  const highQuality = opportunities.filter((o) => o.dataQuality === 'high').length;
  const medQuality = opportunities.filter((o) => o.dataQuality === 'medium').length;
  console.log(
    `   Data Quality: ${highQuality} high, ${medQuality} medium, ${opportunities.length - highQuality - medQuality} low`,
  );

  // Save results
  const outputFile = `area_adu_search_${Date.now()}.json`;
  const fs = await import('fs/promises');
  await fs.writeFile(
    outputFile,
    JSON.stringify(
      {
        searchOptions: options,
        totalParcels: parcels.length,
        viableProperties: opportunities.filter((o) => o.viable).length,
        topOpportunities,
      },
      null,
      2,
    ),
  );
  console.log(`\n💾 Results saved to: ${outputFile}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
