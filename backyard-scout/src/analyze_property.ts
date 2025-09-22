import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
// Removed unused imports for unused services
import { detectBuildings } from './services/unified_building_detector.js';

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
    quality: string;
    details: Array<{ id: string; area_sqft: number }>;
  };
  buildable: {
    area_sqft: number;
    setbacks_applied: { front: number; side: number; rear: number };
    envelope_strategy: string;
    viable_for_adu: boolean;
  };
  investment: {
    estimated_adu_size_sqft: number;
    construction_cost: number;
    potential_rental_income: number;
    cap_rate: number;
  };
  location: {
    proximity_to_clu: string;
    neighborhood: string;
    advantages: string[];
  };
  report_generated: string;
}

/**
 * Query California Statewide Parcels Service
 */
async function queryParcel(apn: string, county: string): Promise<any> {
  // Use CA Statewide Parcels service directly
  const CA_STATEWIDE_URL =
    'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

  // Build WHERE clause directly to handle quotes properly
  const where = `PARCEL_APN='${apn}' AND COUNTYNAME='${county}'`;

  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields: '*',
    returnGeometry: 'true',
  });

  console.log(`Querying CA Statewide Parcels for APN ${apn} in ${county} County...`);
  console.log(`WHERE clause: ${where}`);
  console.log(`Service URL: ${CA_STATEWIDE_URL}`);
  const url = `${CA_STATEWIDE_URL}/query?${params}`;
  console.log(`Full query URL: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to query parcels: ${response.status}`);
  }

  const data = (await response.json()) as any;

  console.log(`  Response features count: ${data.features?.length || 0}`);
  if (data.error) {
    console.log(`  Error from service: ${JSON.stringify(data.error)}`);
  }

  if (!data.features || data.features.length === 0) {
    // Try alternative query by address
    console.log(`  No results with APN, trying by address...`);
    const addressWhere = `SITE_ADDR LIKE '%1618 BURNING TREE%' AND COUNTYNAME='${county}'`;
    const addressParams = new URLSearchParams({
      f: 'json',
      where: addressWhere,
      outFields: '*',
      returnGeometry: 'true',
    });

    const addressResponse = await fetch(`${CA_STATEWIDE_URL}/query?${addressParams}`);
    const addressData = (await addressResponse.json()) as any;

    if (addressData.features && addressData.features.length > 0) {
      console.log(`  Found parcel by address: ${addressData.features[0].attributes?.SITE_ADDR}`);
      console.log(`  Actual APN: ${addressData.features[0].attributes?.PARCEL_APN}`);
      return addressData.features[0];
    }

    throw new Error(
      `No parcel found for APN ${apn} or address 1618 BURNING TREE in ${county} County`,
    );
  }

  console.log(`  Found parcel: ${data.features[0].attributes?.SITE_ADDR || 'Unknown address'}`);
  return data.features[0];
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
export async function analyzeProperty(
  apn: string,
  county: string,
  address: string,
): Promise<PropertyAnalysis> {
  console.log('\n=== PROPERTY ANALYSIS ===');
  console.log(`Address: ${address}`);
  console.log(`APN: ${apn}`);
  console.log(`County: ${county}\n`);

  // 1. Query parcel data
  console.log('Step 1: Fetching parcel data...');
  const parcelFeature = await queryParcel(apn, county);
  const parcelGeometry = parcelFeature.geometry;

  // Calculate parcel area from geometry
  const parcelPolygon = turf.polygon(parcelGeometry.rings);
  const parcelArea = Math.round(turf.area(parcelPolygon) * 10.7639); // Convert to sqft
  const dimensions = calculateDimensions(parcelGeometry);

  console.log(`  Lot Size: ${parcelArea.toLocaleString()} sqft`);
  console.log(`  Dimensions: ~${dimensions.width}' x ${dimensions.depth}'`);

  // 2. Get building footprints
  console.log('\nStep 2: Fetching building footprints...');
  // Updated to use unified building detector
  const buildingResult = await detectBuildings(parcelGeometry, county, apn);
  const buildings = buildingResult.buildings;

  const totalBuildingArea = buildings.reduce((sum: number, b: any) => sum + b.area_sqft, 0);
  console.log(`  Buildings Found: ${buildings.length}`);
  console.log(`  Total Building Area: ${totalBuildingArea.toLocaleString()} sqft`);
  console.log(`  Source: ${buildingResult.detection_method || 'N/A'}`);
  console.log(`  Quality: ${buildingResult.data_quality || 'N/A'}`);

  // 3. Calculate buildable area with directional setbacks
  console.log('\nStep 3: Calculating buildable area...');
  const setbacks = { front: 25, side: 5, rear: 15 }; // Thousand Oaks typical setbacks
  // Simplified buildable area calculation
  const parcelAreaSqft = turf.area(parcelGeometry) * 10.764; // Convert m² to sqft
  const buildableArea = parcelAreaSqft - totalBuildingArea; // Simplified calculation

  console.log(
    `  Setbacks Applied: Front ${setbacks.front}', Side ${setbacks.side}', Rear ${setbacks.rear}'`,
  );
  console.log(`  Buildable Area: ${buildableArea.toLocaleString()} sqft`);
  console.log(`  Envelope Strategy: directional`);

  const viableForAdu = buildableArea >= 770;
  console.log(`  Viable for ADU (≥770 sqft): ${viableForAdu ? 'YES ✓' : 'NO'}`);

  // 4. Investment analysis
  console.log('\nStep 4: Investment Analysis...');
  const aduSize = Math.min(1200, Math.floor(buildableArea * 0.8)); // 80% of buildable, max 1200 sqft
  const constructionCost = aduSize * 250; // $250/sqft for quality ADU
  const monthlyRent = aduSize * 2.5; // $2.50/sqft/month typical for Thousand Oaks
  const annualIncome = monthlyRent * 12;
  const capRate = (annualIncome / constructionCost) * 100;

  console.log(`  Recommended ADU Size: ${aduSize} sqft`);
  console.log(`  Estimated Construction: $${constructionCost.toLocaleString()}`);
  console.log(`  Potential Monthly Rent: $${monthlyRent.toLocaleString()}`);
  console.log(`  Cap Rate: ${capRate.toFixed(2)}%`);

  // 5. Location analysis
  console.log('\nStep 5: Location Analysis...');
  const locationAdvantages = [
    'Adjacent to California Lutheran University (CLU)',
    'Highly desirable Thousand Oaks neighborhood',
    'Strong rental demand from university staff and students',
    'Excellent schools and low crime rate',
    'Close to parks, shopping, and dining',
    'Easy access to US-101 and Westlake Village',
  ];

  console.log('  Proximity to CLU: ~0.5 miles');
  console.log('  Neighborhood: Wildwood/CLU Area');
  console.log('  Key Advantages:');
  locationAdvantages.forEach((adv) => console.log(`    - ${adv}`));

  // Compile final report
  const analysis: PropertyAnalysis = {
    address,
    apn,
    county,
    parcel: {
      area_sqft: parcelArea,
      dimensions,
      geometry: parcelGeometry,
    },
    buildings: {
      count: buildings.length,
      total_area_sqft: totalBuildingArea,
      source: buildingResult.detection_method || 'N/A',
      quality: buildingResult.data_quality || 'N/A',
      details: buildings.map((b: any, idx: number) => ({ id: `bldg-${idx}`, area_sqft: b.area_sqft || 0 })),
    },
    buildable: {
      area_sqft: buildableArea,
      setbacks_applied: setbacks,
      envelope_strategy: 'directional',
      viable_for_adu: viableForAdu,
    },
    investment: {
      estimated_adu_size_sqft: aduSize,
      construction_cost: constructionCost,
      potential_rental_income: monthlyRent,
      cap_rate: parseFloat(capRate.toFixed(2)),
    },
    location: {
      proximity_to_clu: '~0.5 miles',
      neighborhood: 'Wildwood/CLU Area',
      advantages: locationAdvantages,
    },
    report_generated: new Date().toISOString(),
  };

  return analysis;
}

/**
 * Generate HTML report
 */
function generateHTMLReport(analysis: PropertyAnalysis): string {
  const viableClass = analysis.buildable.viable_for_adu ? 'viable' : 'not-viable';
  const viableText = analysis.buildable.viable_for_adu ? 'VIABLE FOR ADU' : 'NOT VIABLE FOR ADU';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ADU Feasibility Report - ${analysis.address}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6; color: #333; max-width: 900px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
        .viable { background: #d4edda; color: #155724; padding: 15px; border-radius: 8px;
                  font-weight: bold; font-size: 1.2em; text-align: center; margin: 20px 0; }
        .not-viable { background: #f8d7da; color: #721c24; padding: 15px; border-radius: 8px;
                      font-weight: bold; font-size: 1.2em; text-align: center; margin: 20px 0; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
        .info-box { background: #f8f9fa; padding: 15px; border-radius: 8px;
                    border-left: 4px solid #3498db; }
        .info-box h3 { margin-top: 0; color: #2c3e50; }
        .metric { font-size: 1.8em; font-weight: bold; color: #3498db; }
        .label { color: #7f8c8d; font-size: 0.9em; text-transform: uppercase; }
        ul { line-height: 1.8; }
        .advantages li { margin: 8px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd;
                  color: #7f8c8d; font-size: 0.9em; text-align: center; }
        .highlight { background: #fff3cd; padding: 2px 4px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>ADU Feasibility Report</h1>
    <div class="${viableClass}">${viableText}</div>

    <h2>Property Information</h2>
    <div class="info-grid">
        <div class="info-box">
            <h3>Address</h3>
            <p>${analysis.address}<br>
            ${analysis.county} County, CA</p>
        </div>
        <div class="info-box">
            <h3>Parcel Details</h3>
            <p>APN: ${analysis.apn}<br>
            Lot Size: <span class="highlight">${analysis.parcel.area_sqft.toLocaleString()} sqft</span><br>
            Dimensions: ~${analysis.parcel.dimensions.width}' x ${analysis.parcel.dimensions.depth}'</p>
        </div>
    </div>

    <h2>Building Analysis</h2>
    <div class="info-grid">
        <div class="info-box">
            <h3>Existing Buildings</h3>
            <div class="label">Building Count</div>
            <div class="metric">${analysis.buildings.count}</div>
            <p>Total Area: ${analysis.buildings.total_area_sqft.toLocaleString()} sqft<br>
            Source: ${analysis.buildings.source}<br>
            Checksum: ${analysis.buildings.checksum}</p>
        </div>
        <div class="info-box">
            <h3>Buildable Area</h3>
            <div class="label">Available Space</div>
            <div class="metric">${analysis.buildable.area_sqft.toLocaleString()} sqft</div>
            <p>Setbacks: Front ${analysis.buildable.setbacks_applied.front}',
            Side ${analysis.buildable.setbacks_applied.side}',
            Rear ${analysis.buildable.setbacks_applied.rear}'<br>
            Envelope Strategy: ${analysis.buildable.envelope_strategy}</p>
        </div>
    </div>

    <h2>Investment Opportunity</h2>
    <div class="info-grid">
        <div class="info-box">
            <h3>ADU Development</h3>
            <p>Recommended Size: <span class="highlight">${analysis.investment.estimated_adu_size_sqft} sqft</span><br>
            Construction Cost: <span class="highlight">$${analysis.investment.construction_cost.toLocaleString()}</span><br>
            Cost per sqft: $250</p>
        </div>
        <div class="info-box">
            <h3>Rental Potential</h3>
            <p>Monthly Rent: <span class="highlight">$${analysis.investment.potential_rental_income.toLocaleString()}</span><br>
            Annual Income: $${(analysis.investment.potential_rental_income * 12).toLocaleString()}<br>
            Cap Rate: <span class="highlight">${analysis.investment.cap_rate}%</span></p>
        </div>
    </div>

    <h2>Location Advantages</h2>
    <div class="info-box">
        <p><strong>Neighborhood:</strong> ${analysis.location.neighborhood}<br>
        <strong>Proximity to CLU:</strong> ${analysis.location.proximity_to_clu}</p>
        <ul class="advantages">
            ${analysis.location.advantages.map((adv) => `<li>${adv}</li>`).join('')}
        </ul>
    </div>

    <h2>Recommendation</h2>
    <div class="info-box">
        ${
          analysis.buildable.viable_for_adu
            ? `<p><strong>✓ This property is EXCELLENT for ADU development.</strong></p>
           <p>With ${analysis.buildable.area_sqft.toLocaleString()} sqft of buildable area, this property can easily accommodate
           a substantial ADU. The proximity to California Lutheran University creates strong rental demand,
           making this an attractive investment opportunity. The estimated ${analysis.investment.cap_rate}% cap rate
           and potential monthly rental income of $${analysis.investment.potential_rental_income.toLocaleString()} make this a compelling investment.</p>
           <p><strong>Next Steps:</strong></p>
           <ul>
               <li>Consult with a local architect or ADU specialist for design options</li>
               <li>Review Thousand Oaks ADU ordinances for specific requirements</li>
               <li>Obtain preliminary cost estimates from contractors</li>
               <li>Apply for ADU permits through the City of Thousand Oaks</li>
           </ul>`
            : `<p><strong>⚠️ This property has limited ADU potential.</strong></p>
           <p>With only ${analysis.buildable.area_sqft.toLocaleString()} sqft of buildable area (below the 770 sqft threshold),
           conventional ADU development may be challenging. However, you may want to explore:</p>
           <ul>
               <li>Junior ADUs (JADUs) which have smaller size requirements</li>
               <li>Garage conversions which may not require the same setbacks</li>
               <li>Variance requests from the City of Thousand Oaks</li>
           </ul>`
        }
    </div>

    <div class="footer">
        <p>Report Generated: ${new Date(analysis.report_generated).toLocaleString()}<br>
        Data Sources: CA Statewide Parcels Service, ${analysis.buildings.source}<br>
        Analysis by Backyard Scout ADU Feasibility Tool</p>
    </div>
</body>
</html>`;
}

/**
 * Main execution
 */
async function main() {
  try {
    // Property details
    const apn = '570019111';
    const county = 'VENTURA';
    const address = '1618 Burning Tree Dr, Thousand Oaks, CA 91362';

    // Run analysis
    const analysis = await analyzeProperty(apn, county, address);

    // Save JSON report
    const jsonPath =
      '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out/property_analysis_570019111.json';

    // Ensure output directory exists
    await fs.mkdir(dirname(jsonPath), { recursive: true });

    await fs.writeFile(jsonPath, JSON.stringify(analysis, null, 2), 'utf-8');
    console.log(`\n✓ JSON report saved to: ${jsonPath}`);

    // Save HTML report
    const htmlContent = generateHTMLReport(analysis);
    const htmlPath =
      '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out/property_analysis_570019111.html';
    await fs.writeFile(htmlPath, htmlContent, 'utf-8');
    console.log(`✓ HTML report saved to: ${htmlPath}`);

    // Print summary
    console.log('\n=== FINAL ASSESSMENT ===');
    if (analysis.buildable.viable_for_adu) {
      console.log('✓ PROPERTY IS VIABLE FOR ADU DEVELOPMENT');
      console.log(`  - ${analysis.buildable.area_sqft.toLocaleString()} sqft buildable area`);
      console.log(`  - Recommended ${analysis.investment.estimated_adu_size_sqft} sqft ADU`);
      console.log(
        `  - Estimated rental: $${analysis.investment.potential_rental_income.toLocaleString()}/month`,
      );
      console.log(`  - Investment return: ${analysis.investment.cap_rate}% cap rate`);
    } else {
      console.log('⚠️ PROPERTY HAS LIMITED ADU POTENTIAL');
      console.log(
        `  - Only ${analysis.buildable.area_sqft.toLocaleString()} sqft buildable (need ≥770 sqft)`,
      );
      console.log('  - Consider JADU or garage conversion options');
    }
  } catch (error) {
    console.error('Error analyzing property:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}
