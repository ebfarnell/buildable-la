/**
 * Debug why 10921 Polaris Dr, San Diego couldn't get zoning data
 */

import { getEnhancedZoning } from '../services/enhanced_zoning_service.js';
import { zoningIntersect, jurisdictionByParcel } from '../sources.js';
import { getZoneomicsZoningWithFallback } from '../services/zoneomics_tiles_service.js';

const ZONEOMICS_API_KEY = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

// Polaris property coordinates
const polarisProperty = {
  address: '10921 Polaris Dr, San Diego, CA, 92126',
  lat: 32.8983,
  lon: -117.1219,
};

// Create test parcel GeoJSON
const testParcelGeojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        address: polarisProperty.address,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [polarisProperty.lon - 0.0002, polarisProperty.lat - 0.0001],
            [polarisProperty.lon + 0.0002, polarisProperty.lat - 0.0001],
            [polarisProperty.lon + 0.0002, polarisProperty.lat + 0.0001],
            [polarisProperty.lon - 0.0002, polarisProperty.lat + 0.0001],
            [polarisProperty.lon - 0.0002, polarisProperty.lat - 0.0001],
          ],
        ],
      },
    },
  ],
};

async function debugPolarisZoning() {
  console.log('🔍 Debugging Polaris Property Zoning Issue');
  console.log('='.repeat(60));
  console.log(`Property: ${polarisProperty.address}`);
  console.log(`Coordinates: ${polarisProperty.lat}, ${polarisProperty.lon}`);

  // Step 1: Test jurisdiction lookup
  console.log('\n1️⃣ Testing Jurisdiction Lookup (ArcGIS)...');
  try {
    const jurisdiction = await jurisdictionByParcel(testParcelGeojson);
    console.log(`✅ Jurisdiction found: ${jurisdiction}`);
  } catch (error) {
    console.log(`❌ Jurisdiction lookup failed: ${error}`);
  }

  // Step 2: Test ArcGIS zoning layers directly
  console.log('\n2️⃣ Testing ArcGIS Zoning Layers...');
  try {
    const arcgisResult = await zoningIntersect(testParcelGeojson);
    console.log(`✅ ArcGIS zoning found:`, arcgisResult.features?.[0]?.properties);
  } catch (error) {
    console.log(`❌ ArcGIS zoning failed: ${error}`);
    console.log('   This is expected - ArcGIS layers are configured for LA County, not San Diego');
  }

  // Step 3: Test Zoneomics tiles directly
  console.log('\n3️⃣ Testing Zoneomics Tiles API...');
  try {
    const zoneomicsResult = await getZoneomicsZoningWithFallback(
      polarisProperty.lat,
      polarisProperty.lon,
      ZONEOMICS_API_KEY,
    );

    if (zoneomicsResult) {
      console.log(`✅ Zoneomics found:`, zoneomicsResult);
    } else {
      console.log(`⚠️ Zoneomics returned null - no data for this location`);
    }
  } catch (error) {
    console.log(`❌ Zoneomics failed: ${error}`);
  }

  // Step 4: Test enhanced zoning service
  console.log('\n4️⃣ Testing Enhanced Zoning Service...');
  try {
    const enhancedResult = await getEnhancedZoning(testParcelGeojson, ZONEOMICS_API_KEY);
    console.log(`Result:`, enhancedResult);
  } catch (error) {
    console.log(`❌ Enhanced zoning failed: ${error}`);
  }

  // Step 5: Check coverage areas
  console.log('\n5️⃣ Coverage Analysis...');
  console.log('📍 ArcGIS Coverage: LA County only (configured endpoints)');
  console.log('🗺️ Zoneomics Coverage: Should be nationwide but may have gaps');
  console.log('🏠 Local Estimates: Only Thousand Oaks area (34.1-34.3 lat, -119.0 to -118.7 lon)');
  console.log(`🎯 San Diego coords: ${polarisProperty.lat}, ${polarisProperty.lon}`);

  if (
    polarisProperty.lat < 34.1 ||
    polarisProperty.lat > 34.3 ||
    polarisProperty.lon < -119.0 ||
    polarisProperty.lon > -118.7
  ) {
    console.log('⚠️ San Diego is outside local estimate coverage area');
  }

  console.log('\n' + '='.repeat(60));
  console.log('🔍 POLARIS ZONING DEBUG COMPLETE');
  console.log('='.repeat(60));
}

debugPolarisZoning().catch(console.error);
