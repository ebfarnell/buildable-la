/**
 * Test building footprint endpoints to see why they're not working
 * and identify working data sources across California
 */

import { fetch } from 'undici';
import * as turf from '@turf/turf';

// Test coordinates for our three properties
const testProperties = [
  {
    name: "Winnetka, CA (LA County)",
    lat: 34.2047,
    lon: -118.5717,
    county: "LOS ANGELES"
  },
  {
    name: "San Diego, CA",
    lat: 32.8983,
    lon: -117.1219,
    county: "SAN DIEGO"
  },
  {
    name: "Los Angeles, CA",
    lat: 34.0392,
    lon: -118.3617,
    county: "LOS ANGELES"
  }
];

// Building footprint endpoints to test
const buildingEndpoints = [
  {
    name: 'LA County Buildings',
    endpoint: 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Buildings/MapServer/0',
    counties: ['LOS ANGELES'],
    type: 'arcgis'
  },
  {
    name: 'California Statewide Buildings',
    endpoint: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Structures/FeatureServer/0',
    counties: ['ALL'],
    type: 'arcgis'
  },
  {
    name: 'Microsoft Building Footprints California',
    endpoint: 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/ms-buildings',
    counties: ['ALL'],
    type: 'microsoft'
  },
  {
    name: 'San Diego County Buildings',
    endpoint: 'https://services1.arcgis.com/1vIhDJwtG5eNmiqX/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    counties: ['SAN DIEGO'],
    type: 'arcgis'
  },
  {
    name: 'Orange County Buildings',
    endpoint: 'https://services2.arcgis.com/LLNIdHmmdjO2qQ5q/arcgis/rest/services/Building_Footprints/FeatureServer/0',
    counties: ['ORANGE'],
    type: 'arcgis'
  },
  {
    name: 'Ventura County Buildings',
    endpoint: 'https://gis.ventura.org/arcgis/rest/services/Operational/Building_Footprints/MapServer/0',
    counties: ['VENTURA'],
    type: 'arcgis'
  }
];

async function testArcGISEndpoint(endpoint: string, lat: number, lon: number) {
  try {
    // Create small bounding box around point
    const buffer = 0.001; // ~100 meters
    const bbox = [lon - buffer, lat - buffer, lon + buffer, lat + buffer];

    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      geometry: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      resultRecordCount: '5'
    });

    console.log(`   Testing: ${endpoint}`);
    const response = await fetch(`${endpoint}/query?${params}`, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json() as any;

    if (data.error) {
      console.log(`   ❌ API Error: ${data.error.message}`);
      return null;
    }

    if (!data.features || data.features.length === 0) {
      console.log(`   ⚠️ No buildings found in area`);
      return { buildings: 0, area: 0 };
    }

    let totalArea = 0;
    for (const feature of data.features) {
      if (feature.geometry?.rings) {
        try {
          const polygon = turf.polygon(feature.geometry.rings);
          const area = turf.area(polygon) * 10.7639; // Convert to sqft
          totalArea += area;
        } catch (e) {
          // Skip invalid geometries
        }
      }
    }

    console.log(`   ✅ Found ${data.features.length} buildings, ${Math.round(totalArea)} sqft total`);
    return { buildings: data.features.length, area: Math.round(totalArea) };

  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function testOSMBuildings(lat: number, lon: number) {
  try {
    const buffer = 0.001;
    const bbox = [lon - buffer, lat - buffer, lon + buffer, lat + buffer];

    const query = `[out:json][timeout:10];
      way["building"](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});
      out geom;`;

    console.log(`   Testing: OpenStreetMap Overpass API`);
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json() as any;

    if (!data.elements || data.elements.length === 0) {
      console.log(`   ⚠️ No OSM buildings found in area`);
      return { buildings: 0, area: 0 };
    }

    let totalArea = 0;
    for (const element of data.elements) {
      if (element.type === 'way' && element.geometry) {
        try {
          const coords = element.geometry.map((node: any) => [node.lon, node.lat]);
          coords.push(coords[0]); // Close polygon
          const polygon = turf.polygon([coords]);
          const area = turf.area(polygon) * 10.7639;
          totalArea += area;
        } catch (e) {
          // Skip invalid geometries
        }
      }
    }

    console.log(`   ✅ Found ${data.elements.length} OSM buildings, ${Math.round(totalArea)} sqft total`);
    return { buildings: data.elements.length, area: Math.round(totalArea) };

  } catch (error: any) {
    console.log(`   ❌ OSM Error: ${error.message}`);
    return null;
  }
}

async function testBuildingEndpoints() {
  console.log('🏗️ Testing Building Footprint Endpoints');
  console.log('=' . repeat(70));

  const results: any[] = [];

  for (const property of testProperties) {
    console.log(`\n📍 Testing: ${property.name}`);
    console.log(`Coordinates: ${property.lat}, ${property.lon}`);
    console.log(`County: ${property.county}`);
    console.log('─' . repeat(50));

    const propertyResults: any = {
      property: property.name,
      county: property.county,
      coordinates: `${property.lat}, ${property.lon}`,
      sources: []
    };

    // Test county-specific endpoints
    const relevantEndpoints = buildingEndpoints.filter(ep =>
      ep.counties.includes(property.county) || ep.counties.includes('ALL')
    );

    for (const endpoint of relevantEndpoints) {
      if (endpoint.type === 'arcgis') {
        const result = await testArcGISEndpoint(endpoint.endpoint, property.lat, property.lon);
        propertyResults.sources.push({
          name: endpoint.name,
          type: endpoint.type,
          success: result !== null,
          buildings: result?.buildings || 0,
          total_area_sqft: result?.area || 0
        });
      }
    }

    // Test OSM for all properties
    const osmResult = await testOSMBuildings(property.lat, property.lon);
    propertyResults.sources.push({
      name: 'OpenStreetMap',
      type: 'osm',
      success: osmResult !== null,
      buildings: osmResult?.buildings || 0,
      total_area_sqft: osmResult?.area || 0
    });

    results.push(propertyResults);
  }

  // Summary
  console.log('\n' + '=' . repeat(70));
  console.log('📊 BUILDING FOOTPRINT ENDPOINT RESULTS');
  console.log('=' . repeat(70));

  for (const result of results) {
    console.log(`\n🏠 ${result.property}:`);

    const workingSources = result.sources.filter((s: any) => s.success && s.buildings > 0);
    const failedSources = result.sources.filter((s: any) => !s.success || s.buildings === 0);

    if (workingSources.length > 0) {
      console.log(`✅ Working sources (${workingSources.length}):`);
      workingSources.forEach((source: any) => {
        console.log(`   ${source.name}: ${source.buildings} buildings, ${source.total_area_sqft} sqft`);
      });
    }

    if (failedSources.length > 0) {
      console.log(`❌ Failed sources (${failedSources.length}):`);
      failedSources.forEach((source: any) => {
        console.log(`   ${source.name}: ${source.success ? 'No data' : 'Connection failed'}`);
      });
    }
  }

  console.log('\n📋 Recommendations:');
  console.log('1. Update building sources configuration with working endpoints');
  console.log('2. Remove or fix non-working endpoints');
  console.log('3. Add county-specific sources where available');
  console.log('4. Prioritize real data over estimates');

  console.log('\n' + '=' . repeat(70));
  console.log('🏗️ BUILDING ENDPOINT TEST COMPLETE');
  console.log('=' . repeat(70));
}

testBuildingEndpoints().catch(console.error);