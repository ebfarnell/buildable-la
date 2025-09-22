/**
 * Research and test working building footprint endpoints across California
 * Create a comprehensive directory of reliable data sources
 */

import { fetch } from 'undici';

// Potential building footprint sources to test
const potentialSources = [
  // Los Angeles County - test multiple variations
  {
    name: 'LA County Building Footprints (v1)',
    url: 'https://maps.gis.lacounty.gov/arcgis/rest/services/LACounty_Buildings/MapServer/0',
    counties: ['LOS ANGELES'],
  },
  {
    name: 'LA County Building Footprints (v2)',
    url: 'https://egis.lacounty.gov/arcgis/rest/services/Layers/LACounty_Buildings/MapServer/0',
    counties: ['LOS ANGELES'],
  },
  {
    name: 'LA County Structures',
    url: 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/LACounty_Buildings/MapServer/0',
    counties: ['LOS ANGELES'],
  },

  // San Diego County
  {
    name: 'San Diego County Buildings',
    url: 'https://sdgis.sandag.org/arcgis/rest/services/Regional/Building_Footprints/MapServer/0',
    counties: ['SAN DIEGO'],
  },
  {
    name: 'City of San Diego Buildings',
    url: 'https://services.arcgis.com/1vIhDJwtG5eNmiqX/arcgis/rest/services/Buildings/FeatureServer/0',
    counties: ['SAN DIEGO'],
  },

  // Orange County
  {
    name: 'Orange County Buildings',
    url: 'https://ocgis.com/arcgis2/rest/services/Public_Safety/OC_Buildings/MapServer/0',
    counties: ['ORANGE'],
  },

  // Ventura County
  {
    name: 'Ventura County Buildings',
    url: 'https://gis.ventura.org/arcgis/rest/services/Operational/Buildings/MapServer/0',
    counties: ['VENTURA'],
  },

  // Sacramento County
  {
    name: 'Sacramento County Buildings',
    url: 'https://services.gis.saccounty.net/arcgis/rest/services/Property/Buildings/MapServer/0',
    counties: ['SACRAMENTO'],
  },

  // Santa Clara County
  {
    name: 'Santa Clara County Buildings',
    url: 'https://www.sccgov.org/sites/dpd/GIS/GISMaps/rest/services/Building_Footprints/MapServer/0',
    counties: ['SANTA CLARA'],
  },

  // Alameda County
  {
    name: 'Alameda County Buildings',
    url: 'https://maps.acgov.org/arcgis/rest/services/Community_Development/Buildings/MapServer/0',
    counties: ['ALAMEDA'],
  },

  // Statewide sources
  {
    name: 'California Building Footprints',
    url: 'https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/California_Building_Footprints/FeatureServer/0',
    counties: ['ALL'],
  },
  {
    name: 'USA Structures (ESRI)',
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Structures_View/FeatureServer/0',
    counties: ['ALL'],
  },
];

async function testEndpointHealth(url: string): Promise<any> {
  try {
    // Test basic connectivity
    console.log(`   Testing: ${url}`);

    const response = await fetch(`${url}?f=json`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    // Check if it's a valid feature service
    if (!data.type || data.type !== 'Feature Layer') {
      return { success: false, error: 'Not a feature layer' };
    }

    return {
      success: true,
      name: data.name,
      description: data.description,
      geometryType: data.geometryType,
      fields: data.fields?.length || 0,
      capabilities: data.capabilities,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function testEndpointData(url: string): Promise<any> {
  try {
    // Test with LA area coordinates
    const testLat = 34.0522;
    const testLon = -118.2437;
    const buffer = 0.001;

    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      geometry: `${testLon - buffer},${testLat - buffer},${testLon + buffer},${testLat + buffer}`,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'false',
      resultRecordCount: '5',
    });

    const response = await fetch(`${url}/query?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { hasData: false, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as any;

    if (data.error) {
      return { hasData: false, error: data.error.message };
    }

    return {
      hasData: true,
      features: data.features?.length || 0,
      exceededTransferLimit: data.exceededTransferLimit || false,
    };
  } catch (error: any) {
    return { hasData: false, error: error.message };
  }
}

async function findWorkingBuildingSources() {
  console.log('🔍 Testing Building Footprint Sources Across California');
  console.log('='.repeat(70));

  const workingSources: any[] = [];
  const failedSources: any[] = [];

  for (const source of potentialSources) {
    console.log(`\n🏗️ Testing: ${source.name}`);
    console.log(`Counties: ${source.counties.join(', ')}`);

    // Test endpoint health
    const healthResult = await testEndpointHealth(source.url);

    if (!healthResult.success) {
      console.log(`   ❌ Health check failed: ${healthResult.error}`);
      failedSources.push({ ...source, error: healthResult.error });
      continue;
    }

    console.log(`   ✅ Health check passed: ${healthResult.name}`);
    console.log(`   📊 Fields: ${healthResult.fields}, Geometry: ${healthResult.geometryType}`);

    // Test actual data availability
    const dataResult = await testEndpointData(source.url);

    if (!dataResult.hasData) {
      console.log(`   ⚠️ No data found: ${dataResult.error}`);
      failedSources.push({ ...source, error: `No data: ${dataResult.error}` });
      continue;
    }

    console.log(`   🎯 Data found: ${dataResult.features} features`);
    workingSources.push({
      ...source,
      health: healthResult,
      data: dataResult,
    });
  }

  // Results summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 BUILDING SOURCE DISCOVERY RESULTS');
  console.log('='.repeat(70));

  if (workingSources.length > 0) {
    console.log(`\n✅ Working Sources (${workingSources.length}):`);
    workingSources.forEach((source) => {
      console.log(`   ${source.name}`);
      console.log(`     URL: ${source.url}`);
      console.log(`     Counties: ${source.counties.join(', ')}`);
      console.log(`     Features: ${source.data.features}`);
    });
  }

  if (failedSources.length > 0) {
    console.log(`\n❌ Failed Sources (${failedSources.length}):`);
    failedSources.forEach((source) => {
      console.log(`   ${source.name}: ${source.error}`);
    });
  }

  // Generate updated configuration
  console.log('\n📝 Updated Building Sources Configuration:');
  console.log('```typescript');
  console.log('const WORKING_BUILDING_SOURCES = {');

  const countiesBySource: any = {};
  workingSources.forEach((source) => {
    source.counties.forEach((county: string) => {
      if (!countiesBySource[county]) countiesBySource[county] = [];
      countiesBySource[county].push({
        name: source.name,
        endpoint: source.url,
        priority: 1,
        available: true,
      });
    });
  });

  Object.entries(countiesBySource).forEach(([county, sources]) => {
    console.log(`  '${county}': [`);
    (sources as any[]).forEach((source) => {
      console.log(`    {`);
      console.log(`      name: '${source.name}',`);
      console.log(`      endpoint: '${source.endpoint}',`);
      console.log(`      priority: ${source.priority},`);
      console.log(`      available: ${source.available}`);
      console.log(`    },`);
    });
    console.log(`  ],`);
  });

  // Always include OSM as fallback
  console.log(`  'DEFAULT': [`);
  console.log(`    {`);
  console.log(`      name: 'OpenStreetMap Buildings',`);
  console.log(`      endpoint: 'https://overpass-api.de/api/interpreter',`);
  console.log(`      priority: 2,`);
  console.log(`      available: true`);
  console.log(`    },`);
  console.log(`    {`);
  console.log(`      name: 'Estimated from Parcel',`);
  console.log(`      endpoint: 'ESTIMATED',`);
  console.log(`      priority: 3,`);
  console.log(`      available: true`);
  console.log(`    }`);
  console.log(`  ]`);
  console.log('};');
  console.log('```');

  console.log('\n' + '='.repeat(70));
  console.log('🔍 BUILDING SOURCE DISCOVERY COMPLETE');
  console.log('='.repeat(70));
}

findWorkingBuildingSources().catch(console.error);
