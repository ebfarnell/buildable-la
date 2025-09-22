#!/usr/bin/env tsx
/**
 * Complete ADU Feasibility Analyzer
 * Combines parcels, buildings, zoning, and setbacks for accurate ADU analysis
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { fetchParcelBoundary } from './services/parcel_fetcher';
import { getEnhancedZoning } from './services/zoning_enhanced';

interface BuildingFootprint {
  id: string;
  area_sqft: number;
  source: string;
  confidence: number;
  within_parcel: boolean;
  geometry?: any;
}

interface ZoningInfo {
  zone_code: string;
  zone_name?: string;
  setbacks: {
    front: number;
    side: number;
    rear: number;
  };
  max_lot_coverage: number;
  max_adu_size: number;
}

interface ADUAnalysis {
  address: string;

  parcel: {
    apn: string;
    county: string;
    lot_size_sqft: number;
    lot_width_ft: number;
    lot_depth_ft: number;
  };

  zoning: ZoningInfo;

  existing_buildings: {
    count: number;
    total_area_sqft: number;
    lot_coverage_percent: number;
    primary_building?: BuildingFootprint;
  };

  buildable_analysis: {
    gross_lot_area: number;
    buildable_envelope: number;
    existing_buildings: number;
    net_buildable_area: number;
    max_adu_allowed: number;
    recommended_adu_size: number;
    remaining_coverage: number;
  };

  feasibility: {
    is_viable: boolean;
    viability_score: number; // 0-100
    constraints: string[];
    opportunities: string[];
  };

  financial: {
    development_cost: number;
    monthly_rent: number;
    annual_noi: number;
    cap_rate: number;
    payback_months: number;
  };
}

/**
 * Calculate lot dimensions from geometry
 */
function calculateLotDimensions(geometry: any): { width: number; depth: number } {
  try {
    const polygon = turf.polygon(geometry.rings);
    const bbox = turf.bbox(polygon);

    // Get the bounding box dimensions
    const [minX, minY, maxX, maxY] = bbox;

    // Convert to feet (approximation)
    const width = turf.distance([minX, minY], [maxX, minY], { units: 'feet' });
    const depth = turf.distance([minX, minY], [minX, maxY], { units: 'feet' });

    return {
      width: Math.round(width),
      depth: Math.round(depth),
    };
  } catch (error) {
    // Default dimensions based on square lot assumption
    const sideLength = Math.sqrt(7500); // Assume 7500 sqft average
    return {
      width: Math.round(sideLength),
      depth: Math.round(sideLength),
    };
  }
}

/**
 * Get zoning information with setbacks
 */
async function getZoningInfo(parcelGeometry: any, county: string): Promise<ZoningInfo> {
  // Default zoning if lookup fails
  const defaultZoning: ZoningInfo = {
    zone_code: 'UNKNOWN',
    zone_name: 'Unknown Zone',
    setbacks: {
      front: 20,
      side: 5,
      rear: 15,
    },
    max_lot_coverage: 40,
    max_adu_size: 1200,
  };

  try {
    // Create GeoJSON for zoning lookup
    const parcelGeoJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: parcelGeometry.rings,
          },
          properties: {},
        },
      ],
    };

    const zoningData = await getEnhancedZoning(parcelGeoJson, county);

    if (zoningData) {
      return {
        zone_code: zoningData.zone_code,
        zone_name: zoningData.zone_name || zoningData.description,
        setbacks: zoningData.setbacks || {
          front: 20,
          side: 5,
          rear: 15,
        },
        max_lot_coverage: 40, // Default 40% for residential
        max_adu_size: 1200, // California state maximum
      };
    }
  } catch (error) {
    console.log(`   ⚠️ Zoning lookup failed: ${error}`);
  }

  return defaultZoning;
}

/**
 * Fetch buildings from both Microsoft and OpenStreetMap
 */
async function fetchBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const buildings: BuildingFootprint[] = [];

  // Try Microsoft Buildings
  try {
    const [minX, minY, maxX, maxY] = bbox;
    const params = new URLSearchParams({
      f: 'json',
      where: "STATE='CA'",
      geometry: `${minX},${minY},${maxX},${maxY}`,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      maxRecordCount: '100',
    });

    const url = `https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0/query?${params}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = (await response.json()) as any;

    for (const feature of data.features || []) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);
        buildings.push({
          id: `MSFT_${feature.attributes?.OBJECTID}`,
          area_sqft: area,
          source: 'Microsoft',
          confidence: 0,
          within_parcel: false,
          geometry: feature.geometry,
        });
      }
    }
  } catch (error) {
    // Silent fail, try OSM
  }

  // Try OpenStreetMap
  try {
    const [minX, minY, maxX, maxY] = bbox;
    const query = `[out:json][timeout:10];
      way["building"](${minY},${minX},${maxY},${maxX});
      out geom;`;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
    });

    const data = (await response.json()) as any;

    for (const element of data.elements || []) {
      if (element.type === 'way' && element.geometry) {
        const coords = element.geometry.map((node: any) => [node.lon, node.lat]);
        coords.push(coords[0]);

        const polygon = turf.polygon([coords]);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `OSM_${element.id}`,
          area_sqft: area,
          source: 'OSM',
          confidence: 0,
          within_parcel: false,
          geometry: { rings: [coords] },
        });
      }
    }
  } catch (error) {
    // Silent fail
  }

  return buildings;
}

/**
 * Match buildings to parcel
 */
function matchBuildingsToParcel(
  buildings: BuildingFootprint[],
  parcelGeometry: any,
): BuildingFootprint[] {
  const parcelPolygon = turf.polygon(parcelGeometry.rings);
  const matched: BuildingFootprint[] = [];

  for (const building of buildings) {
    if (!building.geometry) continue;

    try {
      const buildingPolygon = turf.polygon(building.geometry.rings);

      // Check if building is within or overlaps parcel
      const isWithin = turf.booleanWithin(buildingPolygon, parcelPolygon);
      const intersection = turf.intersect(buildingPolygon, parcelPolygon);

      if (isWithin || intersection) {
        const overlapArea = intersection ? turf.area(intersection) * 10.7639 : building.area_sqft;
        const overlapPercent = (overlapArea / building.area_sqft) * 100;

        if (overlapPercent >= 50) {
          matched.push({
            ...building,
            within_parcel: isWithin,
            confidence: isWithin ? 95 : Math.round(overlapPercent),
          });
        }
      }
    } catch (error) {
      // Skip invalid geometries
    }
  }

  return matched.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Calculate buildable envelope after setbacks
 */
function calculateBuildableEnvelope(parcelGeometry: any, setbacks: ZoningInfo['setbacks']): number {
  try {
    const parcelPolygon = turf.polygon(parcelGeometry.rings);

    // Apply uniform setback as buffer
    const avgSetback = (setbacks.front + setbacks.rear + setbacks.side * 2) / 4;
    const envelope = turf.buffer(parcelPolygon, -avgSetback, { units: 'feet' });

    if (envelope) {
      return Math.round(turf.area(envelope) * 10.7639);
    }
  } catch (error) {
    // Fallback calculation
    const parcelArea = turf.area(turf.polygon(parcelGeometry.rings)) * 10.7639;
    return Math.round(parcelArea * 0.6); // Assume 60% after setbacks
  }

  return 0;
}

/**
 * Calculate net buildable area
 */
function calculateNetBuildableArea(
  buildableEnvelope: number,
  existingBuildings: BuildingFootprint[],
): number {
  const totalBuildingArea = existingBuildings.reduce((sum, b) => sum + b.area_sqft, 0);
  return Math.max(0, buildableEnvelope - totalBuildingArea);
}

/**
 * Determine ADU feasibility
 */
function determineFeasibility(
  netBuildableArea: number,
  maxAduSize: number,
  existingCoverage: number,
  maxCoverage: number,
): {
  is_viable: boolean;
  viability_score: number;
  constraints: string[];
  opportunities: string[];
} {
  const constraints: string[] = [];
  const opportunities: string[] = [];
  let score = 0;

  // Check minimum viable area (770 sqft for ADU)
  if (netBuildableArea >= 770) {
    score += 40;
    opportunities.push(`${netBuildableArea.toLocaleString()} sqft available for ADU`);
  } else {
    constraints.push(`Only ${netBuildableArea} sqft available (min 770 required)`);
  }

  // Check if we can build max ADU size
  if (netBuildableArea >= maxAduSize) {
    score += 30;
    opportunities.push(`Can build maximum ${maxAduSize} sqft ADU`);
  } else if (netBuildableArea >= 1000) {
    score += 20;
    opportunities.push(`Can build ${Math.min(netBuildableArea, maxAduSize)} sqft ADU`);
  }

  // Check lot coverage
  const remainingCoverage = maxCoverage - existingCoverage;
  if (remainingCoverage >= 15) {
    score += 20;
    opportunities.push(`${remainingCoverage}% lot coverage available`);
  } else if (remainingCoverage < 5) {
    constraints.push(`Only ${remainingCoverage}% coverage remaining`);
  }

  // Check if good size lot
  if (netBuildableArea >= 1500) {
    score += 10;
    opportunities.push('Excellent buildable area available');
  }

  // Add general constraints
  if (existingCoverage > 30) {
    constraints.push('Significant existing development on lot');
  }

  return {
    is_viable: netBuildableArea >= 770,
    viability_score: Math.min(100, score),
    constraints,
    opportunities,
  };
}

/**
 * Calculate financial projections
 */
function calculateFinancials(aduSize: number): ADUAnalysis['financial'] {
  const costPerSqft = 195;
  const rentPerSqft = 3;

  const developmentCost = aduSize * costPerSqft;
  const monthlyRent = Math.min(aduSize * rentPerSqft, 5000); // Cap at $5000
  const annualGross = monthlyRent * 12;
  const annualNOI = annualGross * 0.665; // 33.5% for expenses
  const capRate = (annualNOI / developmentCost) * 100;
  const paybackMonths = Math.round(developmentCost / (annualNOI / 12));

  return {
    development_cost: Math.round(developmentCost),
    monthly_rent: Math.round(monthlyRent),
    annual_noi: Math.round(annualNOI),
    cap_rate: Math.round(capRate * 10) / 10,
    payback_months: paybackMonths,
  };
}

/**
 * Main ADU analysis function
 */
async function analyzeADUFeasibility(address: string): Promise<ADUAnalysis> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📍 ${address}`);
  console.log('='.repeat(70));

  // Initialize result
  const analysis: ADUAnalysis = {
    address,
    parcel: {
      apn: 'Unknown',
      county: 'Unknown',
      lot_size_sqft: 0,
      lot_width_ft: 0,
      lot_depth_ft: 0,
    },
    zoning: {
      zone_code: 'UNKNOWN',
      setbacks: { front: 20, side: 5, rear: 15 },
      max_lot_coverage: 40,
      max_adu_size: 1200,
    },
    existing_buildings: {
      count: 0,
      total_area_sqft: 0,
      lot_coverage_percent: 0,
    },
    buildable_analysis: {
      gross_lot_area: 0,
      buildable_envelope: 0,
      existing_buildings: 0,
      net_buildable_area: 0,
      max_adu_allowed: 0,
      recommended_adu_size: 0,
      remaining_coverage: 0,
    },
    feasibility: {
      is_viable: false,
      viability_score: 0,
      constraints: [],
      opportunities: [],
    },
    financial: {
      development_cost: 0,
      monthly_rent: 0,
      annual_noi: 0,
      cap_rate: 0,
      payback_months: 0,
    },
  };

  // Step 1: Fetch parcel
  console.log('\n📦 PARCEL DATA');
  const parcel = await fetchParcelBoundary(address, {
    useCache: true,
    timeout: 20000,
    retries: 1,
  });

  if (!parcel || !parcel.geometry) {
    console.log('   ❌ Could not fetch parcel data');
    analysis.feasibility.constraints.push('No parcel data available');
    return analysis;
  }

  const dimensions = calculateLotDimensions(parcel.geometry);

  analysis.parcel = {
    apn: parcel.apn,
    county: parcel.county,
    lot_size_sqft: parcel.area_sqft,
    lot_width_ft: dimensions.width,
    lot_depth_ft: dimensions.depth,
  };

  console.log(`   ✅ APN: ${parcel.apn}`);
  console.log(
    `   📐 Lot: ${parcel.area_sqft.toLocaleString()} sqft (${dimensions.width}' x ${dimensions.depth}')`,
  );

  // Step 2: Get zoning
  console.log('\n🏛️ ZONING DATA');
  const zoning = await getZoningInfo(parcel.geometry, parcel.county);
  analysis.zoning = zoning;

  console.log(`   Zone: ${zoning.zone_code}`);
  console.log(
    `   Setbacks: Front ${zoning.setbacks.front}', Side ${zoning.setbacks.side}', Rear ${zoning.setbacks.rear}'`,
  );

  // Step 3: Get buildings
  console.log('\n🏢 EXISTING BUILDINGS');
  const parcelPolygon = turf.polygon(parcel.geometry.rings);
  const buffered = turf.buffer(parcelPolygon, 100, { units: 'feet' });
  const bbox = turf.bbox(buffered!);

  const allBuildings = await fetchBuildings(bbox);
  const matchedBuildings = matchBuildingsToParcel(allBuildings, parcel.geometry);

  analysis.existing_buildings = {
    count: matchedBuildings.length,
    total_area_sqft: matchedBuildings.reduce((sum, b) => sum + b.area_sqft, 0),
    lot_coverage_percent: Math.round(
      (matchedBuildings.reduce((sum, b) => sum + b.area_sqft, 0) / parcel.area_sqft) * 100,
    ),
    primary_building: matchedBuildings[0],
  };

  if (matchedBuildings.length > 0) {
    console.log(`   Found: ${matchedBuildings.length} buildings`);
    console.log(
      `   Total: ${analysis.existing_buildings.total_area_sqft.toLocaleString()} sqft (${analysis.existing_buildings.lot_coverage_percent}% coverage)`,
    );
  } else {
    // Use estimate if no buildings found
    const estimate = Math.round(parcel.area_sqft * 0.22);
    analysis.existing_buildings.total_area_sqft = estimate;
    analysis.existing_buildings.lot_coverage_percent = 22;
    console.log(`   ⚠️ Using estimate: ${estimate.toLocaleString()} sqft (22% coverage)`);
  }

  // Step 4: Calculate buildable area
  console.log('\n📊 BUILDABLE AREA ANALYSIS');

  const buildableEnvelope = calculateBuildableEnvelope(parcel.geometry, zoning.setbacks);
  const netBuildable = calculateNetBuildableArea(
    buildableEnvelope,
    matchedBuildings.length > 0
      ? matchedBuildings
      : [
          {
            id: 'estimate',
            area_sqft: analysis.existing_buildings.total_area_sqft,
            source: 'estimate',
            confidence: 0,
            within_parcel: true,
          },
        ],
  );

  const maxAduFromCoverage = Math.round(
    parcel.area_sqft * (zoning.max_lot_coverage / 100) -
      analysis.existing_buildings.total_area_sqft,
  );
  const maxAduAllowed = Math.min(zoning.max_adu_size, maxAduFromCoverage, netBuildable);
  const recommendedAdu = Math.min(maxAduAllowed, 1000); // Recommend 1000 sqft for optimal rental

  analysis.buildable_analysis = {
    gross_lot_area: parcel.area_sqft,
    buildable_envelope: buildableEnvelope,
    existing_buildings: analysis.existing_buildings.total_area_sqft,
    net_buildable_area: netBuildable,
    max_adu_allowed: maxAduAllowed,
    recommended_adu_size: recommendedAdu,
    remaining_coverage: zoning.max_lot_coverage - analysis.existing_buildings.lot_coverage_percent,
  };

  console.log(`   Buildable Envelope: ${buildableEnvelope.toLocaleString()} sqft`);
  console.log(
    `   Less Existing: -${analysis.existing_buildings.total_area_sqft.toLocaleString()} sqft`,
  );
  console.log(`   Net Buildable: ${netBuildable.toLocaleString()} sqft`);
  console.log(`   Max ADU Size: ${maxAduAllowed.toLocaleString()} sqft`);

  // Step 5: Determine feasibility
  analysis.feasibility = determineFeasibility(
    netBuildable,
    maxAduAllowed,
    analysis.existing_buildings.lot_coverage_percent,
    zoning.max_lot_coverage,
  );

  // Step 6: Calculate financials (only if viable)
  if (analysis.feasibility.is_viable) {
    analysis.financial = calculateFinancials(recommendedAdu);
  }

  return analysis;
}

/**
 * Display analysis results
 */
function displayResults(analysis: ADUAnalysis) {
  console.log('\n' + '='.repeat(70));
  console.log('📋 ADU FEASIBILITY RESULTS');
  console.log('='.repeat(70));

  // Viability
  const viabilityIcon = analysis.feasibility.is_viable ? '✅' : '❌';
  console.log(
    `\n${viabilityIcon} VIABILITY: ${analysis.feasibility.is_viable ? 'YES' : 'NO'} (Score: ${analysis.feasibility.viability_score}/100)`,
  );

  // Buildable area
  console.log('\n📐 BUILDABLE AREA:');
  console.log(`   Lot Size: ${analysis.parcel.lot_size_sqft.toLocaleString()} sqft`);
  console.log(
    `   Buildable Envelope: ${analysis.buildable_analysis.buildable_envelope.toLocaleString()} sqft`,
  );
  console.log(
    `   Existing Buildings: ${analysis.buildable_analysis.existing_buildings.toLocaleString()} sqft`,
  );
  console.log(
    `   Net Buildable: ${analysis.buildable_analysis.net_buildable_area.toLocaleString()} sqft`,
  );
  console.log(
    `   Max ADU Allowed: ${analysis.buildable_analysis.max_adu_allowed.toLocaleString()} sqft`,
  );

  // Opportunities
  if (analysis.feasibility.opportunities.length > 0) {
    console.log('\n✅ OPPORTUNITIES:');
    for (const opp of analysis.feasibility.opportunities) {
      console.log(`   • ${opp}`);
    }
  }

  // Constraints
  if (analysis.feasibility.constraints.length > 0) {
    console.log('\n⚠️ CONSTRAINTS:');
    for (const constraint of analysis.feasibility.constraints) {
      console.log(`   • ${constraint}`);
    }
  }

  // Financials (if viable)
  if (analysis.feasibility.is_viable && analysis.financial.development_cost > 0) {
    console.log('\n💰 FINANCIAL PROJECTIONS:');
    console.log(
      `   Recommended ADU: ${analysis.buildable_analysis.recommended_adu_size.toLocaleString()} sqft`,
    );
    console.log(`   Development Cost: $${analysis.financial.development_cost.toLocaleString()}`);
    console.log(`   Monthly Rent: $${analysis.financial.monthly_rent.toLocaleString()}`);
    console.log(`   Annual NOI: $${analysis.financial.annual_noi.toLocaleString()}`);
    console.log(`   Cap Rate: ${analysis.financial.cap_rate}%`);
    console.log(`   Payback: ${analysis.financial.payback_months} months`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🏠 COMPLETE ADU FEASIBILITY ANALYSIS');
  console.log(`📅 ${new Date().toLocaleString()}`);

  const addresses = [
    '20616 Archwood St, Winnetka, CA 91306',
    '10921 Polaris Dr, San Diego, CA 92126',
    '1843 S Bedford St, Los Angeles, CA 90035',
  ];

  const results: ADUAnalysis[] = [];

  for (const address of addresses) {
    const analysis = await analyzeADUFeasibility(address);
    displayResults(analysis);
    results.push(analysis);
  }

  // Summary table
  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY TABLE');
  console.log('='.repeat(70));
  console.log('\n| Property | Viable | Net Buildable | Max ADU | Score |');
  console.log('|----------|--------|---------------|---------|-------|');

  for (const result of results) {
    const addr = result.address.substring(0, 25) + '...';
    const viable = result.feasibility.is_viable ? '✅ Yes' : '❌ No';
    const buildable = `${result.buildable_analysis.net_buildable_area.toLocaleString()} sqft`;
    const maxAdu = `${result.buildable_analysis.max_adu_allowed.toLocaleString()} sqft`;
    const score = `${result.feasibility.viability_score}/100`;

    console.log(
      `| ${addr.padEnd(28)} | ${viable} | ${buildable.padEnd(13)} | ${maxAdu.padEnd(11)} | ${score.padEnd(5)} |`,
    );
  }
}

// Run
main().catch(console.error);
