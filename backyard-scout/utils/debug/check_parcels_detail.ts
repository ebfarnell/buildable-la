import { fetch } from 'undici';
import * as turf from '@turf/turf';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

async function getParcelDetails(address: string, county: string) {
  console.log(`\n🔍 Searching: ${address}`);

  // Extract search terms
  const parts = address.match(/(\d+)\s+(.+?),/);
  if (!parts) return;

  const houseNum = parts[1];
  const street = parts[2].replace(/St|Dr|Ave/, '').trim();

  const params = new URLSearchParams({
    f: 'json',
    where: `COUNTYNAME='${county}' AND SITE_ADDR LIKE '%${houseNum}%${street.toUpperCase()}%'`,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
  });

  try {
    const response = await fetch(`${CA_PARCELS_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as any;

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const attrs = feature.attributes;

      console.log('✅ Found parcel:');
      console.log('   APN:', attrs.PARCEL_APN);
      console.log('   Address:', attrs.SITE_ADDR);
      console.log('   County:', attrs.COUNTYNAME);
      console.log('   City:', attrs.SITE_CITY);

      // Calculate area from geometry if available
      if (feature.geometry && feature.geometry.rings) {
        const geojson = {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: feature.geometry.rings,
          },
          properties: {},
        };

        try {
          const area = turf.area(geojson as any);
          const sqft = Math.round(area * 10.7639);
          console.log('   Calculated Lot Size:', sqft.toLocaleString(), 'sqft');

          // Check stored fields
          console.log('   Stored Shape__Area:', attrs.Shape__Area);
          console.log('   Stored LOT_SIZE_SQFT:', attrs.LOT_SIZE_SQFT);
          console.log('   Stored ACRES_CALC:', attrs.ACRES_CALC);
        } catch (e) {
          console.log('   Error calculating area:', e.message);
        }
      } else {
        console.log('   No geometry data');
      }

      return feature;
    } else {
      console.log('❌ No parcel found');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

async function main() {
  await getParcelDetails('20616 Archwood St, Winnetka, CA 91306', 'LOS ANGELES');
  await getParcelDetails('10921 Polaris Dr, San Diego, CA 92126', 'SAN DIEGO');
  await getParcelDetails('1843 S Bedford St, Los Angeles, CA 90035', 'LOS ANGELES');
}

main();
