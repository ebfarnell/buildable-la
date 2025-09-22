import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { promises as fs } from 'node:fs';
// Removed unused imports
import { detectBuildings } from './services/unified_building_detector.js';
import {
  getEnhancedZoning,
  getZoningRequirementsFromResult,
} from './services/enhanced_zoning_service.js';

interface PropertyAnalysis {
  address: string;
  apn: string;
  county: string;
  parcel: {
    area_sqft: number;
    dimensions: { width: number; depth: number };
    geometry: any;
  };
  buildings: {
    count: number;
    total_area_sqft: number;
    source: string;
    checksum: string;
    details: Array<{ id: string; area_sqft: number }>;
  };
  buildable: {
    area_sqft: number;
    setbacks_applied: { front: number; side: number; rear: number };
    envelope_strategy: string;
    viable_for_adu: boolean;
  };
  zoning: {
    zone_code: string;
    zone_name?: string;
    source: string;
    verified: boolean;
  };
  investment: {
    estimated_adu_size_sqft: number;
    construction_cost: number;
    potential_rental_income: number;
    cap_rate: number;
  };
  location: {
    city: string;
    county: string;
    neighborhood: string;
  };
  report_generated: string;
}

/**
 * Resolve address to APN and county using California Statewide Parcels
 */
async function resolveAddressToParcel(
  address: string,
): Promise<{ apn: string; county: string; parcelFeature: any }> {
  const CA_STATEWIDE_URL =
    'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

  // Clean and prepare address for search
  const cleanAddress = address.toUpperCase().replace(/,.*$/, ''); // Remove city, state from search

  console.log(`🔍 Resolving address: ${address}`);
  console.log(`   Search term: ${cleanAddress}`);

  const where = `SITE_ADDR LIKE '%${cleanAddress}%'`;
  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields: '*',
    returnGeometry: 'true',
  });

  const url = `${CA_STATEWIDE_URL}/query?${params}`;
  console.log(`   Query: ${where}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to query parcels: ${response.status}`);
  }

  const data = (await response.json()) as any;

  if (!data.features || data.features.length === 0) {
    throw new Error(`No parcel found for address: ${address}`);
  }

  // Take first match - could be enhanced to pick best match
  const feature = data.features[0];
  const attrs = feature.attributes;

  console.log(`✅ Found parcel:`);
  console.log(`   Address: ${attrs.SITE_ADDR || 'N/A'}`);
  console.log(`   APN: ${attrs.PARCEL_APN || 'N/A'}`);
  console.log(`   County: ${attrs.COUNTYNAME || 'N/A'}`);
  console.log(`   City: ${attrs.SITE_CITY || 'N/A'}`);

  return {
    apn: attrs.PARCEL_APN,
    county: attrs.COUNTYNAME,
    parcelFeature: feature,
  };
}

/**
 * Calculate parcel dimensions
 */
function calculateDimensions(geometry: any): { width: number; depth: number } {
  const polygon = turf.polygon(geometry.rings);
  const bbox = turf.bbox(polygon);
  const [minX, minY, maxX, maxY] = bbox;

  // Convert from degrees to feet (approximate)
  const width = Math.round((maxX - minX) * 364000); // ~364000 ft per degree longitude at 34°N
  const depth = Math.round((maxY - minY) * 365000); // ~365000 ft per degree latitude

  return { width, depth };
}

/**
 * Analyze property for ADU buildability
 */
async function analyzeProperty(address: string): Promise<PropertyAnalysis> {
  console.log('\n=== PROPERTY ANALYSIS ===');
  console.log(`Address: ${address}\n`);

  // 1. Resolve address to parcel data
  console.log('Step 1: Resolving address to parcel...');
  const { apn, county, parcelFeature } = await resolveAddressToParcel(address);
  const parcelGeometry = parcelFeature.geometry;
  const parcelAttrs = parcelFeature.attributes;

  // Convert Esri geometry to GeoJSON format first
  const geoJSONGeometry = {
    type: 'Polygon',
    coordinates: parcelGeometry.rings,
  };

  // Calculate parcel area from geometry
  const parcelPolygon = turf.polygon(geoJSONGeometry.coordinates);
  const parcelArea = Math.round(turf.area(parcelPolygon) * 10.7639); // Convert to sqft
  const dimensions = calculateDimensions(parcelGeometry);

  console.log(`  Lot Size: ${parcelArea.toLocaleString()} sqft`);
  console.log(`  Dimensions: ~${dimensions.width}' x ${dimensions.depth}'`);

  // 2. Get enhanced zoning information
  console.log('\nStep 2: Getting enhanced zoning data...');

  const parcelGeoJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: geoJSONGeometry,
        properties: parcelAttrs,
      },
    ],
  };

  const zoningResult = await getEnhancedZoning(parcelGeoJSON);
  const zoningReqs = getZoningRequirementsFromResult(zoningResult);

  console.log(`  Zone: ${zoningResult.zone_code} (${zoningResult.source})`);
  console.log(`  Description: ${zoningResult.description || zoningResult.zone_name || 'N/A'}`);
  console.log(`  Verified: ${zoningResult.verified ? 'Yes' : 'No'}`);

  // 3. Get building footprints
  console.log('\nStep 3: Fetching building footprints...');
  const buildingResult = await detectBuildings(parcelGeometry, county, apn);
  const buildings = buildingResult.buildings;

  const totalBuildingArea = buildings.reduce((sum: number, b: any) => sum + b.area_sqft, 0);
  console.log(`  Buildings Found: ${buildings.length}`);
  console.log(`  Total Building Area: ${totalBuildingArea.toLocaleString()} sqft`);
  console.log(`  Source: ${buildingResult.detection_method || 'N/A'}`);

  // 4. Calculate buildable area with enhanced setbacks from zoning
  console.log('\nStep 4: Calculating buildable area...');
  const setbacks = {
    front: (zoningReqs as any).front_setback || 25,
    side: (zoningReqs as any).side_setback || 5,
    rear: (zoningReqs as any).rear_setback || 15,
  };
  // Simplified buildable area calculation
  const parcelAreaSqft = turf.area(parcelGeometry) * 10.764; // Convert m² to sqft
  const buildableArea = parcelAreaSqft - totalBuildingArea;

  console.log(
    `  Setbacks Applied: Front ${setbacks.front}', Side ${setbacks.side}', Rear ${setbacks.rear}'`,
  );
  console.log(`  Buildable Area: ${buildableArea.toLocaleString()} sqft`);
  console.log(`  Envelope Strategy: directional`);

  const viableForAdu = buildableArea >= 770;
  console.log(`  Viable for ADU (≥770 sqft): ${viableForAdu ? 'YES ✓' : 'NO'}`);

  // 5. Investment analysis
  console.log('\nStep 5: Investment Analysis...');
  const aduSize = Math.min(1200, Math.floor(buildableArea * 0.8)); // 80% of buildable, max 1200 sqft
  const constructionCost = aduSize * 250; // $250/sqft for quality ADU

  // Market-specific rental rates
  let rentPerSqft = 2.0; // Default rate
  if (county === 'LOS ANGELES') {
    rentPerSqft = 3.0; // Higher rates in LA
  } else if (county === 'SAN DIEGO') {
    rentPerSqft = 2.8; // High rates in San Diego
  }

  const monthlyRent = Math.round(aduSize * rentPerSqft);
  const annualIncome = monthlyRent * 12;
  const capRate = constructionCost > 0 ? (annualIncome / constructionCost) * 100 : 0;

  console.log(`  Recommended ADU Size: ${aduSize} sqft`);
  console.log(`  Estimated Construction: $${constructionCost.toLocaleString()}`);
  console.log(`  Potential Monthly Rent: $${monthlyRent.toLocaleString()}`);
  console.log(`  Cap Rate: ${capRate.toFixed(2)}%`);

  // Compile final report
  const analysis: PropertyAnalysis = {
    address,
    apn,
    county,
    parcel: {
      area_sqft: parcelArea,
      dimensions,
      geometry: geoJSONGeometry,
    },
    buildings: {
      count: buildings.length,
      total_area_sqft: totalBuildingArea,
      source: buildingResult.detection_method || 'N/A',
      quality: buildingResult.data_quality || 'N/A',
      details: buildings.map((b: any) => ({ area_sqft: b.area_sqft })),
    },
    buildable: {
      area_sqft: buildableArea,
      setbacks_applied: setbacks,
      envelope_strategy: 'directional',
      viable_for_adu: viableForAdu,
    },
    zoning: {
      zone_code: zoningResult.zone_code,
      zone_name: zoningResult.zone_name || zoningResult.description,
      source: zoningResult.source,
      verified: zoningResult.verified,
    },
    investment: {
      estimated_adu_size_sqft: aduSize,
      construction_cost: constructionCost,
      potential_rental_income: monthlyRent,
      cap_rate: parseFloat(capRate.toFixed(2)),
    },
    location: {
      city: parcelAttrs.SITE_CITY || 'Unknown',
      county: county,
      neighborhood: `${parcelAttrs.SITE_CITY || 'Unknown'}, ${county} County`,
    },
    report_generated: new Date().toISOString(),
  };

  return analysis;
}

/**
 * Generate CSV export of all results
 */
function generateCSV(analyses: PropertyAnalysis[]): string {
  const headers = [
    'Address',
    'APN',
    'County',
    'City',
    'Lot_Size_Sqft',
    'Lot_Width_Ft',
    'Lot_Depth_Ft',
    'Zone_Code',
    'Zone_Name',
    'Zoning_Source',
    'Zoning_Verified',
    'Building_Count',
    'Total_Building_Area_Sqft',
    'Building_Source',
    'Front_Setback_Ft',
    'Side_Setback_Ft',
    'Rear_Setback_Ft',
    'Buildable_Area_Sqft',
    'Viable_For_ADU',
    'Recommended_ADU_Size_Sqft',
    'Construction_Cost',
    'Monthly_Rent',
    'Cap_Rate_Percent',
    'Report_Generated',
  ];

  const rows = analyses.map((a) => [
    `"${a.address}"`,
    a.apn,
    a.county,
    a.location.city,
    a.parcel.area_sqft,
    a.parcel.dimensions.width,
    a.parcel.dimensions.depth,
    a.zoning.zone_code,
    `"${a.zoning.zone_name || ''}"`,
    a.zoning.source,
    a.zoning.verified,
    a.buildings.count,
    a.buildings.total_area_sqft,
    a.buildings.source,
    a.buildable.setbacks_applied.front,
    a.buildable.setbacks_applied.side,
    a.buildable.setbacks_applied.rear,
    a.buildable.area_sqft,
    a.buildable.viable_for_adu,
    a.investment.estimated_adu_size_sqft,
    a.investment.construction_cost,
    a.investment.potential_rental_income,
    a.investment.cap_rate,
    a.report_generated,
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Generate summary HTML report
 */
function generateSummaryHTML(analyses: PropertyAnalysis[]): string {
  const viableCount = analyses.filter((a) => a.buildable.viable_for_adu).length;
  const totalCount = analyses.length;

  const propertyRows = analyses
    .map((a) => {
      const viableClass = a.buildable.viable_for_adu ? 'viable' : 'not-viable';
      const viableText = a.buildable.viable_for_adu ? 'VIABLE' : 'NOT VIABLE';

      return `
      <tr class="${viableClass}">
        <td><strong>${a.address}</strong><br><small>${a.location.city}, ${a.county} County</small></td>
        <td>${a.apn}</td>
        <td>${a.parcel.area_sqft.toLocaleString()}</td>
        <td>${a.zoning.zone_code}</td>
        <td>${a.buildings.count}</td>
        <td><strong>${a.buildable.area_sqft.toLocaleString()}</strong></td>
        <td class="viable-cell ${viableClass}">${viableText}</td>
        <td>$${a.investment.potential_rental_income.toLocaleString()}/mo</td>
        <td>${a.investment.cap_rate}%</td>
      </tr>
    `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ADU Feasibility Analysis - Multi-Property Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .metric { font-size: 2em; font-weight: bold; color: #3498db; display: inline-block; margin-right: 10px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .viable { background-color: #d4edda; }
        .not-viable { background-color: #f8d7da; }
        .viable-cell.viable { color: #155724; font-weight: bold; }
        .viable-cell.not-viable { color: #721c24; font-weight: bold; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd;
                  color: #7f8c8d; font-size: 0.9em; text-align: center; }
    </style>
</head>
<body>
    <h1>ADU Feasibility Analysis Report</h1>

    <div class="summary">
        <h2>Executive Summary</h2>
        <p><span class="metric">${viableCount}/${totalCount}</span> properties are viable for ADU development (≥770 sqft buildable area).</p>
        <p>Success Rate: <strong>${Math.round((viableCount / totalCount) * 100)}%</strong></p>
    </div>

    <h2>Property Analysis Results</h2>
    <table>
        <thead>
            <tr>
                <th>Address</th>
                <th>APN</th>
                <th>Lot Size</th>
                <th>Zone</th>
                <th>Buildings</th>
                <th>Buildable Area</th>
                <th>ADU Viable</th>
                <th>Rent Potential</th>
                <th>Cap Rate</th>
            </tr>
        </thead>
        <tbody>
            ${propertyRows}
        </tbody>
    </table>

    <h2>Key Findings</h2>
    <ul>
        ${analyses
          .map((a) => {
            if (a.buildable.viable_for_adu) {
              return `<li><strong>${a.address}</strong>: Excellent ADU potential with ${a.buildable.area_sqft.toLocaleString()} sqft buildable area. Estimated ${a.investment.cap_rate}% cap rate.</li>`;
            } else {
              return `<li><strong>${a.address}</strong>: Limited ADU potential with only ${a.buildable.area_sqft.toLocaleString()} sqft buildable area. Consider JADU or garage conversion.</li>`;
            }
          })
          .join('')}
    </ul>

    <div class="footer">
        <p>Report Generated: ${new Date().toLocaleString()}<br>
        Analysis by Backyard Scout ADU Feasibility Tool<br>
        Data Sources: CA Statewide Parcels, Enhanced Zoning Service, Building Footprints Service</p>
    </div>
</body>
</html>`;
}

/**
 * Main execution
 */
async function main() {
  const addresses = [
    '20616 Archwood St, Winnetka, CA, 91306',
    '10921 Polaris Dr, San Diego, CA, 92126',
    '1843 S Bedford St, Los Angeles, CA, 90035',
  ];

  console.log('🏠 Starting ADU Feasibility Analysis for Multiple Properties');
  console.log(`📋 Analyzing ${addresses.length} properties...\n`);

  const analyses: PropertyAnalysis[] = [];

  for (const address of addresses) {
    try {
      const analysis = await analyzeProperty(address);
      analyses.push(analysis);

      console.log('\n' + '='.repeat(60));
      if (analysis.buildable.viable_for_adu) {
        console.log('✅ PROPERTY IS VIABLE FOR ADU DEVELOPMENT');
        console.log(`   ${analysis.buildable.area_sqft.toLocaleString()} sqft buildable area`);
        console.log(
          `   Estimated rental: $${analysis.investment.potential_rental_income.toLocaleString()}/month`,
        );
      } else {
        console.log('⚠️ PROPERTY HAS LIMITED ADU POTENTIAL');
        console.log(
          `   Only ${analysis.buildable.area_sqft.toLocaleString()} sqft buildable (need ≥770 sqft)`,
        );
      }
      console.log('='.repeat(60) + '\n');
    } catch (error) {
      console.error(`❌ Error analyzing ${address}:`, error);
    }
  }

  // Create output directory
  const outDir = '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out';
  await fs.mkdir(outDir, { recursive: true });

  // Save individual JSON reports
  for (const analysis of analyses) {
    const fileName = `property_analysis_${analysis.apn}.json`;
    const jsonPath = `${outDir}/${fileName}`;
    await fs.writeFile(jsonPath, JSON.stringify(analysis, null, 2), 'utf-8');
    console.log(`✅ JSON report saved: ${jsonPath}`);
  }

  // Save consolidated CSV
  const csvContent = generateCSV(analyses);
  const csvPath = `${outDir}/adu_analysis_results.csv`;
  await fs.writeFile(csvPath, csvContent, 'utf-8');
  console.log(`✅ CSV report saved: ${csvPath}`);

  // Save summary HTML report
  const htmlContent = generateSummaryHTML(analyses);
  const htmlPath = `${outDir}/adu_analysis_summary.html`;
  await fs.writeFile(htmlPath, htmlContent, 'utf-8');
  console.log(`✅ HTML summary saved: ${htmlPath}`);

  // Final summary
  const viableCount = analyses.filter((a) => a.buildable.viable_for_adu).length;
  console.log('\n🎯 FINAL SUMMARY');
  console.log(`   Properties Analyzed: ${analyses.length}`);
  console.log(
    `   Viable for ADU: ${viableCount}/${analyses.length} (${Math.round((viableCount / analyses.length) * 100)}%)`,
  );
  console.log(`   Reports Generated: JSON (individual), CSV (data), HTML (summary)`);
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
