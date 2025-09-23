/**
 * Test building footprints with actual parcel geometries from CA Statewide Parcels
 */

import { getBuildingFootprints } from './services/building_footprints_deterministic.js';
import { fetch } from 'undici';

/**
 * Get actual parcel geometry from CA Statewide Parcels
 */
async function getActualParcelGeometry(
  address: string,
): Promise<{ apn: string; county: string; geometry: any }> {
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
  const data = (await response.json()) as any;

  if (!data.features || data.features.length === 0) {
    throw new Error(`No parcel found for address: ${address}`);
  }

  const feature = data.features[0];
  const attrs = feature.attributes;

  return {
    apn: attrs.PARCEL_APN,
    county: attrs.COUNTYNAME,
    geometry: feature.geometry,
  };
}

async function testRealGeometries() {
  const addresses = [
    '20616 Archwood St, Winnetka, CA, 91306',
    '10921 Polaris Dr, San Diego, CA, 92126',
    '1843 S Bedford St, Los Angeles, CA, 90035',
  ];

  console.log('🔍 Testing Building Footprints with REAL Parcel Geometries');
  console.log('='.repeat(70));

  for (const address of addresses) {
    console.log(`\n📍 ${address}`);

    try {
      // Get actual parcel geometry
      const { apn, county, geometry } = await getActualParcelGeometry(address);
      console.log(`   APN: ${apn}, County: ${county}`);

      // Test building footprints with real geometry
      const buildings = await getBuildingFootprints(geometry, county, apn);

      const totalArea = buildings.reduce((sum, b) => sum + b.area_sqft, 0);
      const source = buildings[0]?.source || 'NONE';

      console.log(`   Buildings Found: ${buildings.length}`);
      console.log(`   Total Area: ${totalArea.toLocaleString()} sqft`);
      console.log(`   Source: ${source}`);

      if (buildings.length > 0) {
        buildings.forEach((building, i) => {
          console.log(
            `     Building ${i + 1}: ${building.area_sqft.toLocaleString()} sqft (${building.source}) [${building.id}]`,
          );
        });
      }

      // Also show the 30% estimate for comparison
      const estimatedArea = Math.round(totalArea / 0.3); // Reverse-calculate lot size
      console.log(
        `   Estimated vs Actual: 30% rule would estimate ~${Math.round(estimatedArea * 0.3).toLocaleString()} sqft`,
      );
    } catch (error) {
      console.error(`❌ Error: ${error}`);
    }
  }
}

testRealGeometries().catch(console.error);
