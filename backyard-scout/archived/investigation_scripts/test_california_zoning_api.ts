/**
 * Test California Statewide Zoning API (FREE!)
 * Found at: https://data.ca.gov/dataset/california-statewide-zoning-north
 */

import { fetch } from 'undici';

const CA_ZONING_API = 'https://services8.arcgis.com/Xr1lDrwMv89PhjD9/arcgis/rest/services/California_Statewide_Zoning_North/FeatureServer/1';

async function testCaliforniaZoningAPI() {
  console.log('🌟 Testing California Statewide Zoning API (FREE!)');
  console.log('=' . repeat(60));

  // Test property: 1618 Burning Tree Dr, Thousand Oaks
  const propertyCoords = {
    lat: 34.212931,
    lon: -118.848476,
    address: '1618 Burning Tree Dr, Thousand Oaks, CA 91362'
  };

  console.log(`\n📍 Testing Property: ${propertyCoords.address}`);
  console.log(`   Coordinates: ${propertyCoords.lat}, ${propertyCoords.lon}`);

  // Test 1: Service Info
  console.log('\n1️⃣ Getting Service Information:');
  try {
    const response = await fetch(`${CA_ZONING_API}?f=json`);
    if (response.ok) {
      const info = await response.json() as any;
      console.log(`   ✅ Service Active`);
      console.log(`   Name: ${info.name || 'N/A'}`);
      console.log(`   Description: ${info.description || 'N/A'}`);
      console.log(`   Max Record Count: ${info.maxRecordCount || 'N/A'}`);

      if (info.fields) {
        console.log(`   Available Fields: ${info.fields.map((f: any) => f.name).slice(0, 10).join(', ')}`);
      }
    } else {
      console.log(`   ❌ Service Error: ${response.status}`);
    }
  } catch (error) {
    console.log(`   ❌ Connection Error: ${error}`);
  }

  // Test 2: Point Query for our property
  console.log('\n2️⃣ Querying Zoning for Property Location:');
  try {
    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      geometry: `${propertyCoords.lon},${propertyCoords.lat}`,
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'false'
    });

    const response = await fetch(`${CA_ZONING_API}/query?${params}`);

    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      const data = await response.json() as any;
      const features = data.features || [];

      console.log(`   ✅ Found ${features.length} zoning record(s)`);

      if (features.length > 0) {
        const zoning = features[0].attributes;
        console.log('\n   📋 Zoning Information:');

        // Common zoning fields to check
        const commonFields = [
          'ZONE_CLASS', 'ZONING', 'ZONE_CODE', 'ZONE_NAME',
          'DISTRICT', 'DESIGNATION', 'GENERAL_PLAN', 'JURISDICTION'
        ];

        for (const field of commonFields) {
          if (zoning[field] !== null && zoning[field] !== undefined) {
            console.log(`      ${field}: ${zoning[field]}`);
          }
        }

        // Show all available fields
        console.log('\n   🔍 All Available Fields:');
        Object.keys(zoning).slice(0, 20).forEach(key => {
          if (zoning[key] !== null && zoning[key] !== '') {
            console.log(`      ${key}: ${zoning[key]}`);
          }
        });
      } else {
        console.log('   ⚠️ No zoning records found at this location');
      }
    } else {
      console.log(`   ❌ Query Error: ${response.status}`);
      const text = await response.text();
      console.log(`   Response: ${text.substring(0, 200)}`);
    }
  } catch (error) {
    console.log(`   ❌ Query Error: ${error}`);
  }

  // Test 3: Area search (Thousand Oaks general)
  console.log('\n3️⃣ Searching for Thousand Oaks Zoning Records:');
  try {
    const params = new URLSearchParams({
      f: 'json',
      where: "JURISDICTION LIKE '%THOUSAND OAKS%' OR CITY LIKE '%THOUSAND OAKS%'",
      outFields: '*',
      returnGeometry: 'false',
      resultRecordCount: '5'
    });

    const response = await fetch(`${CA_ZONING_API}/query?${params}`);

    if (response.ok) {
      const data = await response.json() as any;
      const features = data.features || [];

      console.log(`   ✅ Found ${features.length} Thousand Oaks records`);

      if (features.length > 0) {
        console.log('\n   Sample Thousand Oaks Zoning Records:');
        features.slice(0, 3).forEach((feature: any, i: number) => {
          const attrs = feature.attributes;
          console.log(`      ${i + 1}. Zone: ${attrs.ZONE_CLASS || attrs.ZONING || 'N/A'}`);
          console.log(`         Jurisdiction: ${attrs.JURISDICTION || 'N/A'}`);
        });
      }
    } else {
      console.log(`   Status: ${response.status}`);
    }
  } catch (error) {
    console.log(`   Error: ${error}`);
  }

  console.log('\n' + '=' . repeat(60));
  console.log('🎯 CALIFORNIA STATEWIDE ZONING API TEST COMPLETE');
  console.log('=' . repeat(60));
  console.log('✅ Covers 535 of 539 California jurisdictions');
  console.log('✅ FREE to use (no API key required)');
  console.log('✅ Updated 2021-2023 data');
  console.log('⚠️ Should not be used for legal determinations');
}

testCaliforniaZoningAPI().catch(console.error);