#!/usr/bin/env tsx
/**
 * Integrated Building Detector with Parcel Boundaries
 * Achieves 95% confidence by matching buildings within exact parcel boundaries
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { fetchParcelBoundary } from './services/parcel_fetcher';

interface BuildingFootprint {
  id: string;
  area_sqft: number;
  source: string;
  confidence: number;
  within_parcel: boolean;
  overlap_percent: number;
  geometry?: any;
}

interface DetectionResult {
  address: string;
  parcel: {
    apn: string;
    county: string;
    area_sqft: number;
    has_boundary: boolean;
  };
  buildings: {
    detected: BuildingFootprint[];
    total_area: number;
    lot_coverage: number;
    primary_building?: BuildingFootprint;
  };
  confidence: {
    level: 'CERTAIN' | 'HIGH' | 'MODERATE' | 'LOW' | 'ESTIMATE';
    percent: number;
    factors: string[];
  };
  estimates: {
    used: boolean;
    reason?: string;
    estimated_area?: number;
  };
}

/**
 * Fetch buildings from Microsoft Building Footprints
 */
async function fetchMicrosoftBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;

  const params = new URLSearchParams({
    f: 'json',
    where: "STATE='CA'",
    geometry: `${minX},${minY},${maxX},${maxY}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    maxRecordCount: '100',
  });

  const url = `https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0/query?${params}`;

  try {
    console.log(`   🔍 Checking Microsoft Building Footprints...`);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = (await response.json()) as any;
    const buildings: BuildingFootprint[] = [];

    for (const feature of data.features || []) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `MSFT_${feature.attributes?.OBJECTID || Math.random()}`,
          area_sqft: area,
          source: 'Microsoft',
          confidence: 0,
          within_parcel: false,
          overlap_percent: 0,
          geometry: feature.geometry,
        });
      }
    }

    console.log(`      Found ${buildings.length} buildings`);
    return buildings;
  } catch (error) {
    console.log(`      Error: ${error}`);
    return [];
  }
}

/**
 * Fetch buildings from OpenStreetMap
 */
async function fetchOSMBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;

  const query = `[out:json][timeout:15];
    way["building"](${minY},${minX},${maxY},${maxX});
    out geom;`;

  try {
    console.log(`   🔍 Checking OpenStreetMap...`);
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(15000),
    });

    const data = (await response.json()) as any;
    const buildings: BuildingFootprint[] = [];

    for (const element of data.elements || []) {
      if (element.type === 'way' && element.geometry) {
        const coords = element.geometry.map((node: any) => [node.lon, node.lat]);
        coords.push(coords[0]); // Close polygon

        const polygon = turf.polygon([coords]);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `OSM_${element.id}`,
          area_sqft: area,
          source: 'OSM',
          confidence: 0,
          within_parcel: false,
          overlap_percent: 0,
          geometry: { rings: [coords] },
        });
      }
    }

    console.log(`      Found ${buildings.length} buildings`);
    return buildings;
  } catch (error) {
    console.log(`      Error: ${error}`);
    return [];
  }
}

/**
 * Match buildings to parcel using spatial containment
 * THIS IS THE KEY TO HIGH CONFIDENCE
 */
function matchBuildingsToParcel(
  buildings: BuildingFootprint[],
  parcelGeometry: any,
): BuildingFootprint[] {
  const parcelPolygon = turf.polygon(parcelGeometry.rings);
  const matched: BuildingFootprint[] = [];

  console.log(`\n   🎯 Matching ${buildings.length} buildings to parcel boundary...`);

  for (const building of buildings) {
    if (!building.geometry) continue;

    try {
      const buildingPolygon = turf.polygon(building.geometry.rings);

      // Check if building is completely within parcel
      const isWithin = turf.booleanWithin(buildingPolygon, parcelPolygon);

      // Calculate intersection
      const intersection = turf.intersect(buildingPolygon, parcelPolygon);
      let overlapPercent = 0;

      if (intersection) {
        const intersectionArea = turf.area(intersection) * 10.7639;
        overlapPercent = Math.round((intersectionArea / building.area_sqft) * 100);
      }

      // Set confidence based on containment
      let confidence = 0;
      if (isWithin) {
        confidence = 95; // Completely within parcel
        building.within_parcel = true;
      } else if (overlapPercent >= 80) {
        confidence = 85; // Mostly within parcel
        building.within_parcel = false;
      } else if (overlapPercent >= 50) {
        confidence = 70; // Partially within parcel
        building.within_parcel = false;
      } else if (overlapPercent >= 20) {
        confidence = 40; // Some overlap
        building.within_parcel = false;
      }

      if (confidence > 0) {
        matched.push({
          ...building,
          confidence,
          overlap_percent: overlapPercent,
        });
      }
    } catch (error) {
      // Geometry operation failed
      continue;
    }
  }

  // Sort by confidence and overlap
  matched.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.overlap_percent - a.overlap_percent;
  });

  console.log(`      Matched ${matched.length} buildings within/overlapping parcel`);

  return matched;
}

/**
 * Cross-validate buildings from multiple sources
 */
function crossValidateBuildings(buildings: BuildingFootprint[]): BuildingFootprint[] {
  if (buildings.length === 0) return [];

  const validated: BuildingFootprint[] = [];
  const used = new Set<string>();

  // Group buildings that are at the same location
  for (const building of buildings) {
    if (used.has(building.id)) continue;

    // Find buildings from other sources at same location
    const group = [building];
    used.add(building.id);

    for (const other of buildings) {
      if (used.has(other.id)) continue;
      if (building.source === other.source) continue;

      // Check if buildings overlap significantly
      if (building.geometry && other.geometry) {
        try {
          const b1 = turf.polygon(building.geometry.rings);
          const b2 = turf.polygon(other.geometry.rings);
          const intersection = turf.intersect(b1, b2);

          if (intersection) {
            const intersectionArea = turf.area(intersection) * 10.7639;
            const overlap1 = (intersectionArea / building.area_sqft) * 100;
            const overlap2 = (intersectionArea / other.area_sqft) * 100;

            if (overlap1 > 70 && overlap2 > 70) {
              // Buildings are at same location
              group.push(other);
              used.add(other.id);
            }
          }
        } catch (error) {
          continue;
        }
      }
    }

    // If multiple sources agree, increase confidence
    if (group.length > 1) {
      const avgArea = Math.round(group.reduce((sum, b) => sum + b.area_sqft, 0) / group.length);
      const maxConfidence = Math.max(...group.map((b) => b.confidence));

      validated.push({
        ...group[0],
        area_sqft: avgArea,
        confidence: Math.min(100, maxConfidence + (group.length - 1) * 5),
        source: group.map((b) => b.source).join(' + '),
      });
    } else {
      validated.push(building);
    }
  }

  return validated;
}

/**
 * Determine confidence level based on data quality
 */
function determineConfidence(
  hasParcel: boolean,
  buildings: BuildingFootprint[],
): { level: DetectionResult['confidence']['level']; percent: number; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  // Factor 1: Parcel boundary available (40 points)
  if (hasParcel) {
    score += 40;
    factors.push('✅ Exact parcel boundary available');
  } else {
    factors.push('❌ No parcel boundary - using estimates');
  }

  // Factor 2: Buildings found (30 points)
  if (buildings.length > 0) {
    const avgConfidence = buildings.reduce((sum, b) => sum + b.confidence, 0) / buildings.length;
    const buildingScore = (avgConfidence / 100) * 30;
    score += buildingScore;

    if (avgConfidence >= 90) {
      factors.push('✅ Buildings confirmed within parcel');
    } else if (avgConfidence >= 70) {
      factors.push('✅ Buildings matched with good confidence');
    } else {
      factors.push('⚠️ Buildings matched with moderate confidence');
    }
  } else {
    factors.push('❌ No building data available');
  }

  // Factor 3: Multiple sources (20 points)
  const sources = new Set(buildings.map((b) => b.source.split(' + ')[0]));
  if (sources.size >= 2) {
    score += 20;
    factors.push('✅ Multiple data sources confirm buildings');
  } else if (sources.size === 1) {
    score += 10;
    factors.push('⚠️ Single data source only');
  }

  // Factor 4: Complete containment (10 points)
  const fullyContained = buildings.filter((b) => b.within_parcel);
  if (fullyContained.length === buildings.length && buildings.length > 0) {
    score += 10;
    factors.push('✅ All buildings fully within parcel');
  }

  // Determine level
  let level: DetectionResult['confidence']['level'];
  if (score >= 90) level = 'CERTAIN';
  else if (score >= 75) level = 'HIGH';
  else if (score >= 50) level = 'MODERATE';
  else if (score >= 25) level = 'LOW';
  else level = 'ESTIMATE';

  return { level, percent: Math.round(score), factors };
}

/**
 * Main detection function
 */
async function detectBuildingsWithParcels(address: string): Promise<DetectionResult> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📍 ${address}`);
  console.log('='.repeat(70));

  const result: DetectionResult = {
    address,
    parcel: {
      apn: 'Unknown',
      county: 'Unknown',
      area_sqft: 0,
      has_boundary: false,
    },
    buildings: {
      detected: [],
      total_area: 0,
      lot_coverage: 0,
    },
    confidence: {
      level: 'ESTIMATE',
      percent: 0,
      factors: [],
    },
    estimates: {
      used: false,
    },
  };

  // Step 1: Fetch parcel boundary
  console.log('\n📦 FETCHING PARCEL BOUNDARY');
  const parcel = await fetchParcelBoundary(address, {
    useCache: true,
    timeout: 20000,
    retries: 2,
  });

  if (parcel && parcel.geometry) {
    result.parcel = {
      apn: parcel.apn,
      county: parcel.county,
      area_sqft: parcel.area_sqft,
      has_boundary: true,
    };
    console.log(`   ✅ Parcel: ${parcel.apn} (${parcel.area_sqft.toLocaleString()} sqft)`);
  } else {
    console.log(`   ❌ Could not fetch parcel boundary`);
    result.estimates.used = true;
    result.estimates.reason = 'No parcel boundary available';

    // Return early if no parcel
    result.confidence = determineConfidence(false, []);
    return result;
  }

  // Step 2: Fetch buildings from multiple sources
  console.log('\n🏢 FETCHING BUILDING DATA');

  // Create search bbox from parcel
  const parcelPolygon = turf.polygon(parcel.geometry.rings);
  const buffered = turf.buffer(parcelPolygon, 50, { units: 'feet' });
  const bbox = turf.bbox(buffered!);

  const [msftBuildings, osmBuildings] = await Promise.all([
    fetchMicrosoftBuildings(bbox),
    fetchOSMBuildings(bbox),
  ]);

  const allBuildings = [...msftBuildings, ...osmBuildings];
  console.log(`   📊 Total buildings found in area: ${allBuildings.length}`);

  // Step 3: Match buildings to parcel
  const matchedBuildings = matchBuildingsToParcel(allBuildings, parcel.geometry);

  // Step 4: Cross-validate buildings
  const validatedBuildings = crossValidateBuildings(matchedBuildings);

  // Step 5: Calculate results
  if (validatedBuildings.length > 0) {
    result.buildings.detected = validatedBuildings;
    result.buildings.total_area = validatedBuildings.reduce((sum, b) => sum + b.area_sqft, 0);
    result.buildings.lot_coverage = Math.round(
      (result.buildings.total_area / parcel.area_sqft) * 100,
    );
    result.buildings.primary_building = validatedBuildings[0];
  } else {
    // Use estimate
    result.estimates.used = true;
    result.estimates.reason = 'No buildings matched to parcel';
    result.estimates.estimated_area = Math.round(parcel.area_sqft * 0.22); // 22% coverage estimate
  }

  // Step 6: Determine confidence
  result.confidence = determineConfidence(true, validatedBuildings);

  return result;
}

/**
 * Display results
 */
function displayResults(result: DetectionResult) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 RESULTS');
  console.log('='.repeat(70));

  // Parcel info
  console.log('\n📦 PARCEL:');
  console.log(`   APN: ${result.parcel.apn}`);
  console.log(`   County: ${result.parcel.county}`);
  console.log(`   Lot Size: ${result.parcel.area_sqft.toLocaleString()} sqft`);
  console.log(`   Has Boundary: ${result.parcel.has_boundary ? 'Yes ✅' : 'No ❌'}`);

  // Building info
  console.log('\n🏢 BUILDINGS:');
  if (result.buildings.detected.length > 0) {
    console.log(`   Found: ${result.buildings.detected.length} buildings`);
    console.log(`   Total Area: ${result.buildings.total_area.toLocaleString()} sqft`);
    console.log(`   Lot Coverage: ${result.buildings.lot_coverage}%`);

    console.log('\n   Details:');
    for (const building of result.buildings.detected) {
      const containment = building.within_parcel
        ? 'Fully within parcel ✅'
        : `${building.overlap_percent}% overlap`;
      console.log(`   • ${building.area_sqft.toLocaleString()} sqft - ${containment}`);
      console.log(`     Source: ${building.source} | Confidence: ${building.confidence}%`);
    }
  } else if (result.estimates.used) {
    console.log(`   ⚠️ Using estimate: ${result.estimates.estimated_area?.toLocaleString()} sqft`);
    console.log(`   Reason: ${result.estimates.reason}`);
  } else {
    console.log(`   ❌ No buildings found`);
  }

  // Confidence
  console.log('\n🎯 CONFIDENCE:');
  console.log(`   Level: ${result.confidence.level}`);
  console.log(`   Score: ${result.confidence.percent}%`);
  console.log('\n   Factors:');
  for (const factor of result.confidence.factors) {
    console.log(`   ${factor}`);
  }
}

/**
 * Test with all three addresses
 */
async function main() {
  console.log('🏠 INTEGRATED BUILDING DETECTION WITH PARCEL BOUNDARIES');
  console.log(`📅 ${new Date().toLocaleString()}`);

  const addresses = [
    '20616 Archwood St, Winnetka, CA 91306',
    '10921 Polaris Dr, San Diego, CA 92126',
    '1843 S Bedford St, Los Angeles, CA 90035',
  ];

  const results: DetectionResult[] = [];

  for (const address of addresses) {
    const result = await detectBuildingsWithParcels(address);
    displayResults(result);
    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📈 SUMMARY');
  console.log('='.repeat(70));

  for (const result of results) {
    const status =
      result.confidence.level === 'ESTIMATE'
        ? '❌'
        : result.confidence.level === 'LOW'
          ? '⚠️'
          : '✅';

    console.log(`\n${status} ${result.address}`);
    console.log(`   Confidence: ${result.confidence.level} (${result.confidence.percent}%)`);

    if (result.buildings.detected.length > 0) {
      console.log(
        `   Buildings: ${result.buildings.total_area.toLocaleString()} sqft (${result.buildings.lot_coverage}% coverage)`,
      );
    } else if (result.estimates.used) {
      console.log(`   Estimate: ${result.estimates.estimated_area?.toLocaleString()} sqft`);
    }
  }
}

// Run if called directly
main().catch(console.error);
