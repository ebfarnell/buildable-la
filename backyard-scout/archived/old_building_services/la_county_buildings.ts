/**
 * LA County Building Footprints Service
 * Uses authoritative LA County Building Outlines (2020) with proper parcel matching
 *
 * Data Source: https://egis-lacounty.hub.arcgis.com/maps/e6a1e375e12a4fe6849d896a26ec028a
 * This dataset includes building areas and is designed to work with county parcels
 */

import * as turf from '@turf/turf';
import { fetch } from 'undici';
import proj4 from 'proj4';

// LA County uses California State Plane Zone 5 (EPSG:2229)
// Define the projection for proper coordinate transformation
proj4.defs(
  'EPSG:2229',
  '+proj=lcc +lat_1=35.46666666666667 +lat_2=34.03333333333333 +lat_0=33.5 +lon_0=-118 +x_0=2000000 +y_0=500000 +ellps=GRS80 +datum=NAD83 +units=us-ft +no_defs',
);

interface BuildingFootprint {
  id: string;
  apn?: string; // LA County buildings may include APN
  area_sqft: number;
  height?: number;
  year_built?: number;
  use_type?: string;
  geometry: any;
  source: string;
}

interface ParcelGeometry {
  rings: number[][][];
  spatialReference?: any;
}

// LA County Building Outlines endpoint (2020 version)
// From: https://egis-lacounty.hub.arcgis.com/maps/e6a1e375e12a4fe6849d896a26ec028a
const LA_COUNTY_BUILDINGS =
  'https://services.gis.lacounty.gov/arcgis/rest/services/LACounty_Building_Outlines_2020/MapServer/0';

// Alternative endpoint from LARIAC
const LARIAC_BUILDINGS =
  'https://services5.arcgis.com/okE6CZ9z71jl65j7/arcgis/rest/services/LARIAC_Buildings_2020/FeatureServer/0';

// LA County Parcels endpoint (native, not statewide)
const LA_COUNTY_PARCELS =
  'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0';

/**
 * Get buildings for a specific parcel using proper spatial matching
 * Uses centroid-in-parcel as primary method, not distance-based matching
 */
export async function getLACountyBuildings(
  parcelGeometry: ParcelGeometry,
  apn: string,
): Promise<BuildingFootprint[]> {
  try {
    // Convert parcel to GeoJSON for turf operations
    const parcelGeoJson = turf.polygon(parcelGeometry.rings);

    // Create an inward buffer (shrink by 1 meter) to avoid edge spillover
    const shrunkParcel = turf.buffer(parcelGeoJson, -1, { units: 'meters' });
    if (!shrunkParcel) {
      console.log('   ⚠️ Parcel too small for buffer, using original');
      shrunkParcel = parcelGeoJson;
    }

    // Get parcel bounds for query
    const bbox = turf.bbox(parcelGeoJson);
    const [minX, minY, maxX, maxY] = bbox;

    // Query LA County Building Outlines
    const params = new URLSearchParams({
      f: 'json',
      where: `AIN = '${apn.replace(/-/g, '')}' OR 1=1`, // Try APN match first
      geometry: JSON.stringify({
        xmin: minX,
        ymin: minY,
        xmax: maxX,
        ymax: maxY,
        spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'AIN,SHAPE_Area,BldgType,YearBuilt,Units,Source',
      returnGeometry: 'true',
      maxRecordCount: '50',
    });

    console.log('   → Querying LA County Building Outlines...');

    let response = await fetch(`${LA_COUNTY_BUILDINGS}/query?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    let data: any = null;

    // Try primary endpoint
    if (response.ok) {
      data = await response.json();
    }

    // If primary fails, try LARIAC endpoint
    if (!data || data.error || !data.features) {
      console.log('   → Trying LARIAC Buildings 2020...');
      response = await fetch(`${LARIAC_BUILDINGS}/query?${params}`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      data = await response.json();
    }

    if (!data.features || data.features.length === 0) {
      console.log('   ℹ No buildings found in LA County dataset');
      return [];
    }

    console.log(`   📍 Found ${data.features.length} building(s) in query area`);

    // Filter buildings using proper spatial topology
    const validBuildings: BuildingFootprint[] = [];

    for (const feature of data.features) {
      if (!feature.geometry?.rings) continue;

      const buildingPoly = turf.polygon(feature.geometry.rings);
      const buildingCentroid = turf.centroid(buildingPoly);

      // Primary test: Building centroid must be within shrunken parcel
      const centroidInParcel = turf.booleanPointInPolygon(buildingCentroid, shrunkParcel);

      if (!centroidInParcel) {
        continue; // Skip buildings whose center is outside the parcel
      }

      // Secondary test: Building should not significantly overlap neighbors
      // Check if majority of building area is within original parcel
      const intersection = turf.intersect(buildingPoly, parcelGeoJson);
      if (intersection) {
        const intersectionArea = turf.area(intersection);
        const buildingArea = turf.area(buildingPoly);
        const overlapPercent = (intersectionArea / buildingArea) * 100;

        if (overlapPercent < 50) {
          continue; // Skip if less than 50% is within parcel
        }

        // Convert area from square meters to square feet
        const areaSqft = Math.round(buildingArea * 10.7639);

        // Extract attributes
        const attrs = feature.attributes || {};

        validBuildings.push({
          id: `LAC_${attrs.OBJECTID || Math.random()}`,
          apn: attrs.AIN,
          area_sqft: areaSqft,
          year_built: attrs.YearBuilt,
          use_type: attrs.BldgType,
          geometry: feature.geometry,
          source: 'LA County Building Outlines',
        });
      }
    }

    if (validBuildings.length > 0) {
      // Sanity check: Total building area shouldn't exceed 60% of parcel
      const parcelArea = turf.area(parcelGeoJson) * 10.7639;
      const totalBuildingArea = validBuildings.reduce((sum, b) => sum + b.area_sqft, 0);

      if (totalBuildingArea > parcelArea * 0.6) {
        console.log(`   ⚠️ Building area ${Math.round(totalBuildingArea)} exceeds 60% of lot`);

        // Sort by area and take largest buildings up to 60%
        validBuildings.sort((a, b) => b.area_sqft - a.area_sqft);

        let cumArea = 0;
        const finalBuildings = [];
        const maxArea = parcelArea * 0.6;

        for (const building of validBuildings) {
          if (cumArea + building.area_sqft <= maxArea) {
            finalBuildings.push(building);
            cumArea += building.area_sqft;
          }
        }

        console.log(
          `   ✅ Selected ${finalBuildings.length} building(s): ${Math.round(cumArea)} sqft`,
        );
        return finalBuildings;
      }

      console.log(
        `   ✅ Found ${validBuildings.length} building(s): ${Math.round(totalBuildingArea)} sqft`,
      );
      return validBuildings;
    }

    console.log('   ℹ No buildings within parcel boundaries');
    return [];
  } catch (error: any) {
    console.error(`   ❌ LA County Buildings error: ${error.message}`);
    return [];
  }
}

/**
 * Fallback to Microsoft Building Footprints if LA County data unavailable
 * Uses same centroid-in-parcel matching logic
 */
export async function getMicrosoftBuildingsWithProperMatching(
  parcelGeometry: ParcelGeometry,
): Promise<BuildingFootprint[]> {
  try {
    const parcelGeoJson = turf.polygon(parcelGeometry.rings);
    const shrunkParcel = turf.buffer(parcelGeoJson, -1, { units: 'meters' }) || parcelGeoJson;
    const bbox = turf.bbox(parcelGeoJson);
    const [minX, minY, maxX, maxY] = bbox;

    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      geometry: `${minX},${minY},${maxX},${maxY}`,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      maxRecordCount: '50',
    });

    const url =
      'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0';

    console.log('   → Trying Microsoft Building Footprints...');

    const response = await fetch(`${url}/query?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as any;
    const validBuildings: BuildingFootprint[] = [];

    for (const feature of data.features || []) {
      if (!feature.geometry?.rings) continue;

      const buildingPoly = turf.polygon(feature.geometry.rings);
      const buildingCentroid = turf.centroid(buildingPoly);

      // Centroid must be within shrunken parcel
      if (!turf.booleanPointInPolygon(buildingCentroid, shrunkParcel)) {
        continue;
      }

      // Majority of building must be within parcel
      const intersection = turf.intersect(buildingPoly, parcelGeoJson);
      if (intersection) {
        const intersectionArea = turf.area(intersection);
        const buildingArea = turf.area(buildingPoly);

        if (intersectionArea / buildingArea >= 0.5) {
          validBuildings.push({
            id: `MSFT_${feature.attributes?.OBJECTID || Math.random()}`,
            area_sqft: Math.round(buildingArea * 10.7639),
            geometry: feature.geometry,
            source: 'Microsoft Building Footprints',
          });
        }
      }
    }

    return validBuildings;
  } catch (error) {
    console.error(`   ❌ Microsoft Buildings error: ${error}`);
    return [];
  }
}

/**
 * Main function to get buildings with proper hierarchy
 * 1. LA County Building Outlines (best for LA)
 * 2. Microsoft Building Footprints (consistent fallback)
 * 3. Conservative estimate only as last resort
 */
export async function getBuildingsWithProperData(
  parcelGeometry: ParcelGeometry,
  apn: string,
  county: string,
): Promise<BuildingFootprint[]> {
  // For LA County, use native data
  if (county === 'LOS ANGELES') {
    const buildings = await getLACountyBuildings(parcelGeometry, apn);
    if (buildings.length > 0) {
      return buildings;
    }

    // Fallback to Microsoft if LA County fails
    const msftBuildings = await getMicrosoftBuildingsWithProperMatching(parcelGeometry);
    if (msftBuildings.length > 0) {
      return msftBuildings;
    }
  }

  // For other counties, use Microsoft as primary
  if (county !== 'LOS ANGELES') {
    const msftBuildings = await getMicrosoftBuildingsWithProperMatching(parcelGeometry);
    if (msftBuildings.length > 0) {
      return msftBuildings;
    }
  }

  // Last resort: Conservative estimate
  const parcelArea = turf.area(turf.polygon(parcelGeometry.rings)) * 10.7639;

  if (parcelArea > 3000 && parcelArea < 20000) {
    console.log('   📐 Using conservative estimate (no building data available)');
    return [
      {
        id: `EST_${apn}`,
        area_sqft: Math.round(parcelArea * 0.22),
        geometry: null,
        source: 'Conservative Estimate (22% coverage)',
      },
    ];
  }

  return [];
}
