import { jurisdictionByParcel } from './src/sources.js';
import { queryFeatureLayer } from './src/arcgis.js';

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

    // Test ZIMAS layer 1101 directly
    const esriPoly = {
      rings: testParcel.features[0].geometry.coordinates,
      spatialReference: { wkid: 4326 },
    };
    const res = await queryFeatureLayer(
      'https://zimas.lacity.org/arcgis/rest/services/zma/zimas/MapServer/1101',
      {
        geometry: JSON.stringify(esriPoly),
        geometryType: 'esriGeometryPolygon',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        returnGeometry: false,
        inSR: 4326,
      },
    );
    console.log('ZIMAS 1101 result:', res);
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

test();
