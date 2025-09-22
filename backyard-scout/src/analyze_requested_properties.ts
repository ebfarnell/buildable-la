import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { promises as fs } from 'node:fs';
// Removed unused import
import {
  detectBuildings,
  type BuildingDetectionResult,
} from './services/unified_building_detector.js';
import { getEnhancedZoning, getZoningRequirementsFromResult } from './services/zoning_enhanced.js';
import {
  calcBuildableEnvelope,
  calcNetBuildableArea,
  calcMaxADUSize,
  isADUViable,
  calcTotalDevelopmentCost,
  calcMonthlyRent,
  calcAnnualNOI,
  calcCapRate,
  calcCashOnCashReturn,
  calcPaybackMonths,
  formatCurrency,
  formatPercent,
} from './formulas/adu_formulas.js';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

// Helper function to calculate lot dimensions from geometry
function calculateDimensions(geometry: any): { width: number; depth: number } {
  const polygon = turf.polygon(geometry.rings);
  const bbox = turf.bbox(polygon);
  const [minX, minY, maxX, maxY] = bbox;

  // Convert from degrees to feet (approximate)
  const width = Math.round((maxX - minX) * 364000); // ~364000 ft per degree longitude at 34°N
  const depth = Math.round((maxY - minY) * 365000); // ~365000 ft per degree latitude

  return { width, depth };
}

interface PropertyConfig {
  address: string;
  searchQuery: string;
  county?: string;
  city?: string;
}

// Parse address to create search query
function createPropertyConfig(address: string): PropertyConfig {
  // Extract street number and street name
  const match = address.match(/(\d+)\s+(.+?)\s*,\s*([^,]+)\s*,\s*CA/i);
  if (!match || !match[1] || !match[2] || !match[3]) {
    throw new Error(`Cannot parse address: ${address}`);
  }

  const [_, streetNum, streetName, city] = match;

  // Create search terms from street name
  const streetParts = streetName
    .replace(
      /\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Pl|Place|Ct|Court|Blvd|Boulevard)$/i,
      '',
    )
    .trim()
    .split(/\s+/)
    .map((part) => part.toUpperCase());

  // Build search query - allow flexible matching
  const searchTerms = [`%${streetNum}%`];
  streetParts.forEach((part) => searchTerms.push(`%${part}%`));

  const searchQuery = `SITE_ADDR LIKE '${searchTerms.join('')}'`;

  return {
    address,
    searchQuery,
    city: city.toUpperCase(),
  };
}

async function findParcel(config: PropertyConfig) {
  console.log(`\n🔍 Searching for: ${config.address}`);

  // First try with the search query
  let params = new URLSearchParams({
    f: 'json',
    where: config.searchQuery,
    outFields: '*',
    returnGeometry: 'true',
    resultRecordCount: '10',
  });

  try {
    const response = await fetch(`${CA_PARCELS_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as any;

    if (data.features && data.features.length > 0) {
      // If we have multiple results, try to find the best match
      let bestMatch = data.features[0];

      if (data.features.length > 1) {
        // Try to find exact address match
        const addressNum = config.address.match(/^(\d+)/)?.[1];
        for (const feature of data.features) {
          const siteAddr = feature.attributes.SITE_ADDR || '';
          if (siteAddr.includes(addressNum)) {
            bestMatch = feature;
            break;
          }
        }
      }

      const attrs = bestMatch.attributes;
      console.log(`   ✅ Found parcel: APN ${attrs.PARCEL_APN}`);
      console.log(`      Address: ${attrs.SITE_ADDR || 'N/A'}`);
      console.log(`      County: ${attrs.COUNTYNAME}`);
      console.log(`      City: ${attrs.SITE_CITY}`);

      // Update config with actual county from result
      config.county = attrs.COUNTYNAME;

      return bestMatch;
    }
  } catch (error) {
    console.error(`   ❌ Error: ${error}`);
  }

  console.log(`   ❌ Parcel not found`);
  return null;
}

async function analyzeProperty(config: PropertyConfig, parcelFeature: any) {
  const attrs = parcelFeature.attributes;
  const geometry = parcelFeature.geometry;

  console.log('\n' + '='.repeat(80));
  console.log(`📍 PROPERTY: ${config.address}`);
  console.log('='.repeat(80));

  // Calculate lot area
  // Calculate area from geometry
  let areaSqft = 0;

  if (geometry && geometry.rings) {
    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: geometry.rings,
      },
      properties: {},
    };

    try {
      const areaM2 = turf.area(geojson as any);
      areaSqft = Math.round(areaM2 * 10.7639);
    } catch (error) {
      console.log(`   Error calculating area: ${error}`);
      areaSqft = 0;
    }
  }

  console.log(`\n📐 PARCEL DETAILS:`);
  console.log(`   APN: ${attrs.PARCEL_APN}`);
  console.log(`   Lot Size: ${areaSqft.toLocaleString()} sqft`);
  console.log(`   Zoning: Checking...`);

  // Get zoning data - centroid calculation removed as it was not being used
  // Can be re-added if coordinates are needed in future:
  // const geojsonForCentroid = {
  //   type: 'Feature',
  //   geometry: {
  //     type: 'Polygon',
  //     coordinates: geometry.rings,
  //   },
  //   properties: {},
  // };
  // const centroid = turf.centroid(geojsonForCentroid as any);
  // const [lng, lat] = centroid.geometry.coordinates;

  let zoningData;
  let setbacks: { front: number; side: number; rear: number } | null = null;
  let zoneName: string | null = null;

  try {
    // Create GeoJSON object for zoning lookup
    const parcelGeoJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: geometry.rings,
          },
          properties: {},
        },
      ],
    };

    zoningData = await getEnhancedZoning(parcelGeoJson, config.county);
    if (zoningData) {
      zoneName = zoningData.zone_code;
      const requirements = getZoningRequirementsFromResult(zoningData);
      if (requirements && requirements.setback_requirements) {
        setbacks = requirements.setback_requirements;
        console.log(`   Zone: ${zoneName}`);
        console.log(
          `   Setbacks: Front ${setbacks.front}', Side ${setbacks.side}', Rear ${setbacks.rear}'`,
        );
      } else if (zoneName) {
        console.log(`   Zone: ${zoneName}`);
        console.log(`   ❌ NO SETBACK DATA AVAILABLE`);
        console.log(`   ⚠️  Cannot calculate buildable envelope without setback requirements`);
      }
    } else {
      console.log(`   ❌ NO ZONING DATA AVAILABLE`);
      console.log(`   ⚠️  Cannot determine zone or setback requirements`);
    }
  } catch (error: any) {
    console.log(`   ❌ ERROR: Could not fetch zoning data`);
    console.log(`   Error: ${error.message}`);
  }

  // If we don't have setbacks, we cannot calculate buildable area
  if (!setbacks) {
    console.log(`\n📊 ADU BUILDABILITY ANALYSIS:`);
    console.log(`   ❌ CANNOT COMPLETE ANALYSIS - Missing setback data`);
    console.log(`   ⚠️  Real zoning data required for accurate analysis`);

    return {
      address: config.address,
      apn: attrs.PARCEL_APN,
      lotSize: areaSqft,
      zone: zoneName || 'UNKNOWN',
      buildableArea: 0,
      maxAduSize: 0,
      recommendedSize: 0,
      viable: false,
      monthlyRent: 0,
      developmentCost: 0,
      analysisNote: 'Incomplete - Missing zoning/setback data',
    };
  }

  // Get building footprints using unified detector
  console.log(`\n🏢 EXISTING BUILDINGS:`);
  let buildingsSqft = 0;
  let buildingDetection: BuildingDetectionResult;

  try {
    // Use unified building detector with comprehensive fallbacks
    buildingDetection = await detectBuildings(
      geometry,
      attrs.PARCEL_APN,
      config.county || attrs.COUNTYNAME,
      {
        aggressiveMatching: false,
        includePartial: true,
      },
    );

    buildingsSqft = buildingDetection.total_area_sqft;

    console.log(`   Buildings Found: ${buildingDetection.buildings.length}`);
    console.log(`   Total Building Area: ${buildingsSqft.toLocaleString()} sqft`);
    console.log(`   Detection Method: ${buildingDetection.detection_method}`);
    console.log(`   Data Quality: ${buildingDetection.data_quality.toUpperCase()}`);
    console.log(`   Confidence Score: ${(buildingDetection.confidence_score * 100).toFixed(0)}%`);
    console.log(`   Sources Checked: ${buildingDetection.sources_checked.join(', ')}`);

    if (buildingDetection.cache_hit) {
      console.log(`   📦 Data from cache`);
    }

    if (buildingDetection.data_quality === 'estimated') {
      console.log(`   ⚠️  Using estimated data - actual building footprints not available`);
    }
  } catch (error: any) {
    console.log(`   ❌ Building detection failed: ${error.message}`);
    console.log(`   Using basic 22% lot coverage estimate...`);

    // Ultimate fallback
    buildingsSqft = areaSqft * 0.22;
    buildingDetection = {
      buildings: [],
      total_area_sqft: buildingsSqft,
      lot_coverage_percent: 22,
      detection_method: 'Fallback Estimate',
      data_quality: 'estimated',
      confidence_score: 0.3,
      sources_checked: ['None - error occurred'],
      cache_hit: false,
    };

    console.log(`   Estimated: ${Math.round(buildingsSqft).toLocaleString()} sqft`);
  }

  // Calculate buildable area
  console.log(`\n📊 ADU BUILDABILITY ANALYSIS:`);

  // Calculate lot dimensions from geometry
  const dimensions = calculateDimensions(geometry);

  const envelopeSqft = calcBuildableEnvelope(
    dimensions.width,
    dimensions.depth,
    setbacks.front,
    setbacks.side,
    setbacks.rear,
  );
  const netBuildableSqft = calcNetBuildableArea(envelopeSqft, buildingsSqft);
  const maxAduSize = calcMaxADUSize(areaSqft); // Uses defaults: 1200 sqft max, 40% lot coverage
  const recommendedSize = Math.min(maxAduSize, netBuildableSqft, 1200);
  const viable = isADUViable(netBuildableSqft);

  console.log(`   Buildable Envelope: ${Math.round(envelopeSqft).toLocaleString()} sqft`);
  console.log(`   Existing Buildings: ${Math.round(buildingsSqft).toLocaleString()} sqft`);
  console.log(`   Net Buildable Area: ${Math.round(netBuildableSqft).toLocaleString()} sqft`);
  console.log(`   Max ADU Size: ${maxAduSize.toLocaleString()} sqft`);
  console.log(`   Recommended ADU: ${recommendedSize.toLocaleString()} sqft`);
  console.log(`   ADU Viability: ${viable ? '✅ YES' : '❌ NO'} (min 770 sqft required)`);

  if (viable) {
    // Financial analysis
    console.log(`\n💰 FINANCIAL ANALYSIS (${recommendedSize} sqft ADU):`);

    const devCost = calcTotalDevelopmentCost(recommendedSize);
    const monthlyRent = calcMonthlyRent(recommendedSize); // Uses default $3/sqft
    const annualNOI = calcAnnualNOI(monthlyRent);
    const capRate = calcCapRate(annualNOI, devCost);
    const cashOnCash = calcCashOnCashReturn(annualNOI, devCost * 0.25); // 25% down
    const paybackMonths = calcPaybackMonths(devCost, monthlyRent - monthlyRent * 0.25); // Simple calc

    console.log(`   Development Cost: ${formatCurrency(devCost)}`);
    console.log(`   Monthly Rent: ${formatCurrency(monthlyRent)}`);
    console.log(`   Annual NOI: ${formatCurrency(annualNOI)}`);
    console.log(`   Cap Rate: ${formatPercent(capRate)}`);
    console.log(`   Cash-on-Cash: ${formatPercent(cashOnCash)}`);
    console.log(`   Payback Period: ${Math.round(paybackMonths)} months`);

    // Opportunities & constraints
    console.log(`\n🎯 KEY OPPORTUNITIES:`);
    console.log(
      `   • ${Math.round(netBuildableSqft).toLocaleString()} sqft available for development`,
    );
    console.log(`   • Potential ${formatCurrency(monthlyRent)}/month rental income`);
    console.log(`   • ${formatPercent(capRate)} cap rate on investment`);

    console.log(`\n⚠️  CONSTRAINTS & REQUIREMENTS:`);
    console.log(
      `   • Must maintain ${setbacks.front}' front, ${setbacks.side}' side, ${setbacks.rear}' rear setbacks`,
    );
    console.log(`   • Maximum ADU size limited to ${maxAduSize.toLocaleString()} sqft`);
    console.log(`   • Check local ADU ordinances for additional requirements`);
    console.log(`   • Verify utility connections and access requirements`);
  }

  return {
    address: config.address,
    apn: attrs.PARCEL_APN,
    lotSize: areaSqft,
    zone: zoneName,
    buildableArea: netBuildableSqft,
    maxAduSize,
    recommendedSize,
    viable,
    monthlyRent: viable ? calcMonthlyRent(recommendedSize) : 0,
    developmentCost: viable ? calcTotalDevelopmentCost(recommendedSize) : 0,
  };
}

async function main(addresses?: string[]) {
  console.log('🏠 ADU BUILDABILITY ANALYSIS');
  console.log('📅 ' + new Date().toLocaleString());

  // Use command-line arguments or default addresses
  const propertyAddresses = addresses || [
    '20616 Archwood St, Winnetka, CA 91306',
    '10921 Polaris Dr, San Diego, CA 92126',
    '1843 S Bedford St, Los Angeles, CA 90035',
  ];

  console.log(`📋 Analyzing ${propertyAddresses.length} California Properties\n`);

  const properties: PropertyConfig[] = [];
  for (const addr of propertyAddresses) {
    try {
      properties.push(createPropertyConfig(addr));
    } catch (error: any) {
      console.error(`❌ Error parsing address "${addr}": ${error.message}`);
    }
  }

  if (properties.length === 0) {
    console.error('❌ No valid addresses to analyze');
    return;
  }

  type AnalysisResult = {
    address: string;
    apn: string;
    lotSize: number;
    zone: string | null;
    buildableArea: number;
    maxAduSize: number;
    recommendedSize: number;
    viable: boolean;
    monthlyRent: number;
    developmentCost: number;
  };

  type ErrorResult = {
    address: string;
    error: string;
  };

  const results: (AnalysisResult | ErrorResult)[] = [];

  for (const property of properties) {
    const parcel = await findParcel(property);
    if (parcel) {
      const analysis = await analyzeProperty(property, parcel);
      results.push(analysis);
    } else {
      results.push({
        address: property.address,
        error: 'Parcel not found',
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(80));

  const viable = results.filter((r): r is AnalysisResult => 'viable' in r && r.viable);
  console.log(`\nTotal Properties Analyzed: ${results.length}`);
  console.log(`Viable for ADU Development: ${viable.length}/${results.length}`);

  console.log('\n📋 VIABILITY SUMMARY:');
  for (const result of results) {
    if ('error' in result) {
      console.log(`   ❌ ${result.address}: ${result.error}`);
    } else {
      const status = result.viable ? '✅' : '❌';
      const details = result.viable
        ? `${Math.round(result.buildableArea).toLocaleString()} sqft buildable, ${formatCurrency(result.monthlyRent)}/mo rent`
        : `Only ${Math.round(result.buildableArea).toLocaleString()} sqft buildable (min 770 required)`;
      console.log(`   ${status} ${result.address}: ${details}`);
    }
  }

  if (viable.length > 0) {
    console.log('\n🏆 TOP OPPORTUNITIES:');
    const sorted = viable.sort((a, b) => b.buildableArea - a.buildableArea);
    sorted.forEach((prop, idx) => {
      console.log(`   ${idx + 1}. ${prop.address}`);
      console.log(`      • ${Math.round(prop.buildableArea).toLocaleString()} sqft buildable area`);
      console.log(`      • ${prop.recommendedSize.toLocaleString()} sqft recommended ADU`);
      console.log(`      • ${formatCurrency(prop.monthlyRent)}/month potential rent`);
      console.log(`      • ${formatCurrency(prop.developmentCost)} development cost`);
    });
  }

  // Save results
  const reportDir = '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out';
  await fs.mkdir(reportDir, { recursive: true });

  const reportPath = `${reportDir}/three_property_analysis_${Date.now()}.json`;
  await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Full report saved to: ${reportPath}`);
}

// Parse command line arguments
const args = process.argv.slice(2);

if (import.meta.main) {
  // If arguments provided, use them; otherwise use defaults
  const addresses = args.length > 0 ? args : undefined;

  main(addresses).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
