#!/usr/bin/env tsx
/**
 * Verify zoning for 1843 S Bedford St, Los Angeles, CA 90035
 * The user indicated this property should NOT be PD zoned
 */

import { getEnhancedZoning } from './services/zoning_enhanced.js';
import { getZoneomicsZoning } from './services/zoneomics_tiles_service.js';

async function verifyBedfordZoning() {
  const address = '1843 S Bedford St, Los Angeles, CA 90035';
  const lat = 34.044389;
  const lon = -118.382915;

  console.log('🔍 VERIFYING ZONING FOR BEDFORD PROPERTY');
  console.log('📍 Address:', address);
  console.log('📐 Coordinates:', lat, lon);
  console.log('='.repeat(60));

  // Check Zoneomics directly
  console.log('\n1. Checking Zoneomics Tiles Service...');
  try {
    const zoneomicsResult = await getZoneomicsZoning(lat, lon);
    console.log('   Zoneomics Result:', JSON.stringify(zoneomicsResult, null, 2));
  } catch (error) {
    console.log('   Error:', error.message);
  }

  // Check enhanced zoning (which uses Zoneomics)
  console.log('\n2. Checking Enhanced Zoning Service...');
  try {
    const enhancedResult = await getEnhancedZoning(lat, lon);
    console.log('   Enhanced Result:', JSON.stringify(enhancedResult, null, 2));
  } catch (error) {
    console.log('   Error:', error.message);
  }

  // The actual zone for this area of Pico-Robertson should likely be:
  console.log('\n3. Expected Zoning for this Area:');
  console.log('   This is in the Pico-Robertson neighborhood of Los Angeles');
  console.log('   Typical zones in this area include:');
  console.log('   • R1 - Single Family');
  console.log('   • R2 - Two Family');
  console.log('   • RD1.5 - Restricted Density Multiple Dwelling');
  console.log('   • RD2 - Restricted Density Multiple Dwelling');

  console.log('\n⚠️  IMPORTANT NOTE:');
  console.log('   If showing as PD (Planned Development), this may be:');
  console.log('   1. An error in the Zoneomics data');
  console.log('   2. A special overlay zone');
  console.log('   3. Part of a specific plan area');

  console.log('\n📊 ZONING IMPLICATIONS:');
  console.log('   • PD zones have variable requirements');
  console.log('   • Need to check specific plan documents');
  console.log('   • May have unique development standards');
  console.log('   • SB 9 typically does NOT apply to PD zones');

  // Additional analysis based on typical Pico-Robertson zoning
  console.log('\n🏗️ IF THIS IS ACTUALLY R2 or RD2:');
  console.log('   • Would allow 2+ units by-right');
  console.log('   • May NOT qualify for SB 9 (already multi-family)');
  console.log('   • Better for multi-unit development than subdivision');

  console.log('\n🏗️ IF THIS IS ACTUALLY R1:');
  console.log('   • Single-family zone');
  console.log('   • WOULD qualify for SB 9 subdivision');
  console.log('   • Could create 4 units total (2 primary + 2 ADUs)');
}

verifyBedfordZoning().catch(console.error);
