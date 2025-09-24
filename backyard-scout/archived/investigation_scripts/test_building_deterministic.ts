import {
  getBuildingFootprints,
  calculateBuildableArea,
  testDeterministicBehavior,
} from '../services/building_footprints_deterministic';

async function testBuildingFootprints() {
  console.log('🏗️ Testing Deterministic Building Footprints');
  console.log('='.repeat(60));

  // Test property: 1618 Burning Tree Dr, Thousand Oaks
  const parcelGeometry = {
    rings: [
      [
        [-118.848476496, 34.212931499],
        [-118.84861655, 34.212939557],
        [-118.848646563, 34.213116181],
        [-118.848169961, 34.2134264590001],
        [-118.848134579, 34.2133912200001],
        [-118.848096679, 34.213357821],
        [-118.848056399, 34.213326383],
        [-118.848476496, 34.212931499],
      ],
    ],
  };

  const apn = '570019111';
  const county = 'VENTURA';

  console.log('\n1. Fetching building footprints...');
  const buildings = await getBuildingFootprints(parcelGeometry, county, apn);

  console.log(`   Found ${buildings.length} building(s)`);
  for (const building of buildings) {
    console.log(
      `   - ${building.id}: ${building.area_sqft.toLocaleString()} sqft (${building.source})`,
    );
    console.log(`     Checksum: ${building.checksum}`);
  }

  console.log('\n2. Calculating buildable area with buildings...');
  const setbacks = { front: 25, side: 5, rear: 15 };
  const buildableArea = calculateBuildableArea(parcelGeometry, buildings, setbacks);

  console.log(`   Buildable area: ${buildableArea.toLocaleString()} sqft`);

  console.log('\n3. Running deterministic verification...');
  const isDeterministic = await testDeterministicBehavior(parcelGeometry, county, apn);

  if (isDeterministic) {
    console.log('   ✅ PASSED: Results are deterministic (same input = same output)');
  } else {
    console.log('   ❌ FAILED: Results vary between runs');
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`- Property: 1618 Burning Tree Dr`);
  console.log(`- Building data source: ${buildings[0]?.source || 'None'}`);
  console.log(
    `- Building footprint: ${buildings.reduce((sum, b) => sum + b.area_sqft, 0).toLocaleString()} sqft`,
  );
  console.log(`- Buildable area: ${buildableArea.toLocaleString()} sqft`);
  console.log(`- Deterministic: ${isDeterministic ? 'Yes' : 'No'}`);
}

testBuildingFootprints().catch(console.error);
