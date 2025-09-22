/**
 * Smart Building Detection Service
 * Comprehensive approach to get ACTUAL building data while avoiding neighbor contamination
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { calculateDynamicEstimate } from './dynamic_building_estimation.js';

interface BuildingFootprint {
  id: string;
  area_sqft: number;
  geometry: any;
  source: string;
  confidence: number; // 0-1 score for how confident we are this building belongs to parcel
  overlap_percent?: number;
  distance_from_center?: number;
}

interface DetectionOptions {
  aggressive?: boolean; // Use more aggressive matching for sparse data areas
  includePartial?: boolean; // Include buildings that are partially on the parcel
}

/**
 * Microsoft Building Footprints - Most comprehensive coverage
 */
async function getMicrosoftBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;

  // Expand search area slightly to catch edge buildings
  const expandedBbox = [
    minX - 0.0001,
    minY - 0.0001,
    maxX + 0.0001,
    maxY + 0.0001
  ];

  const params = new URLSearchParams({
    f: 'json',
    where: "1=1",
    geometry: `${expandedBbox[0]},${expandedBbox[1]},${expandedBbox[2]},${expandedBbox[3]}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    maxRecordCount: '100'
  });

  try {
    const url = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0';

    console.log('   → Fetching Microsoft Building Footprints...');

    const response = await fetch(`${url}/query?${params}`, {
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json() as any;

    if (!data.features || data.features.length === 0) {
      return [];
    }

    console.log(`   📍 Found ${data.features.length} buildings in search area`);

    const buildings: BuildingFootprint[] = [];

    for (const feature of data.features) {
      if (feature.geometry?.rings) {
        const polygon = turf.polygon(feature.geometry.rings);
        const area = Math.round(turf.area(polygon) * 10.7639);

        buildings.push({
          id: `MSFT_${feature.attributes?.OBJECTID || Math.random()}`,
          area_sqft: area,
          geometry: feature.geometry,
          source: 'Microsoft',
          confidence: 0
        });
      }
    }

    return buildings;

  } catch (error: any) {
    console.log(`   ⚠️ Microsoft Buildings error: ${error.message}`);
    return [];
  }
}

/**
 * OpenStreetMap Buildings - Good urban coverage
 */
async function getOSMBuildings(bbox: number[]): Promise<BuildingFootprint[]> {
  const [minX, minY, maxX, maxY] = bbox;

  const query = `[out:json][timeout:25];
    (
      way["building"](${minY},${minX},${maxY},${maxX});
      relation["building"]["type"="multipolygon"](${minY},${minX},${maxY},${maxX});
    );
    out geom;`;

  try {
    console.log('   → Fetching OpenStreetMap buildings...');

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) return [];

    const data = await response.json() as any;
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
          geometry: { rings: [coords] },
          source: 'OpenStreetMap',
          confidence: 0
        });
      }
    }

    console.log(`   📍 Found ${buildings.length} OSM buildings`);
    return buildings;

  } catch (error: any) {
    console.log(`   ⚠️ OSM error: ${error.message}`);
    return [];
  }
}

/**
 * Smart building selection algorithm
 * Scores each building based on multiple factors to determine likelihood it belongs to the parcel
 */
function scoreBuildings(
  buildings: BuildingFootprint[],
  parcelGeoJson: any,
  parcelArea: number
): BuildingFootprint[] {

  const parcelCentroid = turf.centroid(parcelGeoJson);
  const scoredBuildings: BuildingFootprint[] = [];

  for (const building of buildings) {
    if (!building.geometry) continue;

    try {
      const buildingPoly = turf.polygon(building.geometry.rings);
      const buildingCentroid = turf.centroid(buildingPoly);

      // Calculate overlap with parcel
      let intersection = null;
      try {
        intersection = turf.intersect(buildingPoly, parcelGeoJson);
      } catch (e) {
        // Sometimes turf.intersect fails with complex geometries
        console.log(`     ⚠️ Intersection failed, checking centroid distance`);
      }

      if (!intersection) {
        // If intersection fails or no overlap, check if centroid is close
        const distance = turf.distance(buildingCentroid, parcelCentroid, { units: 'feet' });
        if (distance > Math.sqrt(parcelArea) * 0.7) continue; // Too far away
      }

      let overlapPercent = 0;
      const buildingArea = turf.area(buildingPoly);

      if (intersection) {
        const intersectionArea = turf.area(intersection);
        overlapPercent = (intersectionArea / buildingArea) * 100;

        // Skip if less than 10% overlap and far from center
        if (overlapPercent < 10) {
          const distance = turf.distance(buildingCentroid, parcelCentroid, { units: 'feet' });
          if (distance > 100) continue; // Skip if minimal overlap AND far away
        }
      }

      // Calculate distance from parcel center
      const distance = turf.distance(buildingCentroid, parcelCentroid, { units: 'feet' });

      // Calculate confidence score (0-1)
      let confidence = 0;

      // Overlap weight (50% of score)
      confidence += (overlapPercent / 100) * 0.5;

      // Distance weight (30% of score) - closer is better
      const maxDistance = Math.sqrt(parcelArea) * 0.5; // Half the "radius" of the parcel
      const distanceScore = Math.max(0, 1 - (distance / maxDistance));
      confidence += distanceScore * 0.3;

      // Size reasonableness (20% of score)
      const sizeRatio = building.area_sqft / parcelArea;
      if (sizeRatio > 0.05 && sizeRatio < 0.5) { // Between 5% and 50% of lot
        confidence += 0.2;
      } else if (sizeRatio > 0.02 && sizeRatio < 0.7) { // More lenient
        confidence += 0.1;
      }

      // Bonus for high overlap
      if (overlapPercent > 90) confidence += 0.1;
      if (overlapPercent === 100) confidence += 0.1;

      // Cap at 1.0
      confidence = Math.min(1, confidence);

      scoredBuildings.push({
        ...building,
        confidence,
        overlap_percent: overlapPercent,
        distance_from_center: distance
      });

    } catch (error) {
      console.log(`   ⚠️ Error scoring building: ${error}`);
    }
  }

  // Sort by confidence score
  scoredBuildings.sort((a, b) => b.confidence - a.confidence);

  return scoredBuildings;
}

/**
 * Select final buildings for the parcel
 */
function selectFinalBuildings(
  scoredBuildings: BuildingFootprint[],
  parcelArea: number,
  options: DetectionOptions = {}
): BuildingFootprint[] {

  const selected: BuildingFootprint[] = [];
  let totalArea = 0;

  // Maximum reasonable coverage for residential
  const maxCoverage = parcelArea * 0.6;

  for (const building of scoredBuildings) {
    // High confidence buildings (>0.7) are automatically included
    if (building.confidence > 0.7) {
      if (totalArea + building.area_sqft <= maxCoverage) {
        selected.push(building);
        totalArea += building.area_sqft;
        console.log(`     ✓ High confidence (${(building.confidence * 100).toFixed(0)}%): ${building.area_sqft} sqft, ${building.overlap_percent?.toFixed(0)}% overlap`);
      }
    }
    // Medium confidence (0.5-0.7) included if space available and aggressive mode
    else if (building.confidence > 0.5 && options.aggressive) {
      if (totalArea + building.area_sqft <= maxCoverage) {
        selected.push(building);
        totalArea += building.area_sqft;
        console.log(`     ✓ Medium confidence (${(building.confidence * 100).toFixed(0)}%): ${building.area_sqft} sqft`);
      }
    }
    // Low confidence (0.3-0.5) only in very aggressive mode
    else if (building.confidence > 0.3 && options.aggressive && options.includePartial) {
      if (totalArea + building.area_sqft <= maxCoverage && totalArea < parcelArea * 0.3) {
        selected.push(building);
        totalArea += building.area_sqft;
        console.log(`     ⚠️ Low confidence (${(building.confidence * 100).toFixed(0)}%): ${building.area_sqft} sqft`);
      }
    }
  }

  // If we found nothing with strict rules, try more aggressive approach
  if (selected.length === 0 && scoredBuildings.length > 0 && !options.aggressive) {
    console.log('   → No high-confidence buildings, trying aggressive mode...');
    return selectFinalBuildings(scoredBuildings, parcelArea, { aggressive: true });
  }

  return selected;
}

/**
 * Main smart detection function
 */
export async function getSmartBuildingFootprints(
  parcelGeometry: any,
  apn: string,
  county: string
): Promise<BuildingFootprint[]> {

  console.log('\n🏢 SMART BUILDING DETECTION:');

  // Convert to GeoJSON
  const parcelGeoJson = turf.polygon(parcelGeometry.rings);
  const parcelArea = turf.area(parcelGeoJson) * 10.7639; // to sqft
  const bbox = turf.bbox(parcelGeoJson);

  console.log(`   Parcel Area: ${Math.round(parcelArea).toLocaleString()} sqft`);

  // Try multiple sources
  let allBuildings: BuildingFootprint[] = [];

  // 1. Try Microsoft Buildings first (best coverage)
  const msftBuildings = await getMicrosoftBuildings(bbox);
  if (msftBuildings.length > 0) {
    allBuildings = msftBuildings;
    console.log(`   Using Microsoft data: ${msftBuildings.length} buildings`);
  }

  // 2. If no Microsoft data, try OSM
  if (allBuildings.length === 0) {
    const osmBuildings = await getOSMBuildings(bbox);
    if (osmBuildings.length > 0) {
      allBuildings = osmBuildings;
      console.log(`   Using OSM data: ${osmBuildings.length} buildings`);
    }
  }

  // 3. If still no data, return dynamic estimate
  if (allBuildings.length === 0) {
    console.log('   📐 No building data available, using dynamic estimate');
    return [];
  }

  // Score all buildings
  console.log('\n   📊 Scoring buildings...');
  const scoredBuildings = scoreBuildings(allBuildings, parcelGeoJson, parcelArea);

  if (scoredBuildings.length === 0) {
    console.log('   ⚠️ No buildings overlap with parcel');
    return [];
  }

  // Select final buildings
  console.log(`\n   🎯 Selecting from ${scoredBuildings.length} candidates...`);
  const finalBuildings = selectFinalBuildings(scoredBuildings, parcelArea);

  if (finalBuildings.length === 0) {
    console.log('   ⚠️ No confident building matches found');
    return [];
  }

  const totalArea = finalBuildings.reduce((sum, b) => sum + b.area_sqft, 0);
  console.log(`\n   ✅ Selected ${finalBuildings.length} building(s): ${Math.round(totalArea).toLocaleString()} sqft total`);

  return finalBuildings;
}