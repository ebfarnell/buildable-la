import { fetch } from 'undici';
import fs from 'node:fs';

const CA_PARCELS_URL =
  'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

// Test major counties
const TEST_COUNTIES = [
  { name: 'ORANGE', city: 'IRVINE' },
  { name: 'SAN DIEGO', city: 'SAN DIEGO' },
  { name: 'SAN FRANCISCO', city: 'SAN FRANCISCO' },
  { name: 'SANTA CLARA', city: 'SAN JOSE' },
  { name: 'SACRAMENTO', city: 'SACRAMENTO' },
  { name: 'RIVERSIDE', city: 'RIVERSIDE' },
  { name: 'SAN BERNARDINO', city: 'SAN BERNARDINO' },
  { name: 'ALAMEDA', city: 'OAKLAND' },
  { name: 'CONTRA COSTA', city: 'WALNUT CREEK' },
  { name: 'SANTA BARBARA', city: 'SANTA BARBARA' },
];

async function testCounty(countyName: string, cityName: string) {
  const params = new URLSearchParams({
    f: 'json',
    where: `COUNTYNAME='${countyName}' AND SITE_CITY='${cityName}'`,
    returnCountOnly: 'true',
  });

  try {
    const res = await fetch(`${CA_PARCELS_URL}/query?${params}`, {
      // @ts-ignore
      timeout: 5000,
    });
    const data = (await res.json()) as any;
    return {
      county: countyName,
      city: cityName,
      count: data.count || 0,
      error: data.error?.message,
    };
  } catch (e: any) {
    return { county: countyName, city: cityName, count: 0, error: e.message };
  }
}

async function main() {
  console.log('🔍 Testing California Counties in Statewide Parcels Service\n');
  console.log('='.repeat(60));

  const results = [];

  for (const test of TEST_COUNTIES) {
    process.stdout.write(`Testing ${test.name.padEnd(15)} (${test.city})... `);
    const result = await testCounty(test.name, test.city);

    if (result.error) {
      console.log(`❌ Error: ${result.error}`);
    } else if (result.count > 0) {
      console.log(`✅ ${result.count.toLocaleString()} parcels`);
    } else {
      console.log(`⚠️  No parcels found`);
    }

    results.push(result);
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Summary:');

  const working = results.filter((r) => r.count > 0);
  const failed = results.filter((r) => r.error || r.count === 0);

  console.log(`  Working: ${working.length}/${results.length} counties`);
  console.log(
    `  Total parcels accessible: ${working.reduce((sum, r) => sum + r.count, 0).toLocaleString()}`,
  );

  if (working.length > 0) {
    console.log('\n✅ Successfully tested counties:');
    working.forEach((r) => {
      console.log(`  - ${r.county}: ${r.count.toLocaleString()} parcels in ${r.city}`);
    });
  }

  // Get all available cities for a sample county
  console.log('\n🏙️ Getting sample cities for ORANGE county...');

  const citiesParams = new URLSearchParams({
    f: 'json',
    where: `COUNTYNAME='ORANGE'`,
    returnDistinctValues: 'true',
    outFields: 'SITE_CITY',
    returnGeometry: 'false',
    resultRecordCount: '20',
  });

  const citiesRes = await fetch(`${CA_PARCELS_URL}/query?${citiesParams}`);
  const citiesData = (await citiesRes.json()) as any;

  if (citiesData.features) {
    const cities = citiesData.features
      .map((f: any) => f.attributes.SITE_CITY)
      .filter(Boolean)
      .sort();

    console.log(
      `  Found ${cities.length} cities: ${cities.slice(0, 10).join(', ')}${cities.length > 10 ? '...' : ''}`,
    );
  }

  // Save results
  const config = {
    service: {
      name: 'CA_Statewide_Parcels_Public_view',
      url: CA_PARCELS_URL,
      provider: 'California State',
      coverage: 'All 58 California Counties',
      fields: {
        county: 'COUNTYNAME',
        city: 'SITE_CITY',
        apn: 'PARCEL_APN',
        address: 'SITE_ADDR',
        zip: 'SITE_ZIP',
      },
    },
    counties: results,
    tested_at: new Date().toISOString(),
  };

  fs.writeFileSync('out/california_counties_test.json', JSON.stringify(config, null, 2));
  console.log('\n📄 Results saved to out/california_counties_test.json');
}

main().catch(console.error);
