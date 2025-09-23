#!/usr/bin/env tsx
/**
 * SB 9 and Multi-Unit Development Analysis
 * Comprehensive analysis for subdivision and development potential
 */

import { analyzeRequestedProperties } from './analyze_requested_properties.js';

interface SB9Analysis {
  address: string;
  apn: string;
  lotSize: number;
  zone: string;
  sb9Eligible: boolean;
  sb9Reasons: string[];
  possibleUnits: {
    withoutSB9: number;
    withSB9: number;
  };
  financials: {
    scenario: string;
    units: number;
    cost: number;
    monthlyRent: number;
    annualNOI: number;
    capRate: number;
  }[];
}

// Zone requirements for SB 9 and density
const ZONE_CONFIG = {
  'RS-1-RIO': {
    minLotSize: 5000,
    sb9Eligible: true,
    baseUnits: 1,
    description: 'Single Family Residential with River Improvement Overlay'
  },
  'RS-1': {
    minLotSize: 5000,
    sb9Eligible: true,
    baseUnits: 1,
    description: 'Single Family Residential'
  },
  'EMX-1': {
    minLotSize: 2500,
    sb9Eligible: false, // Mixed use not eligible for SB 9
    baseUnits: 4,
    description: 'Employment Mixed Use - allows multi-unit'
  },
  'PD': {
    minLotSize: 5000,
    sb9Eligible: false, // Planned Development varies
    baseUnits: 2,
    description: 'Planned Development - check specific plan'
  },
  'RD2': {
    minLotSize: 2500,
    sb9Eligible: false, // Already multi-family
    baseUnits: 2,
    description: 'Restricted Density Multiple Dwelling'
  }
};

function analyzeSB9Potential(property: any): SB9Analysis {
  const lotSize = property.lotSize || property.lot_area_sqft || 0;
  const zone = property.zone || 'Unknown';
  const buildableArea = property.buildableArea || property.buildable_area || 0;
  const zoneConfig = ZONE_CONFIG[zone] || {
    minLotSize: 5000,
    sb9Eligible: false,
    baseUnits: 1,
    description: 'Unknown zone'
  };

  const sb9Reasons: string[] = [];
  let sb9Eligible = false;

  // Check SB 9 eligibility
  if (zoneConfig.sb9Eligible) {
    if (lotSize >= 2400) { // Minimum lot size for SB 9
      if (lotSize >= zoneConfig.minLotSize * 2) {
        sb9Eligible = true;
        sb9Reasons.push('✅ Single-family zone eligible for SB 9');
        sb9Reasons.push(`✅ Lot size (${lotSize.toLocaleString()} sqft) allows splitting`);
      } else {
        sb9Reasons.push(`❌ Lot size insufficient for 2 conforming lots (need ${(zoneConfig.minLotSize * 2).toLocaleString()} sqft)`);
      }
    } else {
      sb9Reasons.push('❌ Lot too small (minimum 2,400 sqft for SB 9)');
    }
  } else {
    sb9Reasons.push(`❌ Zone ${zone} not eligible for SB 9 (single-family zones only)`);
    if (zoneConfig.baseUnits > 1) {
      sb9Reasons.push(`✅ Zone allows ${zoneConfig.baseUnits} units by-right (no subdivision needed)`);
    }
  }

  // Calculate possible units
  const possibleUnits = {
    withoutSB9: zoneConfig.baseUnits + 1, // Base units + 1 ADU
    withSB9: sb9Eligible ? 4 : zoneConfig.baseUnits + 1 // 2 primary + 2 ADUs if SB 9
  };

  // Financial scenarios
  const financials = [];

  // Scenario 1: ADU only
  if (buildableArea >= 770) {
    const aduSize = Math.min(1200, buildableArea);
    financials.push({
      scenario: 'ADU Only',
      units: 1,
      cost: aduSize * 195,
      monthlyRent: aduSize * 3,
      annualNOI: (aduSize * 3 * 12) * 0.665,
      capRate: ((aduSize * 3 * 12) * 0.665) / (aduSize * 195)
    });
  }

  // Scenario 2: Multi-unit (if allowed by zoning)
  if (zoneConfig.baseUnits > 1) {
    const totalUnits = possibleUnits.withoutSB9;
    const avgSize = 900;
    const totalSqft = totalUnits * avgSize;
    const cost = totalSqft * 225;

    financials.push({
      scenario: `Multi-Unit Development (${totalUnits} units)`,
      units: totalUnits,
      cost: cost,
      monthlyRent: totalSqft * 3,
      annualNOI: (totalSqft * 3 * 12) * 0.665,
      capRate: ((totalSqft * 3 * 12) * 0.665) / cost
    });
  }

  // Scenario 3: SB 9 Subdivision
  if (sb9Eligible) {
    const totalUnits = 4;
    const avgSize = 800;
    const totalSqft = totalUnits * avgSize;
    const cost = totalSqft * 250; // Higher cost for subdivision

    financials.push({
      scenario: 'SB 9 Subdivision (4 units total)',
      units: totalUnits,
      cost: cost,
      monthlyRent: totalSqft * 3,
      annualNOI: (totalSqft * 3 * 12) * 0.665,
      capRate: ((totalSqft * 3 * 12) * 0.665) / cost
    });
  }

  return {
    address: property.address,
    apn: property.apn,
    lotSize: lotSize,
    zone: zone,
    sb9Eligible,
    sb9Reasons,
    possibleUnits,
    financials
  };
}

async function main() {
  const addresses = [
    "20616 Archwood St, Winnetka, CA 91306",
    "10921 Polaris Dr, San Diego, CA 92126",
    "1843 S Bedford St, Los Angeles, CA 90035"
  ];

  console.log('🏗️ SB 9 AND MULTI-UNIT DEVELOPMENT ANALYSIS');
  console.log('📅 ' + new Date().toLocaleString());
  console.log('='.repeat(80));

  // First get basic property data using existing tool
  console.log('\n📊 Fetching property data...\n');

  // Read the recent analysis results
  const fs = await import('fs/promises');
  const recentFile = '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out/three_property_analysis_1758577717353.json';

  try {
    const analysisData = JSON.parse(await fs.readFile(recentFile, 'utf-8'));

    if (Array.isArray(analysisData) && analysisData.length > 0) {
      const sb9Results = [];

      for (const property of analysisData) {
        const sb9Analysis = analyzeSB9Potential(property);
        sb9Results.push(sb9Analysis);

        console.log(`\n${'='.repeat(80)}`);
        console.log(`📍 ${sb9Analysis.address}`);
        console.log(`${'='.repeat(80)}`);
        console.log(`📐 Lot Size: ${sb9Analysis.lotSize.toLocaleString()} sqft`);
        console.log(`🏘️ Zone: ${sb9Analysis.zone}`);

        const zoneInfo = ZONE_CONFIG[sb9Analysis.zone];
        if (zoneInfo) {
          console.log(`   ${zoneInfo.description}`);
        }

        console.log(`\n📋 SB 9 ELIGIBILITY: ${sb9Analysis.sb9Eligible ? '✅ YES' : '❌ NO'}`);
        for (const reason of sb9Analysis.sb9Reasons) {
          console.log(`   ${reason}`);
        }

        console.log(`\n🏗️ DEVELOPMENT POTENTIAL:`);
        console.log(`   Without SB 9: ${sb9Analysis.possibleUnits.withoutSB9} units`);
        console.log(`   With SB 9: ${sb9Analysis.possibleUnits.withSB9} units`);

        if (sb9Analysis.financials.length > 0) {
          console.log(`\n💰 FINANCIAL SCENARIOS:`);
          for (const scenario of sb9Analysis.financials) {
            console.log(`\n   ${scenario.scenario}:`);
            console.log(`   • Units: ${scenario.units}`);
            console.log(`   • Development Cost: $${scenario.cost.toLocaleString()}`);
            console.log(`   • Monthly Rent: $${scenario.monthlyRent.toLocaleString()}`);
            console.log(`   • Annual NOI: $${Math.round(scenario.annualNOI).toLocaleString()}`);
            console.log(`   • Cap Rate: ${(scenario.capRate * 100).toFixed(1)}%`);
          }
        }
      }

      // RANKING
      console.log(`\n\n${'='.repeat(80)}`);
      console.log('🏆 DEVELOPMENT RANKINGS');
      console.log(`${'='.repeat(80)}`);

      // Rank by SB 9 potential
      console.log('\n📋 BEST FOR SB 9 SUBDIVISION:');
      const sb9Eligible = sb9Results.filter(r => r.sb9Eligible);
      if (sb9Eligible.length > 0) {
        sb9Eligible.forEach((r, i) => {
          console.log(`   ${i + 1}. ${r.address.split(',')[0]}`);
          console.log(`      • ${r.lotSize.toLocaleString()} sqft lot in ${r.zone} zone`);
          console.log(`      • Can create 4 total units (2 primary + 2 ADUs)`);
          const sb9Scenario = r.financials.find(f => f.scenario.includes('SB 9'));
          if (sb9Scenario) {
            console.log(`      • ${(sb9Scenario.capRate * 100).toFixed(1)}% cap rate`);
          }
        });
      } else {
        console.log('   ❌ None qualify for SB 9 subdivision');
      }

      // Rank by multi-unit potential
      console.log('\n🏢 BEST FOR MULTI-UNIT DEVELOPMENT:');
      const multiUnit = sb9Results.filter(r => r.possibleUnits.withoutSB9 > 2)
        .sort((a, b) => b.possibleUnits.withoutSB9 - a.possibleUnits.withoutSB9);

      if (multiUnit.length > 0) {
        multiUnit.forEach((r, i) => {
          console.log(`   ${i + 1}. ${r.address.split(',')[0]}`);
          console.log(`      • Zone ${r.zone} allows ${r.possibleUnits.withoutSB9} units by-right`);
          const multiScenario = r.financials.find(f => f.scenario.includes('Multi-Unit'));
          if (multiScenario) {
            console.log(`      • ${(multiScenario.capRate * 100).toFixed(1)}% cap rate`);
          }
        });
      } else {
        console.log('   All properties are single-family only (without SB 9)');
      }

      // Overall best development value
      console.log('\n💰 BEST OVERALL DEVELOPMENT VALUE:');
      const byBestCapRate = sb9Results
        .map(r => ({
          ...r,
          bestCapRate: Math.max(...r.financials.map(f => f.capRate)),
          bestScenario: r.financials.find(f =>
            f.capRate === Math.max(...r.financials.map(s => s.capRate))
          )
        }))
        .filter(r => r.bestCapRate > 0)
        .sort((a, b) => b.bestCapRate - a.bestCapRate);

      byBestCapRate.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.address.split(',')[0]}`);
        console.log(`      • Best Strategy: ${r.bestScenario?.scenario}`);
        console.log(`      • Cap Rate: ${(r.bestCapRate * 100).toFixed(1)}%`);
        console.log(`      • Investment: $${r.bestScenario?.cost.toLocaleString()}`);
      });

      // Save comprehensive results
      const outputFile = `/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out/sb9_analysis_${Date.now()}.json`;
      await fs.writeFile(outputFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        properties: sb9Results
      }, null, 2));

      console.log(`\n💾 Detailed analysis saved to: ${outputFile}`);

    } else {
      console.error('No property data found in analysis file');
    }
  } catch (error) {
    console.error('Error reading analysis data:', error);
  }
}

main().catch(console.error);