#!/usr/bin/env npx tsx
import { streamFeatureServer } from './net/stream_query';
import * as fs from 'fs';
import * as path from 'path';

// California Lutheran University location
const CLU_LAT = 34.2247; // 60 West Olsen Road
const CLU_LON = -118.8814; // Thousand Oaks, CA 91360

// Search radius: 1.5 miles (good for student/faculty housing)
const SEARCH_RADIUS_MILES = 1.5;
const MILES_TO_METERS = 1609.34;

// Ventura County Parcels service
const VENTURA_PARCELS_URL =
  'https://gis.ventura.org/arcgis/rest/services/Parcels/Parcels/FeatureServer/0';

// Create a circular search geometry (polygon approximation)
function createSearchCircle(centerLat: number, centerLon: number, radiusMiles: number): any {
  const radiusDegs = radiusMiles / 69; // rough conversion
  const points = [];
  for (let angle = 0; angle <= 360; angle += 10) {
    const radians = (angle * Math.PI) / 180;
    const lat = centerLat + radiusDegs * Math.sin(radians);
    const lon =
      centerLon + (radiusDegs * Math.cos(radians)) / Math.cos((centerLat * Math.PI) / 180);
    points.push([lon, lat]);
  }

  return {
    rings: [points],
    spatialReference: { wkid: 4326 },
  };
}

async function extractParcels() {
  console.log('Starting extraction of parcels near California Lutheran University...');
  console.log(`Center: ${CLU_LAT}, ${CLU_LON}`);
  console.log(`Radius: ${SEARCH_RADIUS_MILES} miles`);

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outputFile = path.join(dataDir, 'parcels_thousand_oaks_clu.jsonl');
  const writeStream = fs.createWriteStream(outputFile);

  const searchGeometry = createSearchCircle(CLU_LAT, CLU_LON, SEARCH_RADIUS_MILES);

  let count = 0;
  const parcels = [];

  try {
    // Stream parcels from Ventura County
    for await (const feature of streamFeatureServer({
      url: VENTURA_PARCELS_URL,
      geometry: searchGeometry,
      geometryType: 'esriGeometryPolygon',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: [
        'APN',
        'SitusAddress',
        'SitusCity',
        'SitusZip',
        'OwnerName',
        'UseCode',
        'UseCdDesc',
        'LandValue',
        'ImprovValue',
        'TotalValue',
        'AcresGIS',
        'SqFtGIS',
        'YearBuilt',
      ],
      pageSize: 500,
      maxPages: 20,
    })) {
      // Calculate distance from CLU
      if (feature.geometry && feature.geometry.rings) {
        const rings = feature.geometry.rings[0];
        const centerLon = rings.reduce((sum: number, p: number[]) => sum + p[0], 0) / rings.length;
        const centerLat = rings.reduce((sum: number, p: number[]) => sum + p[1], 0) / rings.length;

        const distance = Math.sqrt(
          Math.pow((centerLat - CLU_LAT) * 69, 2) +
            Math.pow((centerLon - CLU_LON) * 69 * Math.cos((CLU_LAT * Math.PI) / 180), 2),
        );

        feature.properties = {
          ...feature.attributes,
          distance_miles: distance.toFixed(2),
          geometry: feature.geometry,
        };

        // Filter for residential properties
        const useCode = feature.attributes?.UseCode;
        if (useCode && useCode.toString().startsWith('1')) {
          // Residential codes typically start with 1
          parcels.push(feature);

          // Write to JSONL
          writeStream.write(
            JSON.stringify({
              apn: feature.attributes?.APN,
              address: feature.attributes?.SitusAddress,
              city: feature.attributes?.SitusCity || 'Thousand Oaks',
              zip: feature.attributes?.SitusZip,
              owner: feature.attributes?.OwnerName,
              use_code: useCode,
              use_desc: feature.attributes?.UseCdDesc,
              land_value: feature.attributes?.LandValue,
              improvement_value: feature.attributes?.ImprovValue,
              total_value: feature.attributes?.TotalValue,
              acres: feature.attributes?.AcresGIS,
              sqft: feature.attributes?.SqFtGIS,
              year_built: feature.attributes?.YearBuilt,
              distance_miles: feature.properties.distance_miles,
              geometry: feature.geometry,
              county: 'ventura',
              extraction_date: new Date().toISOString(),
            }) + '\n',
          );

          count++;

          if (count % 100 === 0) {
            console.log(`Extracted ${count} parcels...`);
          }
        }
      }
    }

    writeStream.end();

    console.log(`\nExtraction complete!`);
    console.log(`Total parcels extracted: ${count}`);
    console.log(`Output file: ${outputFile}`);

    // Sort by distance and show top 10 closest
    parcels.sort(
      (a, b) => parseFloat(a.properties.distance_miles) - parseFloat(b.properties.distance_miles),
    );

    console.log('\nTop 10 closest parcels to Cal Lutheran:');
    for (let i = 0; i < Math.min(10, parcels.length); i++) {
      const p = parcels[i];
      console.log(
        `${i + 1}. ${p.attributes?.SitusAddress || 'No address'} - ${p.properties.distance_miles} miles`,
      );
    }

    return outputFile;
  } catch (error) {
    console.error('Error extracting parcels:', error);
    throw error;
  }
}

// Run if called directly
extractParcels().catch(console.error);

export { extractParcels };
