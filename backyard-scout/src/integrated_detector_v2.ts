#!/usr/bin/env tsx
/**
 * Integrated Building Detector V2 - More Lenient Matching
 * Uses parcel boundaries but with distance-based fallback
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { fetchParcelBoundary } from './services/parcel_fetcher';

interface BuildingFootprint {
  id: string;
  area_sqft: number;
  source: string;
  confidence: number;
  match_type: 'within' | 'overlapping' | 'nearby' | 'unmatched';
  overlap_percent: number;
  distance_ft?: number;
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
    all_in_area: number;
    matched: BuildingFootprint[];
    total_area: number;
    lot_coverage: number;
  };
  confidence: {
    level: string;
    percent: number;
    method: string;
  };
}

/**
 * Fetch buildings from both sources
 */
async function fetchAllBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const buildings: BuildingFootprint[] = [];

  // Microsoft Buildings
  try {
    console.log(`   🔍 Checking Microsoft Building Footprints...`);
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
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = (await response.json()) as any;

    for (const feature of data.features || []) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `MSFT_${feature.attributes?.OBJECTID}`,
          area_sqft: area,
          source: 'Microsoft',
          confidence: 0,
          match_type: 'unmatched',
          overlap_percent: 0,
          geometry: feature.geometry,
        });
      }
    }
    console.log(`      Found ${data.features?.length || 0} Microsoft buildings`);
  } catch (error) {
    console.log(`      Microsoft error: ${error}`);
  }

  // OpenStreetMap
  try {
    console.log(`   🔍 Checking OpenStreetMap...`);
    const [minX, minY, maxX, maxY] = bbox;

    const query = `[out:json][timeout:15];
      way["building"](${minY},${minX},${maxY},${maxX});
      out geom;`;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(15000),
    });

    const data = (await response.json()) as any;
    let osmCount = 0;

    for (const element of data.elements || []) {
      if (element.type === 'way' && element.geometry) {
        const coords = element.geometry.map((node: any) => [node.lon, node.lat]);
        coords.push(coords[0]);

        const polygon = turf.polygon([coords]);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `OSM_${element.id}`,
          area_sqft: area,
          source: 'OSM',
          confidence: 0,
          match_type: 'unmatched',
          overlap_percent: 0,
          geometry: { rings: [coords] },
        });
        osmCount++;
      }
    }
    console.log(`      Found ${osmCount} OSM buildings`);
  } catch (error) {
    console.log(`      OSM error: ${error}`);
  }

  return buildings;
}

/**
 * Match buildings to parcel with multiple strategies
 */
function matchBuildingsToParcel(
  buildings: BuildingFootprint[],
  parcelGeometry: any,
): BuildingFootprint[] {
  if (buildings.length === 0) return [];

  const parcelPolygon = turf.polygon(parcelGeometry.rings);
  const parcelCentroid = turf.centroid(parcelPolygon);
  const matched: BuildingFootprint[] = [];

  console.log(`\n   🎯 Matching ${buildings.length} buildings to parcel...`);

  // Debug: Show parcel bounds
  const parcelBbox = turf.bbox(parcelPolygon);
  console.log(`      Parcel bounds: [${parcelBbox.map((n) => n.toFixed(6)).join(', ')}]`);

  for (const building of buildings) {
    if (!building.geometry) continue;

    try {
      const buildingPolygon = turf.polygon(building.geometry.rings);
      const buildingCentroid = turf.centroid(buildingPolygon);

      // Calculate distance from building to parcel center
      const distance = turf.distance(buildingCentroid, parcelCentroid, { units: 'feet' });

      // Strategy 1: Check if building is within parcel
      let isWithin = false;
      try {
        isWithin = turf.booleanWithin(buildingPolygon, parcelPolygon);
      } catch (_e) {
        // Geometry operation failed
      }

      // Strategy 2: Check intersection
      let overlapPercent = 0;
      try {
        const intersection = turf.intersect(buildingPolygon, parcelPolygon);
        if (intersection) {
          const intersectionArea = turf.area(intersection) * 10.7639;
          overlapPercent = Math.round((intersectionArea / building.area_sqft) * 100);
        }
      } catch (_e) {
        // Intersection failed
      }

      // Strategy 3: Check if building centroid is within parcel
      let centroidInParcel = false;
      try {
        centroidInParcel = turf.booleanPointInPolygon(buildingCentroid, parcelPolygon);
      } catch (_e) {
        // Point in polygon failed
      }

      // Determine match type and confidence
      let matchType: BuildingFootprint['match_type'] = 'unmatched';
      let confidence = 0;

      if (isWithin) {
        matchType = 'within';
        confidence = 95;
      } else if (overlapPercent >= 50) {
        matchType = 'overlapping';
        confidence = 80;
      } else if (overlapPercent > 0) {
        matchType = 'overlapping';
        confidence = 60;
      } else if (centroidInParcel) {
        matchType = 'overlapping';
        confidence = 70;
      } else if (distance < 50) {
        matchType = 'nearby';
        confidence = 50;
      } else if (distance < 100) {
        matchType = 'nearby';
        confidence = 30;
      }

      if (confidence > 0) {
        matched.push({
          ...building,
          confidence,
          match_type: matchType,
          overlap_percent: overlapPercent,
          distance_ft: Math.round(distance),
        });
      }

      // Debug first few buildings
      if (matched.length <= 3 || confidence > 0) {
        console.log(`      Building ${building.id}: ${building.area_sqft} sqft`);
        console.log(
          `        Distance: ${Math.round(distance)} ft | Overlap: ${overlapPercent}% | Match: ${matchType}`,
        );
      }
    } catch (error) {
      console.log(`      Error processing ${building.id}: ${error}`);
    }
  }

  // Sort by confidence and distance
  matched.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return (a.distance_ft || 1000) - (b.distance_ft || 1000);
  });

  console.log(`      Matched ${matched.length} buildings`);

  return matched;
}

/**
 * Detect buildings for an address
 */
async function detectBuildings(address: string): Promise<DetectionResult> {
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
      all_in_area: 0,
      matched: [],
      total_area: 0,
      lot_coverage: 0,
    },
    confidence: {
      level: 'NONE',
      percent: 0,
      method: 'none',
    },
  };

  // Step 1: Fetch parcel boundary
  console.log('\n📦 FETCHING PARCEL BOUNDARY');
  const parcel = await fetchParcelBoundary(address, {
    useCache: true,
    timeout: 20000,
    retries: 1,
  });

  if (parcel && parcel.geometry) {
    result.parcel = {
      apn: parcel.apn,
      county: parcel.county,
      area_sqft: parcel.area_sqft,
      has_boundary: true,
    };
    console.log(`   ✅ Parcel: ${parcel.apn} (${parcel.area_sqft.toLocaleString()} sqft)`);

    // Step 2: Fetch buildings
    console.log('\n🏢 FETCHING BUILDING DATA');
    const parcelPolygon = turf.polygon(parcel.geometry.rings);
    const buffered = turf.buffer(parcelPolygon, 200, { units: 'feet' }); // Larger search area
    const bbox = turf.bbox(buffered!);

    const allBuildings = await fetchAllBuildings(bbox);
    result.buildings.all_in_area = allBuildings.length;
    console.log(`   📊 Total buildings in area: ${allBuildings.length}`);

    // Step 3: Match buildings to parcel
    const matched = matchBuildingsToParcel(allBuildings, parcel.geometry);
    result.buildings.matched = matched;

    // Step 4: Calculate totals
    if (matched.length > 0) {
      result.buildings.total_area = matched.reduce((sum, b) => sum + b.area_sqft, 0);
      result.buildings.lot_coverage = Math.round(
        (result.buildings.total_area / parcel.area_sqft) * 100,
      );

      // Determine confidence based on match quality
      const withinCount = matched.filter((b) => b.match_type === 'within').length;
      const overlapCount = matched.filter((b) => b.match_type === 'overlapping').length;

      if (withinCount > 0) {
        result.confidence.level = 'HIGH';
        result.confidence.percent = 90;
        result.confidence.method = 'Buildings within parcel boundary';
      } else if (overlapCount > 0) {
        result.confidence.level = 'MODERATE';
        result.confidence.percent = 70;
        result.confidence.method = 'Buildings overlapping parcel';
      } else {
        result.confidence.level = 'LOW';
        result.confidence.percent = 40;
        result.confidence.method = 'Buildings nearby parcel';
      }
    } else {
      // No buildings matched - use estimate
      const estimate = Math.round(parcel.area_sqft * 0.22);
      result.buildings.total_area = estimate;
      result.buildings.lot_coverage = 22;
      result.confidence.level = 'ESTIMATE';
      result.confidence.percent = 20;
      result.confidence.method = `No buildings matched - using 22% estimate`;
    }
  } else {
    console.log(`   ❌ Could not fetch parcel boundary`);
    result.confidence.method = 'No parcel data available';
  }

  return result;
}

/**
 * Display results
 */
function displayResults(result: DetectionResult) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 RESULTS');
  console.log('='.repeat(70));

  console.log('\n📦 PARCEL:');
  console.log(`   APN: ${result.parcel.apn}`);
  console.log(`   County: ${result.parcel.county}`);
  console.log(`   Lot Size: ${result.parcel.area_sqft.toLocaleString()} sqft`);

  console.log('\n🏢 BUILDINGS:');
  console.log(`   Buildings in search area: ${result.buildings.all_in_area}`);
  console.log(`   Buildings matched to parcel: ${result.buildings.matched.length}`);
  console.log(`   Total Building Area: ${result.buildings.total_area.toLocaleString()} sqft`);
  console.log(`   Lot Coverage: ${result.buildings.lot_coverage}%`);

  if (result.buildings.matched.length > 0) {
    console.log('\n   Matched Buildings:');
    for (const building of result.buildings.matched.slice(0, 5)) {
      const matchInfo =
        building.match_type === 'within'
          ? 'WITHIN PARCEL'
          : building.match_type === 'overlapping'
            ? `${building.overlap_percent}% overlap`
            : `${building.distance_ft} ft away`;
      console.log(
        `   • ${building.area_sqft.toLocaleString()} sqft (${building.source}) - ${matchInfo}`,
      );
      console.log(`     Confidence: ${building.confidence}%`);
    }
  }

  console.log('\n🎯 CONFIDENCE:');
  console.log(`   Level: ${result.confidence.level} (${result.confidence.percent}%)`);
  console.log(`   Method: ${result.confidence.method}`);
}

/**
 * Main test
 */
async function main() {
  console.log('🏠 BUILDING DETECTION WITH PARCEL BOUNDARIES V2');
  console.log(`📅 ${new Date().toLocaleString()}`);

  const addresses = [
    '20616 Archwood St, Winnetka, CA 91306',
    '10921 Polaris Dr, San Diego, CA 92126',
    '1843 S Bedford St, Los Angeles, CA 90035',
  ];

  const results: DetectionResult[] = [];

  for (const address of addresses) {
    const result = await detectBuildings(address);
    displayResults(result);
    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📈 FINAL SUMMARY');
  console.log('='.repeat(70));

  console.log('\n| Property | Buildings | Coverage | Confidence |');
  console.log('|----------|-----------|----------|------------|');

  for (const result of results) {
    const addr = result.address.substring(0, 30) + '...';
    const buildings =
      result.buildings.matched.length > 0
        ? `${result.buildings.total_area.toLocaleString()} sqft`
        : 'Estimate';
    const coverage = `${result.buildings.lot_coverage}%`;
    const confidence = `${result.confidence.level} (${result.confidence.percent}%)`;

    console.log(`| ${addr} | ${buildings} | ${coverage} | ${confidence} |`);
  }

  // Key findings
  console.log('\n🔍 KEY FINDINGS:');
  const highConfidence = results.filter((r) => r.confidence.percent >= 70);
  const estimates = results.filter((r) => r.confidence.level === 'ESTIMATE');

  console.log(`   High confidence results: ${highConfidence.length}/${results.length}`);
  console.log(`   Using estimates: ${estimates.length}/${results.length}`);

  if (estimates.length > 0) {
    console.log('\n   ⚠️ Note: Some properties using estimates due to lack of building data');
    console.log('   This could mean:');
    console.log('   • Buildings are too new for the datasets');
    console.log('   • Data misalignment between sources');
    console.log('   • Properties are actually vacant');
  }
}

// Run
main().catch(console.error);
