import { fetch } from 'undici';

const CA_PARCELS_URL = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

async function debugParcel(apn: string, county: string) {
  console.log(`\nChecking APN ${apn} in ${county}...`);
  
  const params = new URLSearchParams({
    f: 'json',
    where: `PARCEL_APN='${apn}' AND COUNTYNAME='${county}'`,
    outFields: 'PARCEL_APN,SITE_ADDR,Shape__Area,LOT_SIZE_SQFT,ACRES_CALC',
    returnGeometry: 'true',
    outSR: '4326'
  });

  const response = await fetch(`${CA_PARCELS_URL}/query`, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: params.toString()
  });

  const data = await response.json() as any;
  
  if (data.features && data.features.length > 0) {
    const feature = data.features[0];
    const attrs = feature.attributes;
    console.log('Attributes:', {
      apn: attrs.PARCEL_APN,
      address: attrs.SITE_ADDR,
      shapeArea: attrs.Shape__Area,
      lotSizeSqft: attrs.LOT_SIZE_SQFT,
      acresCalc: attrs.ACRES_CALC
    });
    console.log('Geometry type:', feature.geometry ? feature.geometry.rings ? 'Polygon' : 'Unknown' : 'No geometry');
    if (feature.geometry && feature.geometry.rings) {
      console.log('Ring count:', feature.geometry.rings.length);
      console.log('Points in first ring:', feature.geometry.rings[0].length);
    }
  }
}

async function main() {
  await debugParcel('2148020015', 'LOS ANGELES');
  await debugParcel('3181941500', 'SAN DIEGO');
  await debugParcel('4303015010', 'LOS ANGELES');
}

main();
