import fs from 'node:fs';
import * as turf from '@turf/turf';
import { fetch } from 'undici';

// California Lutheran University coordinates
const CLU = {
  name: 'California Lutheran University',
  lon: -118.8784,
  lat: 34.2249,
  address: '60 West Olsen Road, Thousand Oaks, CA 91360'
};

async function getCLUAreaParcels() {
  // Create 1.5 mile buffer around CLU
  const point = turf.point([CLU.lon, CLU.lat]);
  const buffer = turf.buffer(point, 1.5, {units: 'miles'});
  const bbox = turf.bbox(buffer);

  console.log('🎓 Getting parcels near California Lutheran University...');
  console.log(`   Location: ${CLU.address}`);
  console.log(`   Search radius: 1.5 miles`);

  // Query CA Statewide Parcels for Thousand Oaks near CLU
  const url = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0/query';

  const params = new URLSearchParams({
    f: 'json',
    where: `COUNTYNAME='Ventura' AND SITE_CITY='THOUSAND OAKS'`,
    geometry: JSON.stringify({
      xmin: bbox[0], ymin: bbox[1],
      xmax: bbox[2], ymax: bbox[3]
    }),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'PARCEL_APN,SITE_ADDR,SITE_CITY,SITE_ZIP,SITE_HOUSE_NUMBER,SITE_STREET_NAME',
    returnGeometry: 'true',
    resultRecordCount: '100',
    orderByFields: 'PARCEL_APN'
  });

  console.log('\n📊 Fetching parcels...');

  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: params.toString()
  });

  const data = await response.json() as any;

  if (data.error) {
    console.error('❌ Error:', data.error.message);
    return;
  }

  const parcels = data.features || [];
  console.log(`✅ Found ${parcels.length} parcels`);

  // Calculate buildable area for each (simple estimate)
  const results = [];
  for (const p of parcels) {
    if (!p.geometry?.rings) continue;

    const poly = turf.polygon(p.geometry.rings);
    const lotArea = turf.area(poly);
    const envelope = turf.buffer(poly, -5, {units: 'feet'}); // 5ft setback
    const buildable = envelope ? turf.area(envelope) : 0;

    const lotSqft = Math.round(lotArea * 10.7639);
    const buildableSqft = Math.round(buildable * 10.7639);

    if (buildableSqft >= 800) { // Minimum for ADU
      const distanceMi = turf.distance(point, turf.centroid(poly), {units: 'miles'});

      results.push({
        apn: p.attributes.PARCEL_APN,
        address: `${p.attributes.SITE_HOUSE_NUMBER || ''} ${p.attributes.SITE_STREET_NAME || ''}`.trim() || p.attributes.SITE_ADDR,
        city: p.attributes.SITE_CITY,
        zip: p.attributes.SITE_ZIP,
        lot_sqft: lotSqft,
        buildable_sqft: buildableSqft,
        distance_to_clu: Math.round(distanceMi * 10) / 10,
        rental_score: Math.round((buildableSqft / 1000) * (2 - Math.min(distanceMi, 2)))
      });
    }
  }

  // Sort by rental score
  results.sort((a, b) => b.rental_score - a.rental_score);

  // Save top 10
  const top10 = results.slice(0, 10);

  console.log('\n🏆 Top 10 Properties for ADU Rental near CLU:');
  console.log(''.padEnd(70, '-'));

  top10.forEach((p, i) => {
    console.log(`${i + 1}. ${p.address}`);
    console.log(`   APN: ${p.apn}`);
    console.log(`   Buildable: ${p.buildable_sqft.toLocaleString()} sqft`);
    console.log(`   Distance: ${p.distance_to_clu} miles from CLU`);
    console.log(`   Rental Score: ${p.rental_score}`);
    console.log('');
  });

  // Save to CSV
  fs.mkdirSync('out', {recursive: true});
  const csv = [
    'rank,apn,address,city,zip,lot_sqft,buildable_sqft,distance_miles,rental_score',
    ...top10.map((p, i) =>
      `${i + 1},${p.apn},"${p.address}",${p.city},${p.zip},${p.lot_sqft},${p.buildable_sqft},${p.distance_to_clu},${p.rental_score}`
    )
  ].join('\n');

  fs.writeFileSync('out/top_10_clu_thousand_oaks.csv', csv);
  console.log('📄 Results saved to out/top_10_clu_thousand_oaks.csv');

  // Save all results
  fs.writeFileSync('out/all_clu_parcels.json', JSON.stringify(results, null, 2));
  console.log(`📄 All ${results.length} viable properties saved to out/all_clu_parcels.json`);
}

getCLUAreaParcels().catch(console.error);