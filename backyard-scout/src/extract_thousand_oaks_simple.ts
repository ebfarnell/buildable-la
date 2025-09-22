#!/usr/bin/env npx tsx
import { streamFeatureServer } from './net/stream_query';
import * as fs from 'fs';
import * as path from 'path';

// California Lutheran University location
const CLU_LAT = 34.2247; // 60 West Olsen Road
const CLU_LON = -118.8814; // Thousand Oaks, CA 91360

// Ventura County Parcels service
const VENTURA_PARCELS_URL =
  'https://gis.ventura.org/arcgis/rest/services/Parcels/Parcels/FeatureServer/0';

async function extractParcels() {
  console.log('Starting extraction of Thousand Oaks parcels...');
  console.log(`Using WHERE clause to filter by city...`);

  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outputFile = path.join(dataDir, 'parcels_thousand_oaks_clu.jsonl');
  const writeStream = fs.createWriteStream(outputFile);

  let count = 0;
  const parcels = [];

  try {
    // Stream parcels from Ventura County using WHERE clause
    for await (const feature of streamFeatureServer({
      url: VENTURA_PARCELS_URL,
      where: "SitusCity LIKE '%THOUSAND OAKS%' OR SitusCity = 'Thousand Oaks'",
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
      pageSize: 100, // Smaller page size for testing
      maxPages: 5, // Limit for testing
    })) {
      // Calculate distance from CLU if we have geometry
      let distance = null;
      if (feature.geometry && feature.geometry.rings) {
        const rings = feature.geometry.rings[0];
        const centerLon = rings.reduce((sum: number, p: number[]) => sum + p[0], 0) / rings.length;
        const centerLat = rings.reduce((sum: number, p: number[]) => sum + p[1], 0) / rings.length;

        distance = Math.sqrt(
          Math.pow((centerLat - CLU_LAT) * 69, 2) +
            Math.pow((centerLon - CLU_LON) * 69 * Math.cos((CLU_LAT * Math.PI) / 180), 2),
        );
      }

      // Filter for residential properties
      const useCode = feature.attributes?.UseCode;
      const isResidential =
        useCode &&
        (useCode.toString().startsWith('1') ||
          useCode.toString().startsWith('0100') ||
          (feature.attributes?.UseCdDesc && feature.attributes.UseCdDesc.includes('RESID')));

      if (isResidential) {
        // Only keep parcels within 2 miles of CLU if we have distance
        if (!distance || distance <= 2.0) {
          parcels.push({
            ...feature,
            distance_miles: distance,
          });

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
              distance_miles: distance?.toFixed(2),
              geometry: feature.geometry,
              county: 'ventura',
              extraction_date: new Date().toISOString(),
            }) + '\n',
          );

          count++;

          if (count % 10 === 0) {
            console.log(`Extracted ${count} residential parcels...`);
          }
        }
      }
    }

    writeStream.end();

    console.log(`\nExtraction complete!`);
    console.log(`Total residential parcels extracted: ${count}`);
    console.log(`Output file: ${outputFile}`);

    // Sort by distance and show top 10 closest (if we have distances)
    const parcelsWithDistance = parcels.filter((p) => p.distance_miles !== null);
    parcelsWithDistance.sort((a, b) => a.distance_miles - b.distance_miles);

    if (parcelsWithDistance.length > 0) {
      console.log('\nTop 10 closest parcels to Cal Lutheran:');
      for (let i = 0; i < Math.min(10, parcelsWithDistance.length); i++) {
        const p = parcelsWithDistance[i];
        console.log(
          `${i + 1}. ${p.attributes?.SitusAddress || 'No address'} - ${p.distance_miles.toFixed(2)} miles`,
        );
      }
    }

    return outputFile;
  } catch (error) {
    console.error('Error extracting parcels:', error);
    throw error;
  }
}

// Run extraction
extractParcels().catch(console.error);

export { extractParcels };
