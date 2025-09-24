#!/usr/bin/env npx tsx
import Database from 'better-sqlite3';
import * as path from 'path';

// California Lutheran University location
const CLU_LAT = 34.2247; // 60 West Olsen Road
const CLU_LON = -118.8814; // Thousand Oaks, CA 91360

interface Property {
  apn: string;
  address: string;
  zip: string;
  buildable_sqft: number;
  lot_area_sqft: number;
  zone: string;
  lat: number;
  lon: number;
  distance_miles?: number;
  appeal_score?: number;
}

// Calculate distance between two points
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Score property for student/faculty appeal
function scorePropertyAppeal(property: Property): number {
  let score = 100;

  // Distance factor (closer is better)
  if (property.distance_miles! <= 1) {
    score += 30; // Walking/biking distance
  } else if (property.distance_miles! <= 2) {
    score += 20; // Short drive
  } else if (property.distance_miles! <= 3) {
    score += 10; // Reasonable commute
  } else if (property.distance_miles! <= 5) {
    score += 5; // Still convenient
  }

  // Buildable area factor (800-1200 sqft is ideal for ADU)
  if (property.buildable_sqft >= 1200) {
    score += 25; // Can build larger ADU
  } else if (property.buildable_sqft >= 1000) {
    score += 20; // Good size ADU
  } else if (property.buildable_sqft >= 800) {
    score += 15; // Adequate ADU
  }

  // Lot size factor (larger lots offer more privacy)
  if (property.lot_area_sqft >= 10000) {
    score += 15; // Large lot
  } else if (property.lot_area_sqft >= 8000) {
    score += 10; // Good size lot
  } else if (property.lot_area_sqft >= 6000) {
    score += 5; // Standard lot
  }

  return score;
}

async function analyzeProperties() {
  console.log('Analyzing properties near California Lutheran University...\n');

  // Connect to databases
  const westlakeDb = new Database(path.join(process.cwd(), 'westlake-agoura.db'), {
    readonly: true,
  });
  const backyardDb = new Database(path.join(process.cwd(), 'backyard-scout.db'), {
    readonly: true,
  });

  // Query properties with good buildable area
  const query = `
    SELECT apn, address, zip, buildable_sqft, lot_area_sqft, zone, lat, lon
    FROM results
    WHERE buildable_sqft >= 800 AND buildable_sqft < 10000
    ORDER BY buildable_sqft DESC
  `;

  const properties: Property[] = [];

  // Get properties from westlake-agoura database
  try {
    const westlakeResults = westlakeDb.prepare(query).all() as Property[];
    properties.push(...westlakeResults);
  } catch (_e) {
    console.log('No data from westlake-agoura.db');
  }

  // Get properties from backyard-scout database (if it has results table)
  try {
    const backyardResults = backyardDb.prepare(query).all() as Property[];
    properties.push(...backyardResults);
  } catch (_e) {
    console.log('No results table in backyard-scout.db\n');
  }

  // Calculate distance and score for each property
  properties.forEach((property) => {
    property.distance_miles = calculateDistance(CLU_LAT, CLU_LON, property.lat, property.lon);
    property.appeal_score = scorePropertyAppeal(property);
  });

  // Filter properties within reasonable distance (10 miles)
  const nearbyProperties = properties.filter((p) => p.distance_miles! <= 10);

  // Sort by appeal score
  nearbyProperties.sort((a, b) => b.appeal_score! - a.appeal_score!);

  // Get top 10
  const top10 = nearbyProperties.slice(0, 10);

  // Display results
  console.log('====================================================================');
  console.log('TOP 10 PROPERTIES NEAR CAL LUTHERAN UNIVERSITY FOR ADU DEVELOPMENT');
  console.log('====================================================================\n');

  console.log('University Location: 60 West Olsen Road, Thousand Oaks, CA 91360');
  console.log(`Total properties analyzed: ${properties.length}`);
  console.log(`Properties within 10 miles: ${nearbyProperties.length}\n`);

  top10.forEach((property, index) => {
    console.log(`\n${index + 1}. ${property.address}`);
    console.log('   ' + '─'.repeat(60));
    console.log(`   📍 Distance from CLU: ${property.distance_miles!.toFixed(1)} miles`);
    console.log(`   🏗️  Buildable Area: ${property.buildable_sqft.toFixed(0)} sqft`);
    console.log(`   📐 Lot Size: ${property.lot_area_sqft.toFixed(0)} sqft`);
    console.log(`   🏘️  Zone: ${property.zone || 'N/A'}`);
    console.log(`   📮 ZIP: ${property.zip}`);
    console.log(`   ⭐ Appeal Score: ${property.appeal_score}/170`);

    // Add recommendations
    console.log('\n   💡 Recommendations:');
    if (property.distance_miles! <= 2) {
      console.log('      ✓ Excellent location - walking/biking distance to campus');
    } else if (property.distance_miles! <= 5) {
      console.log('      ✓ Good location - short commute to campus');
    }

    if (property.buildable_sqft >= 1200) {
      console.log('      ✓ Can build a spacious 2-bedroom ADU (up to 1200 sqft)');
    } else if (property.buildable_sqft >= 1000) {
      console.log('      ✓ Can build a comfortable 1-2 bedroom ADU');
    } else if (property.buildable_sqft >= 800) {
      console.log('      ✓ Suitable for a cozy 1-bedroom ADU');
    }

    // Rental potential
    const monthlyRent =
      property.distance_miles! <= 2
        ? '$2,800-3,200'
        : property.distance_miles! <= 5
          ? '$2,500-2,900'
          : '$2,200-2,600';
    console.log(`      ✓ Estimated rental income: ${monthlyRent}/month`);
  });

  console.log('\n====================================================================');
  console.log('ANALYSIS SUMMARY');
  console.log('====================================================================\n');

  // Zone distribution
  const zoneCount: Record<string, number> = {};
  nearbyProperties.forEach((p) => {
    const zone = p.zone || 'Unknown';
    zoneCount[zone] = (zoneCount[zone] || 0) + 1;
  });

  console.log('Zone Distribution:');
  Object.entries(zoneCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([zone, count]) => {
      console.log(`  • ${zone}: ${count} properties`);
    });

  // Distance distribution
  const dist0to2 = nearbyProperties.filter((p) => p.distance_miles! <= 2).length;
  const dist2to5 = nearbyProperties.filter(
    (p) => p.distance_miles! > 2 && p.distance_miles! <= 5,
  ).length;
  const dist5to10 = nearbyProperties.filter(
    (p) => p.distance_miles! > 5 && p.distance_miles! <= 10,
  ).length;

  console.log('\nDistance Distribution:');
  console.log(`  • 0-2 miles: ${dist0to2} properties (walking/biking distance)`);
  console.log(`  • 2-5 miles: ${dist2to5} properties (short drive)`);
  console.log(`  • 5-10 miles: ${dist5to10} properties (reasonable commute)`);

  // Buildable area distribution
  const build800to1000 = nearbyProperties.filter(
    (p) => p.buildable_sqft >= 800 && p.buildable_sqft < 1000,
  ).length;
  const build1000to1500 = nearbyProperties.filter(
    (p) => p.buildable_sqft >= 1000 && p.buildable_sqft < 1500,
  ).length;
  const build1500plus = nearbyProperties.filter((p) => p.buildable_sqft >= 1500).length;

  console.log('\nBuildable Area Distribution:');
  console.log(`  • 800-1000 sqft: ${build800to1000} properties (1-bedroom ADU)`);
  console.log(`  • 1000-1500 sqft: ${build1000to1500} properties (1-2 bedroom ADU)`);
  console.log(`  • 1500+ sqft: ${build1500plus} properties (2+ bedroom ADU)`);

  console.log('\n====================================================================');
  console.log('INVESTMENT RECOMMENDATIONS');
  console.log('====================================================================\n');

  console.log('🎯 Target Market:');
  console.log('  • CLU students (undergraduate and graduate)');
  console.log('  • Faculty and staff');
  console.log('  • Young professionals working in Thousand Oaks\n');

  console.log('💰 Financial Analysis:');
  console.log('  • ADU construction cost: $150-200 per sqft');
  console.log('  • Expected rental income: $2,500-3,200/month');
  console.log('  • ROI timeline: 7-10 years\n');

  console.log('📋 Next Steps:');
  console.log('  1. Verify zoning compliance and ADU regulations');
  console.log('  2. Conduct site visits to top properties');
  console.log('  3. Review neighborhood characteristics');
  console.log('  4. Consult with local ADU builders for quotes');
  console.log('  5. Analyze rental market comparables\n');

  // Close databases
  westlakeDb.close();
  backyardDb.close();

  return top10;
}

// Run analysis
analyzeProperties().catch(console.error);

export { analyzeProperties };
