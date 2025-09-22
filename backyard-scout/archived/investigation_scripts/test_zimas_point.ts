import { queryFeatureLayer } from './src/arcgis.js';

async function test() {
  const esriPoint = { x: -118.445, y: 34.057, spatialReference: { wkid: 4326 } };
  const layers = [11, 15];

  for (const layer of layers) {
    console.log(`Testing ZIMAS layer ${layer}...`);
    try {
      const res = await queryFeatureLayer(
        `https://zimas.lacity.org/arcgis/rest/services/zma/zimas/MapServer/${layer}`,
        {
          geometry: JSON.stringify(esriPoint),
          geometryType: 'esriGeometryPoint',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: '*',
          returnGeometry: false,
          inSR: 4326,
        },
      );
      console.log(`  Features found: ${res.features.length}`);
      if (res.features[0]) {
        console.log(`  Sample props:`, Object.keys(res.features[0].properties).slice(0, 5));
        if (res.features[0].properties.ZONE_CODE) {
          console.log(`  ZONE_CODE:`, res.features[0].properties.ZONE_CODE);
        }
      }
    } catch (e) {
      console.log(`  Error: ${e.message.split('\n')[0]}`);
    }
  }
}

test();
