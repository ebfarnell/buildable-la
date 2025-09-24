import fs from 'node:fs';
import * as turf from '@turf/turf';
import { fetch } from 'undici';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

async function analyzeProperty(address: string, city: string, zip: string) {
  console.log('🏠 Analyzing Property for ADU Potential');
  console.log('='.repeat(60));
  console.log(`Address: ${address}`);
  console.log(`City: ${city}`);
  console.log(`ZIP: ${zip}\n`);

  // Step 1: Find the parcel
  console.log('📍 Step 1: Finding parcel...');

  // Parse house number and street name
  const match = address.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    console.error('Could not parse address');
    return;
  }

  const houseNumber = match[1];
  const streetName = match[2]?.toUpperCase() ?? '';

  // Query for the specific parcel
  const params = new URLSearchParams({
    f: 'json',
    where: `COUNTYNAME='VENTURA' AND SITE_CITY='THOUSAND OAKS' AND SITE_HOUSE_NUMBER='${houseNumber}' AND SITE_STREET_NAME LIKE '%${streetName}%'`,
    outFields: '*',
    returnGeometry: 'true',
  });

  const response = await fetch(`${CA_PARCELS_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = (await response.json()) as any;

  if (!data.features || data.features.length === 0) {
    console.error('❌ Property not found in database');
    return;
  }

  const parcel = data.features[0];
  const attrs = parcel.attributes;

  console.log('✅ Parcel found!');
  console.log(`   APN: ${attrs.PARCEL_APN}`);
  console.log(`   Full Address: ${attrs.SITE_ADDR}`);
  console.log(`   Owner: ${attrs.OWNER_NAME || 'N/A'}`);

  // Step 2: Calculate lot area
  console.log('\n📐 Step 2: Calculating lot dimensions...');

  if (!parcel.geometry?.rings) {
    console.error('No geometry data available');
    return;
  }

  const polygon = turf.polygon(parcel.geometry.rings);
  const lotAreaM2 = turf.area(polygon);
  const lotAreaSqft = Math.round(lotAreaM2 * 10.7639);
  const lotAreaAcres = (lotAreaSqft / 43560).toFixed(2);

  console.log(`   Lot Size: ${lotAreaSqft.toLocaleString()} sqft (${lotAreaAcres} acres)`);

  // Calculate lot dimensions (approximate)
  const bbox = turf.bbox(polygon);
  const [minX, minY, maxX, maxY] = bbox;
  const approxWidth = turf.distance([minX, minY], [maxX, minY], { units: 'feet' });
  const approxDepth = turf.distance([minX, minY], [minX, maxY], { units: 'feet' });

  console.log(
    `   Approximate Dimensions: ${Math.round(approxWidth)}' x ${Math.round(approxDepth)}'`,
  );

  // Step 3: Determine zoning (would need actual zoning service)
  console.log('\n🏘️ Step 3: Checking zoning...');

  // For Thousand Oaks residential, typical setbacks are:
  // This would normally query a zoning service
  const zoning = {
    zone: 'RE (Residential Estate)',
    frontSetback: 30, // Conservative for RE zones
    sideSetback: 10,
    rearSetback: 25,
    maxLotCoverage: 0.35,
    maxHeight: 16, // feet for ADU
    notes: 'Thousand Oaks allows ADUs up to 1,200 sqft',
  };

  console.log(`   Zone: ${zoning.zone}`);
  console.log(
    `   Setbacks: ${zoning.frontSetback}' front, ${zoning.sideSetback}' side, ${zoning.rearSetback}' rear`,
  );
  console.log(`   Max Lot Coverage: ${zoning.maxLotCoverage * 100}%`);
  console.log(`   Max ADU Height: ${zoning.maxHeight} feet`);

  // Step 4: Calculate buildable area
  console.log('\n🔨 Step 4: Calculating buildable area for ADU...');

  // Apply setbacks
  const envelopeBuffer = turf.buffer(polygon, -zoning.sideSetback, { units: 'feet' });

  if (!envelopeBuffer) {
    console.error('Lot too small for setbacks');
    return;
  }

  // Further reduce for front and rear setbacks (simplified)
  const additionalBuffer =
    Math.max(zoning.frontSetback - zoning.sideSetback, zoning.rearSetback - zoning.sideSetback) / 2;

  const buildableEnvelope =
    additionalBuffer > 0
      ? turf.buffer(envelopeBuffer, -additionalBuffer, { units: 'feet' })
      : envelopeBuffer;

  if (!buildableEnvelope) {
    console.error('Insufficient buildable area after setbacks');
    return;
  }

  // Estimate existing house footprint (30% of lot for RE zones)
  const existingFootprint = lotAreaSqft * 0.3;

  const envelopeArea = turf.area(buildableEnvelope) * 10.7639;
  const buildableArea = Math.max(0, Math.round(envelopeArea - existingFootprint));

  console.log(`   Buildable Envelope: ${Math.round(envelopeArea).toLocaleString()} sqft`);
  console.log(
    `   Estimated Existing House: ${Math.round(existingFootprint).toLocaleString()} sqft`,
  );
  console.log(`   Available for ADU: ${buildableArea.toLocaleString()} sqft`);

  // Step 5: ADU Analysis
  console.log('\n🏡 Step 5: ADU Feasibility Analysis...');

  const maxADUSize = Math.min(
    1200, // Thousand Oaks max
    buildableArea,
    lotAreaSqft * (zoning.maxLotCoverage - 0.3), // Remaining lot coverage
  );

  const isViable = buildableArea >= 770;

  if (isViable) {
    console.log(`   ✅ ADU is FEASIBLE on this property!`);
    console.log(`   Maximum ADU Size: ${Math.round(maxADUSize).toLocaleString()} sqft`);

    // Recommend ADU sizes
    console.log('\n   Recommended ADU Options:');
    if (maxADUSize >= 1200) {
      console.log('   • 3BR/2BA ADU: 1,200 sqft ($3,500-4,200/mo rental)');
    }
    if (maxADUSize >= 1000) {
      console.log('   • 2BR/2BA ADU: 1,000 sqft ($3,000-3,600/mo rental)');
    }
    if (maxADUSize >= 800) {
      console.log('   • 2BR/1BA ADU: 800 sqft ($2,500-3,000/mo rental)');
    }
    if (maxADUSize >= 600) {
      console.log('   • 1BR/1BA ADU: 600 sqft ($2,000-2,400/mo rental)');
    }
  } else {
    console.log(`   ❌ ADU may be challenging - only ${buildableArea} sqft available`);
    console.log('   Consider a smaller JADU (Junior ADU) up to 500 sqft');
  }

  // Step 6: Investment Analysis
  console.log('\n💰 Step 6: Investment Analysis...');

  const constructionCostPerSqft = 200; // Conservative estimate
  const aduSize = Math.min(1000, maxADUSize); // Target 1000 sqft
  const constructionCost = aduSize * constructionCostPerSqft;
  const softCosts = 30000; // Permits, design, utilities
  const totalCost = constructionCost + softCosts;
  const monthlyRent = aduSize * 3; // $3/sqft typical for Thousand Oaks
  const annualROI = (((monthlyRent * 12) / totalCost) * 100).toFixed(1);

  console.log(`   Estimated ADU Size: ${aduSize} sqft`);
  console.log(`   Construction Cost: $${constructionCost.toLocaleString()}`);
  console.log(`   Soft Costs: $${softCosts.toLocaleString()}`);
  console.log(`   Total Investment: $${totalCost.toLocaleString()}`);
  console.log(`   Expected Rent: $${monthlyRent.toLocaleString()}/month`);
  console.log(`   Annual ROI: ${annualROI}%`);

  // Step 7: Save results
  console.log('\n💾 Step 7: Saving analysis...');

  const results = {
    address,
    city,
    zip,
    apn: attrs.PARCEL_APN,
    lot_sqft: lotAreaSqft,
    lot_acres: parseFloat(lotAreaAcres),
    buildable_sqft: buildableArea,
    max_adu_sqft: Math.round(maxADUSize),
    is_viable: isViable,
    zoning: zoning.zone,
    setbacks: `${zoning.frontSetback}F/${zoning.sideSetback}S/${zoning.rearSetback}R`,
    investment: {
      estimated_cost: totalCost,
      expected_rent: monthlyRent,
      annual_roi: parseFloat(annualROI),
    },
    analyzed_at: new Date().toISOString(),
  };

  fs.mkdirSync('out', { recursive: true });
  const filename = `out/adu_analysis_${attrs.PARCEL_APN}.json`;
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));

  console.log(`   ✅ Analysis saved to: ${filename}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Property: ${address}`);
  console.log(`Lot Size: ${lotAreaSqft.toLocaleString()} sqft`);
  console.log(`Buildable Area: ${buildableArea.toLocaleString()} sqft`);
  console.log(`Max ADU: ${Math.round(maxADUSize).toLocaleString()} sqft`);
  console.log(`Status: ${isViable ? '✅ VIABLE FOR ADU' : '⚠️ LIMITED VIABILITY'}`);
  console.log(
    `Investment: $${totalCost.toLocaleString()} → $${(monthlyRent * 12).toLocaleString()}/year (${annualROI}% ROI)`,
  );
}

// Run analysis for the specified property
analyzeProperty('1618 Burning Tree Dr', 'Thousand Oaks', '91362').catch(console.error);
