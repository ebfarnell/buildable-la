import fs from 'node:fs';
import * as turf from '@turf/turf';
import { fetch } from 'undici';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

async function analyzeProperty() {
  console.log('🏠 ADU Analysis: 1618 Burning Tree Dr, Thousand Oaks, CA 91362');
  console.log('='.repeat(60));

  // Get full parcel data with geometry for APN 570019111
  const params = new URLSearchParams({
    f: 'json',
    where: `PARCEL_APN='570019111'`,
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
    console.error('❌ Property not found');
    return;
  }

  const parcel = data.features[0];
  const attrs = parcel.attributes;

  console.log('\n📍 PARCEL INFORMATION');
  console.log(`   APN: ${attrs.PARCEL_APN}`);
  console.log(`   Address: ${attrs.SITE_ADDR}`);
  console.log(`   City: ${attrs.SITE_CITY}`);
  console.log(`   ZIP: ${attrs.SITE_ZIP}`);

  // Calculate lot area
  if (!parcel.geometry?.rings) {
    console.error('No geometry data available');
    return;
  }

  const polygon = turf.polygon(parcel.geometry.rings);
  const lotAreaM2 = turf.area(polygon);
  const lotAreaSqft = Math.round(lotAreaM2 * 10.7639);
  const lotAreaAcres = (lotAreaSqft / 43560).toFixed(3);

  console.log('\n📐 LOT DIMENSIONS');
  console.log(`   Lot Size: ${lotAreaSqft.toLocaleString()} sqft`);
  console.log(`   Lot Size: ${lotAreaAcres} acres`);

  // Calculate approximate dimensions
  const bbox = turf.bbox(polygon);
  const [minX, minY, maxX, maxY] = bbox;
  const width = turf.distance([minX, minY], [maxX, minY], { units: 'feet' });
  const depth = turf.distance([minX, minY], [minX, maxY], { units: 'feet' });
  console.log(`   Approximate: ${Math.round(width)}' x ${Math.round(depth)}'`);

  // Thousand Oaks zoning setbacks (conservative for residential)
  const setbacks = {
    front: 25,
    side: 5,
    rear: 15,
  };

  console.log('\n🏘️ ZONING & SETBACKS');
  console.log(`   Zone: Likely RE-20 or RE-40 (Residential Estate)`);
  console.log(`   Front Setback: ${setbacks.front} feet`);
  console.log(`   Side Setback: ${setbacks.side} feet`);
  console.log(`   Rear Setback: ${setbacks.rear} feet`);

  // Calculate buildable envelope
  console.log('\n🔨 BUILDABLE AREA CALCULATION');

  // Apply uniform side setback first
  const sideBuffer = turf.buffer(polygon, -setbacks.side, { units: 'feet' });

  if (!sideBuffer) {
    console.error('Lot too small for minimum setbacks');
    return;
  }

  // Apply additional front/rear reduction (simplified)
  const avgExtraSetback = (setbacks.front - setbacks.side + (setbacks.rear - setbacks.side)) / 4;
  const envelope =
    avgExtraSetback > 0 ? turf.buffer(sideBuffer, -avgExtraSetback, { units: 'feet' }) : sideBuffer;

  if (!envelope) {
    console.error('Insufficient area after setbacks');
    return;
  }

  const envelopeArea = Math.round(turf.area(envelope) * 10.7639);

  // Estimate existing house footprint (30% for large lots)
  const existingFootprint = Math.round(lotAreaSqft * 0.25);
  const buildableForADU = Math.max(0, envelopeArea - existingFootprint);

  console.log(`   Lot Area: ${lotAreaSqft.toLocaleString()} sqft`);
  console.log(`   After Setbacks: ${envelopeArea.toLocaleString()} sqft`);
  console.log(`   Est. House Footprint: ${existingFootprint.toLocaleString()} sqft (25% coverage)`);
  console.log(`   Available for ADU: ${buildableForADU.toLocaleString()} sqft`);

  // ADU viability
  const maxADU = Math.min(1200, buildableForADU);
  const isViable = buildableForADU >= 770;

  console.log('\n🏡 ADU FEASIBILITY');
  console.log(`   Status: ${isViable ? '✅ VIABLE' : '❌ NOT VIABLE'}`);

  if (isViable) {
    console.log(`   Max ADU Size: ${maxADU.toLocaleString()} sqft`);
    console.log('\n   Recommended Options:');
    if (maxADU >= 1200) {
      console.log('   • 3BR/2BA (1,200 sqft): $3,800-4,500/mo');
    }
    if (maxADU >= 1000) {
      console.log('   • 2BR/2BA (1,000 sqft): $3,200-3,800/mo');
    }
    if (maxADU >= 800) {
      console.log('   • 2BR/1BA (800 sqft): $2,600-3,200/mo');
    }
    if (maxADU >= 600) {
      console.log('   • 1BR/1BA (600 sqft): $2,200-2,600/mo');
    }

    // Investment analysis
    const targetSize = Math.min(1000, maxADU);
    const costPerSqft = 200;
    const construction = targetSize * costPerSqft;
    const softCosts = 35000;
    const total = construction + softCosts;
    const monthlyRent = targetSize * 3.2;
    const annualIncome = monthlyRent * 12;
    const roi = ((annualIncome / total) * 100).toFixed(1);

    console.log('\n💰 INVESTMENT ANALYSIS');
    console.log(`   Target ADU: ${targetSize} sqft`);
    console.log(`   Construction: $${construction.toLocaleString()}`);
    console.log(`   Soft Costs: $${softCosts.toLocaleString()}`);
    console.log(`   Total Investment: $${total.toLocaleString()}`);
    console.log(`   Expected Rent: $${Math.round(monthlyRent).toLocaleString()}/mo`);
    console.log(`   Annual Income: $${Math.round(annualIncome).toLocaleString()}`);
    console.log(`   ROI: ${roi}%`);

    // Distance to CLU
    const cluCoords = [-118.8784, 34.2249]; // California Lutheran University
    const parcelCentroid = turf.centroid(polygon);
    const distanceToCLU = turf.distance(parcelCentroid, turf.point(cluCoords), { units: 'miles' });

    console.log('\n📍 LOCATION ADVANTAGES');
    console.log(`   Distance to CLU: ${distanceToCLU.toFixed(1)} miles`);
    console.log(`   Drive time to CLU: ~${Math.round(distanceToCLU * 3)} minutes`);
    console.log(`   Rental demand: High (students, faculty, professionals)`);
  }

  // Save results
  const results = {
    address: '1618 Burning Tree Dr',
    apn: attrs.PARCEL_APN,
    lot_sqft: lotAreaSqft,
    lot_acres: parseFloat(lotAreaAcres),
    buildable_sqft: buildableForADU,
    max_adu_sqft: maxADU,
    viable: isViable,
    geometry: parcel.geometry,
    analyzed_at: new Date().toISOString(),
  };

  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/1618_burning_tree_analysis.json', JSON.stringify(results, null, 2));

  console.log('\n📄 Full analysis saved to: out/1618_burning_tree_analysis.json');
}

analyzeProperty().catch(console.error);
