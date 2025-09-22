/**
 * Corrected ADU Analysis using Real OSM Building Data
 * Addresses the three properties with proper building footprint data
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { promises as fs } from 'node:fs';
import { getBuildingFootprints } from './services/building_footprints_deterministic.js';
import {
  getEnhancedZoning,
  getZoningRequirementsFromResult,
} from './services/enhanced_zoning_service.js';

interface CorrectedPropertyAnalysis {
  address: string;
  apn: string;
  county: string;
  city: string;
  parcel: {
    area_sqft: number;
    dimensions: { width: number; depth: number };
  };
  buildings: {
    count: number;
    total_area_sqft: number;
    source: string;
    details: Array<{ id: string; area_sqft: number; source: string }>;
    comparison_to_estimates: {
      previous_estimate: number;
      actual_osm_data: number;
      difference_sqft: number;
      difference_percent: number;
    };
  };
  buildable: {
    area_sqft: number;
    setbacks_applied: { front: number; side: number; rear: number };
    calculation_method: string;
    viable_for_adu: boolean;
    improvement_vs_estimates: {
      previous_buildable: number;
      corrected_buildable: number;
      improvement_sqft: number;
    };
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
    market_comparison: {
      county_avg_rent_per_sqft: number;
      market_strength: string;
    };
  };
  impact_analysis: {
    data_source_improvement: string;
    viability_change: string;
    investment_impact: string;
    key_insights: string[];
  };
  report_generated: string;
}

/**
 * Resolve address to APN and parcel data
 */
async function resolveAddressToParcel(
  address: string,
): Promise<{ apn: string; county: string; parcelFeature: any }> {
  const CA_STATEWIDE_URL =
    'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';
  const cleanAddress = address.toUpperCase().replace(/,.*$/, '');

  const where = `SITE_ADDR LIKE '%${cleanAddress}%'`;
  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields: '*',
    returnGeometry: 'true',
  });

  const response = await fetch(`${CA_STATEWIDE_URL}/query?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to query parcels: ${response.status}`);
  }

  const data = (await response.json()) as any;
  if (!data.features || data.features.length === 0) {
    throw new Error(`No parcel found for address: ${address}`);
  }

  const feature = data.features[0];
  const attrs = feature.attributes;

  return {
    apn: attrs.PARCEL_APN,
    county: attrs.COUNTYNAME,
    parcelFeature: feature,
  };
}

/**
 * Calculate buildable area using simple subtraction method to avoid geometry errors
 */
function calculateBuildableAreaSimple(
  parcelAreaSqft: number,
  totalBuildingAreaSqft: number,
  setbacks: { front: number; side: number; rear: number },
): number {
  // Estimate setback area reduction (simplified approach)
  // Assume rectangular lot with average setback impacts
  const avgSetback = (setbacks.front + setbacks.side + setbacks.rear) / 3;
  const setbackReduction = avgSetback * 4 * Math.sqrt(parcelAreaSqft / 43560) * 100; // Rough perimeter impact

  const setbackAdjustedArea = Math.max(0, parcelAreaSqft - setbackReduction);
  const buildableArea = Math.max(0, setbackAdjustedArea - totalBuildingAreaSqft);

  return Math.round(buildableArea);
}

/**
 * Calculate parcel dimensions from geometry
 */
function calculateDimensions(geometry: any): { width: number; depth: number } {
  const polygon = turf.polygon(geometry.rings);
  const bbox = turf.bbox(polygon);
  const [minX, minY, maxX, maxY] = bbox;

  const width = Math.round((maxX - minX) * 364000);
  const depth = Math.round((maxY - minY) * 365000);

  return { width, depth };
}

/**
 * Analyze property with corrected building data
 */
async function analyzeCorrectedProperty(address: string): Promise<CorrectedPropertyAnalysis> {
  console.log(`\n🔍 CORRECTED ANALYSIS: ${address}`);
  console.log('='.repeat(60));

  // 1. Resolve address to parcel
  const { apn, county, parcelFeature } = await resolveAddressToParcel(address);
  const parcelGeometry = parcelFeature.geometry;
  const parcelAttrs = parcelFeature.attributes;

  const geoJSONGeometry = {
    type: 'Polygon',
    coordinates: parcelGeometry.rings,
  };

  const parcelPolygon = turf.polygon(geoJSONGeometry.coordinates);
  const parcelArea = Math.round(turf.area(parcelPolygon) * 10.7639);
  const dimensions = calculateDimensions(parcelGeometry);

  console.log(`📍 Property: ${parcelAttrs.SITE_ADDR || address}`);
  console.log(`📋 APN: ${apn}, County: ${county}`);
  console.log(
    `📐 Lot: ${parcelArea.toLocaleString()} sqft (${dimensions.width}' x ${dimensions.depth}')`,
  );

  // 2. Get enhanced zoning
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

  console.log(`🏙️ Zone: ${zoningResult.zone_code} (${zoningResult.source})`);

  // 3. Get corrected building footprints
  console.log(`\n🏠 BUILDING ANALYSIS (Corrected OSM Data):`);
  const buildings = await getBuildingFootprints(parcelGeometry, county, apn);

  const totalBuildingArea = buildings.reduce((sum, b) => sum + b.area_sqft, 0);
  const primarySource = buildings[0]?.source || 'N/A';

  console.log(`   Buildings Found: ${buildings.length}`);
  console.log(`   Total Area: ${totalBuildingArea.toLocaleString()} sqft`);
  console.log(`   Data Source: ${primarySource}`);

  // Calculate what the estimate would have been
  const estimatedBuildingArea = Math.round(parcelArea * 0.3); // 30% coverage estimate
  const buildingComparison = {
    previous_estimate: estimatedBuildingArea,
    actual_osm_data: totalBuildingArea,
    difference_sqft: totalBuildingArea - estimatedBuildingArea,
    difference_percent: Math.round(
      ((totalBuildingArea - estimatedBuildingArea) / estimatedBuildingArea) * 100,
    ),
  };

  console.log(`   Previous Estimate: ${estimatedBuildingArea.toLocaleString()} sqft (30% rule)`);
  console.log(`   Actual OSM Data: ${totalBuildingArea.toLocaleString()} sqft`);
  console.log(
    `   Difference: ${buildingComparison.difference_sqft >= 0 ? '+' : ''}${buildingComparison.difference_sqft.toLocaleString()} sqft (${buildingComparison.difference_percent >= 0 ? '+' : ''}${buildingComparison.difference_percent}%)`,
  );

  if (buildings.length > 1) {
    buildings.forEach((building, i) => {
      console.log(
        `     Building ${i + 1}: ${building.area_sqft.toLocaleString()} sqft (${building.source})`,
      );
    });
  }

  // 4. Calculate buildable area
  console.log(`\n🎯 BUILDABLE AREA CALCULATION:`);
  const setbacks = {
    front: zoningReqs.front_setback,
    side: zoningReqs.side_setback,
    rear: zoningReqs.rear_setback,
  };

  const buildableArea = calculateBuildableAreaSimple(parcelArea, totalBuildingArea, setbacks);
  const estimatedBuildable = calculateBuildableAreaSimple(
    parcelArea,
    estimatedBuildingArea,
    setbacks,
  );

  console.log(
    `   Setbacks: Front ${setbacks.front}', Side ${setbacks.side}', Rear ${setbacks.rear}'`,
  );
  console.log(`   Previous Buildable (w/ estimates): ${estimatedBuildable.toLocaleString()} sqft`);
  console.log(`   Corrected Buildable (w/ OSM): ${buildableArea.toLocaleString()} sqft`);
  console.log(
    `   Improvement: ${buildableArea - estimatedBuildable >= 0 ? '+' : ''}${(buildableArea - estimatedBuildable).toLocaleString()} sqft`,
  );

  const viableForAdu = buildableArea >= 770;
  console.log(`   ADU Viable (≥770 sqft): ${viableForAdu ? 'YES ✅' : 'NO ❌'}`);

  // 5. Investment analysis
  console.log(`\n💰 INVESTMENT ANALYSIS:`);
  const aduSize = viableForAdu ? Math.min(1200, Math.floor(buildableArea * 0.8)) : 0;
  const constructionCost = aduSize * 250;

  // Market-specific rental rates
  let rentPerSqft = 2.0;
  let marketStrength = 'Moderate';
  if (county === 'LOS ANGELES') {
    rentPerSqft = 3.0;
    marketStrength = 'Strong';
  } else if (county === 'SAN DIEGO') {
    rentPerSqft = 2.8;
    marketStrength = 'Strong';
  }

  const monthlyRent = Math.round(aduSize * rentPerSqft);
  const annualIncome = monthlyRent * 12;
  const capRate = constructionCost > 0 ? (annualIncome / constructionCost) * 100 : 0;

  console.log(`   Recommended ADU Size: ${aduSize} sqft`);
  console.log(`   Construction Cost: $${constructionCost.toLocaleString()}`);
  console.log(`   Monthly Rent: $${monthlyRent.toLocaleString()}`);
  console.log(`   Cap Rate: ${capRate.toFixed(2)}%`);
  console.log(`   Market: ${marketStrength} ($${rentPerSqft}/sqft)`);

  // 6. Impact analysis
  const viabilityChange = viableForAdu
    ? estimatedBuildable >= 770
      ? 'Confirmed viable'
      : 'Changed from non-viable to VIABLE'
    : estimatedBuildable >= 770
      ? 'Changed from viable to NON-VIABLE'
      : 'Confirmed non-viable';

  const investmentImpact =
    buildableArea > estimatedBuildable
      ? `Positive: ${((buildableArea - estimatedBuildable) * 0.8 * 250).toLocaleString()} additional investment potential`
      : `Negative: ${Math.abs((buildableArea - estimatedBuildable) * 0.8 * 250).toLocaleString()} reduced investment potential`;

  const keyInsights = [];

  if (primarySource === 'OSM') {
    keyInsights.push('Now using real OpenStreetMap building data instead of estimates');
  }

  if (Math.abs(buildingComparison.difference_percent) > 50) {
    keyInsights.push(
      `Building area was ${Math.abs(buildingComparison.difference_percent)}% ${buildingComparison.difference_percent > 0 ? 'larger' : 'smaller'} than estimated`,
    );
  }

  if (buildings.length > 1) {
    keyInsights.push(
      `Multiple structures detected (${buildings.length} buildings) providing more accurate analysis`,
    );
  }

  if (viableForAdu && estimatedBuildable < 770) {
    keyInsights.push(
      '🎯 MAJOR FINDING: Property is now viable for ADU development with corrected data!',
    );
  } else if (!viableForAdu && estimatedBuildable >= 770) {
    keyInsights.push('⚠️ Property no longer viable with accurate building data');
  }

  // Compile results
  const analysis: CorrectedPropertyAnalysis = {
    address,
    apn,
    county,
    city: parcelAttrs.SITE_CITY || 'Unknown',
    parcel: {
      area_sqft: parcelArea,
      dimensions,
    },
    buildings: {
      count: buildings.length,
      total_area_sqft: totalBuildingArea,
      source: primarySource,
      details: buildings.map((b) => ({
        id: b.id,
        area_sqft: b.area_sqft,
        source: b.source,
      })),
      comparison_to_estimates: buildingComparison,
    },
    buildable: {
      area_sqft: buildableArea,
      setbacks_applied: setbacks,
      calculation_method: 'simplified_subtraction',
      viable_for_adu: viableForAdu,
      improvement_vs_estimates: {
        previous_buildable: estimatedBuildable,
        corrected_buildable: buildableArea,
        improvement_sqft: buildableArea - estimatedBuildable,
      },
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
      market_comparison: {
        county_avg_rent_per_sqft: rentPerSqft,
        market_strength: marketStrength,
      },
    },
    impact_analysis: {
      data_source_improvement: `Upgraded from ${buildingComparison.difference_percent >= 0 ? 'under-' : 'over-'}estimated building data to real OSM data`,
      viability_change: viabilityChange,
      investment_impact: investmentImpact,
      key_insights: keyInsights,
    },
    report_generated: new Date().toISOString(),
  };

  return analysis;
}

/**
 * Generate comparison report
 */
function generateComparisonHTML(analyses: CorrectedPropertyAnalysis[]): string {
  const totalProperties = analyses.length;
  const viableNow = analyses.filter((a) => a.buildable.viable_for_adu).length;
  const viableBefore = analyses.filter(
    (a) => a.buildable.improvement_vs_estimates.previous_buildable >= 770,
  ).length;

  const propertyRows = analyses
    .map((a) => {
      const viableClass = a.buildable.viable_for_adu ? 'viable' : 'not-viable';
      const improvementClass =
        a.buildable.improvement_vs_estimates.improvement_sqft >= 0 ? 'positive' : 'negative';

      return `
      <tr class="${viableClass}">
        <td><strong>${a.address}</strong><br><small>${a.city}, ${a.county}</small></td>
        <td>${a.parcel.area_sqft.toLocaleString()}</td>
        <td>
          <div class="data-comparison">
            <div>Before: ${a.buildings.comparison_to_estimates.previous_estimate.toLocaleString()} sqft (est.)</div>
            <div><strong>After: ${a.buildings.total_area_sqft.toLocaleString()} sqft (${a.buildings.source})</strong></div>
            <div class="${improvementClass}">Change: ${a.buildings.comparison_to_estimates.difference_sqft >= 0 ? '+' : ''}${a.buildings.comparison_to_estimates.difference_sqft.toLocaleString()} sqft</div>
          </div>
        </td>
        <td>
          <div class="data-comparison">
            <div>Before: ${a.buildable.improvement_vs_estimates.previous_buildable.toLocaleString()} sqft</div>
            <div><strong>After: ${a.buildable.area_sqft.toLocaleString()} sqft</strong></div>
            <div class="${improvementClass}">Change: ${a.buildable.improvement_vs_estimates.improvement_sqft >= 0 ? '+' : ''}${a.buildable.improvement_vs_estimates.improvement_sqft.toLocaleString()} sqft</div>
          </div>
        </td>
        <td class="viable-cell ${viableClass}">
          ${a.buildable.viable_for_adu ? 'VIABLE' : 'NOT VIABLE'}
          ${a.impact_analysis.viability_change.includes('Changed') ? '<br><small>⚠️ Status Changed</small>' : ''}
        </td>
        <td>$${a.investment.potential_rental_income.toLocaleString()}/mo<br><small>${a.investment.cap_rate}% cap rate</small></td>
      </tr>
    `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Corrected ADU Analysis - Real Building Data Impact</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6; color: #333; max-width: 1400px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .metric { font-size: 1.8em; font-weight: bold; color: #3498db; }
        .improvement { background: #d4edda; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .degradation { background: #f8d7da; padding: 15px; border-radius: 5px; margin: 15px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.9em; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; vertical-align: top; }
        th { background: #f8f9fa; font-weight: bold; }
        .viable { background-color: #d4edda; }
        .not-viable { background-color: #f8d7da; }
        .viable-cell.viable { color: #155724; font-weight: bold; }
        .viable-cell.not-viable { color: #721c24; font-weight: bold; }
        .data-comparison { font-size: 0.85em; }
        .data-comparison div { margin: 2px 0; }
        .positive { color: #28a745; font-weight: 500; }
        .negative { color: #dc3545; font-weight: 500; }
        .key-insight { background: #e7f3ff; padding: 10px; border-left: 4px solid #3498db; margin: 10px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd;
                  color: #7f8c8d; font-size: 0.9em; text-align: center; }
    </style>
</head>
<body>
    <h1>🏠 Corrected ADU Feasibility Analysis Report</h1>
    <p><strong>Impact of Using Real OpenStreetMap Building Data vs. Estimates</strong></p>

    <div class="summary">
        <h2>📊 Executive Summary</h2>
        <div>
            <span class="metric">${viableNow}/${totalProperties}</span> properties are viable for ADU development with corrected data
        </div>
        <div>
            Previous analysis (with estimates): <strong>${viableBefore}/${totalProperties} viable</strong>
        </div>
        <div>
            Net change: <strong>${viableNow - viableBefore >= 0 ? '+' : ''}${viableNow - viableBefore} properties</strong>
        </div>
    </div>

    <h2>🔍 Property-by-Property Analysis</h2>
    <table>
        <thead>
            <tr>
                <th>Property</th>
                <th>Lot Size</th>
                <th>Building Area</th>
                <th>Buildable Area</th>
                <th>ADU Viability</th>
                <th>Investment</th>
            </tr>
        </thead>
        <tbody>
            ${propertyRows}
        </tbody>
    </table>

    <h2>🎯 Key Findings</h2>
    ${analyses
      .map(
        (a) => `
      <div class="key-insight">
        <h3>${a.address}</h3>
        <ul>
          ${a.impact_analysis.key_insights.map((insight) => `<li>${insight}</li>`).join('')}
        </ul>
        <p><strong>Investment Impact:</strong> ${a.impact_analysis.investment_impact}</p>
      </div>
    `,
      )
      .join('')}

    <h2>📈 Data Quality Improvements</h2>
    <ul>
        <li><strong>Building Footprint Accuracy:</strong> Replaced 30% coverage estimates with real OpenStreetMap building data</li>
        <li><strong>Multi-Structure Detection:</strong> Can now identify multiple buildings on single parcels</li>
        <li><strong>Investment Precision:</strong> More accurate buildable area calculations lead to better investment decisions</li>
        <li><strong>Risk Reduction:</strong> Eliminates surprises from actual building sizes during development planning</li>
    </ul>

    <div class="footer">
        <p>Report Generated: ${new Date().toLocaleString()}<br>
        Analysis by Backyard Scout ADU Feasibility Tool<br>
        <strong>Enhanced with Real OpenStreetMap Building Data</strong></p>
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

  console.log('🏠 CORRECTED ADU FEASIBILITY ANALYSIS');
  console.log('Using Real OpenStreetMap Building Data vs. Previous Estimates');
  console.log('='.repeat(80));

  const analyses: CorrectedPropertyAnalysis[] = [];

  for (const address of addresses) {
    try {
      const analysis = await analyzeCorrectedProperty(address);
      analyses.push(analysis);
    } catch (error) {
      console.error(`❌ Error analyzing ${address}:`, error);
    }
  }

  // Create outputs
  const outDir = '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out';
  await fs.mkdir(outDir, { recursive: true });

  // Save detailed JSON reports
  for (const analysis of analyses) {
    const fileName = `corrected_analysis_${analysis.apn}.json`;
    const jsonPath = `${outDir}/${fileName}`;
    await fs.writeFile(jsonPath, JSON.stringify(analysis, null, 2), 'utf-8');
    console.log(`✅ Detailed report saved: ${jsonPath}`);
  }

  // Save comparison HTML report
  const htmlContent = generateComparisonHTML(analyses);
  const htmlPath = `${outDir}/corrected_adu_comparison_report.html`;
  await fs.writeFile(htmlPath, htmlContent, 'utf-8');
  console.log(`✅ Comparison report saved: ${htmlPath}`);

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('🎯 CORRECTED ANALYSIS SUMMARY');
  console.log('='.repeat(80));

  for (const analysis of analyses) {
    console.log(`\n📍 ${analysis.address}`);
    console.log(
      `   Building Data: ${analysis.buildings.comparison_to_estimates.previous_estimate.toLocaleString()} → ${analysis.buildings.total_area_sqft.toLocaleString()} sqft (${analysis.buildings.comparison_to_estimates.difference_percent >= 0 ? '+' : ''}${analysis.buildings.comparison_to_estimates.difference_percent}%)`,
    );
    console.log(
      `   Buildable Area: ${analysis.buildable.improvement_vs_estimates.previous_buildable.toLocaleString()} → ${analysis.buildable.area_sqft.toLocaleString()} sqft (${analysis.buildable.improvement_vs_estimates.improvement_sqft >= 0 ? '+' : ''}${analysis.buildable.improvement_vs_estimates.improvement_sqft.toLocaleString()})`,
    );
    console.log(`   ADU Viability: ${analysis.impact_analysis.viability_change}`);
    console.log(`   Data Source: ${analysis.buildings.source}`);
  }

  const viableCount = analyses.filter((a) => a.buildable.viable_for_adu).length;
  console.log(
    `\n📊 Overall: ${viableCount}/${analyses.length} properties viable for ADU development`,
  );
  console.log(`📂 Reports: ${htmlPath}`);
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
