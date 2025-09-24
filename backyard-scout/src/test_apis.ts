#!/usr/bin/env tsx
/**
 * API Endpoint Verification Tool
 * Tests all external APIs used by the Buildable-LA system
 */

import { fetch } from 'undici';

interface ApiTestResult {
  name: string;
  endpoint: string;
  status: 'working' | 'failed' | 'degraded';
  responseTime: number;
  details: string;
}

const API_TESTS = [
  {
    name: 'California Statewide Parcels',
    endpoint:
      'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0',
    test: async () => {
      const params = new URLSearchParams({
        f: 'json',
        where: "SITE_ZIP = '91301'",
        outFields: 'PARCEL_APN',
        returnGeometry: 'false',
        resultRecordCount: '1',
      });

      const response = await fetch(`${API_TESTS[0].endpoint}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });

      const data = (await response.json()) as any;
      return response.ok && data.features !== undefined;
    },
  },
  {
    name: 'Zoneomics API',
    endpoint: 'https://api.zoneomics.com/v2/parcels/tile',
    test: async () => {
      // Test tile: Los Angeles area
      const url =
        'https://api.zoneomics.com/v2/parcels/tile/17/22361/52274.pbf?apikey=ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
      });

      return response.ok && response.headers.get('content-type')?.includes('protobuf');
    },
  },
  {
    name: 'Microsoft Building Footprints',
    endpoint:
      'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0',
    test: async () => {
      const params = new URLSearchParams({
        f: 'json',
        where: "STATE='CA'",
        geometry: '-118.5,34.0,-118.4,34.1',
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID',
        returnGeometry: 'false',
        resultRecordCount: '1',
      });

      const response = await fetch(`${API_TESTS[2].endpoint}/query?${params}`, {
        signal: AbortSignal.timeout(10000),
      });

      const data = (await response.json()) as any;
      return response.ok && data.features !== undefined;
    },
  },
  {
    name: 'OpenStreetMap Overpass',
    endpoint: 'https://overpass-api.de/api/interpreter',
    test: async () => {
      // Small test query
      const query = `[out:json][timeout:5];
        way["building"](34.0,-118.5,34.01,-118.49);
        out count;`;

      const response = await fetch(API_TESTS[3].endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(10000),
      });

      const data = (await response.json()) as any;
      return response.ok && data.elements !== undefined;
    },
  },
  {
    name: 'LA County Buildings',
    endpoint:
      'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Buildings/MapServer/0',
    test: async () => {
      const params = new URLSearchParams({
        f: 'json',
        geometry: '-118.5,34.0,-118.4,34.1',
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID',
        returnGeometry: 'false',
        resultRecordCount: '1',
      });

      const response = await fetch(`${API_TESTS[4].endpoint}/query?${params}`, {
        signal: AbortSignal.timeout(10000),
      });

      const data = (await response.json()) as any;
      return response.ok && data.features !== undefined;
    },
  },
];

async function testApi(api: (typeof API_TESTS)[0]): Promise<ApiTestResult> {
  const startTime = Date.now();

  try {
    const success = await api.test();
    const responseTime = Date.now() - startTime;

    if (success) {
      return {
        name: api.name,
        endpoint: api.endpoint,
        status: 'working',
        responseTime,
        details: `Response in ${responseTime}ms`,
      };
    } else {
      return {
        name: api.name,
        endpoint: api.endpoint,
        status: 'failed',
        responseTime,
        details: 'Invalid response format',
      };
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime;

    if (error.name === 'AbortError') {
      return {
        name: api.name,
        endpoint: api.endpoint,
        status: 'degraded',
        responseTime,
        details: 'Timeout - API is slow',
      };
    }

    return {
      name: api.name,
      endpoint: api.endpoint,
      status: 'failed',
      responseTime,
      details: error.message || 'Unknown error',
    };
  }
}

async function main() {
  console.log('🔍 API ENDPOINT VERIFICATION');
  console.log('📅 ' + new Date().toLocaleString());
  console.log('='.repeat(60));
  console.log('\nTesting all external APIs...\n');

  const results: ApiTestResult[] = [];

  for (const api of API_TESTS) {
    process.stdout.write(`Testing ${api.name}... `);
    const result = await testApi(api);
    results.push(result);

    if (result.status === 'working') {
      console.log(`✅ Working (${result.responseTime}ms)`);
    } else if (result.status === 'degraded') {
      console.log(`🟡 Degraded (${result.responseTime}ms)`);
    } else {
      console.log(`❌ Failed - ${result.details}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY:');
  console.log('='.repeat(60));

  const working = results.filter((r) => r.status === 'working').length;
  const degraded = results.filter((r) => r.status === 'degraded').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log(`✅ Working: ${working}/${results.length}`);
  console.log(`🟡 Degraded: ${degraded}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}`);

  // Critical APIs check
  console.log('\n📊 CRITICAL APIS STATUS:');
  const criticalApis = ['California Statewide Parcels', 'Zoneomics API'];

  for (const apiName of criticalApis) {
    const result = results.find((r) => r.name === apiName);
    if (result) {
      const icon = result.status === 'working' ? '✅' : result.status === 'degraded' ? '🟡' : '❌';
      console.log(`   ${icon} ${apiName}: ${result.status.toUpperCase()}`);
    }
  }

  // Building data sources
  console.log('\n🏢 BUILDING DATA SOURCES:');
  const buildingApis = [
    'Microsoft Building Footprints',
    'OpenStreetMap Overpass',
    'LA County Buildings',
  ];

  for (const apiName of buildingApis) {
    const result = results.find((r) => r.name === apiName);
    if (result) {
      const icon = result.status === 'working' ? '✅' : result.status === 'degraded' ? '🟡' : '❌';
      console.log(`   ${icon} ${apiName}: ${result.status.toUpperCase()}`);
    }
  }

  // API documentation
  console.log('\n📚 API DOCUMENTATION:');
  console.log('='.repeat(60));
  console.log('\n1. California Statewide Parcels (REQUIRED)');
  console.log('   - Purpose: Parcel boundaries, APNs, addresses');
  console.log('   - Coverage: All 58 California counties');
  console.log('   - Fallback: None - critical for all operations');

  console.log('\n2. Zoneomics API (REQUIRED)');
  console.log('   - Purpose: Zoning codes and setback requirements');
  console.log('   - Coverage: All California');
  console.log('   - API Key: ed8066dd45cef9ed3bb531483c0e3bb3f0f70519');

  console.log('\n3. Building Data Sources (At least one needed):');
  console.log('   a. Microsoft Building Footprints');
  console.log('      - Coverage: Statewide, ML-generated');
  console.log('   b. OpenStreetMap');
  console.log('      - Coverage: Urban areas, community-sourced');
  console.log('   c. LA County Buildings');
  console.log('      - Coverage: LA County only, official data');

  // Save results
  const fs = await import('fs/promises');
  await fs.writeFile(
    'api_status.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results,
        summary: { working, degraded, failed },
      },
      null,
      2,
    ),
  );
  console.log('\n💾 Results saved to: api_status.json');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
