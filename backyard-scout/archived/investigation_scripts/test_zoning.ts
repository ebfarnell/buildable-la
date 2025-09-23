import { jurisdictionByParcel, zoningIntersect } from './src/sources.js';

const testParcel = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-118.445, 34.057],
            [-118.444, 34.057],
            [-118.444, 34.056],
            [-118.445, 34.056],
            [-118.445, 34.057],
          ],
        ],
      },
      properties: { APN: 'TEST-90024' },
    },
  ],
};

async function test() {
  console.log('Testing parcel in 90024 area...');
  try {
    const jurisdiction = await jurisdictionByParcel(testParcel);
    console.log('Jurisdiction:', jurisdiction);

    const zoning = await zoningIntersect(testParcel);
    console.log('Zoning features:', zoning.features?.length || 0);
    if (zoning.features?.[0]) {
      console.log('Zone code:', zoning.features[0].properties);
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

test();
