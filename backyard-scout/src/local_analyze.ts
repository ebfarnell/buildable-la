import * as fs from 'fs';
import * as readline from 'readline';
import * as turf from '@turf/turf';
import { dbInit } from './storage.js';

interface Setbacks {
  frontFt: number;
  sideFt: number;
  rearFt: number;
}

// Convert square meters to square feet
function toSqft(sqMeters: number): number {
  return sqMeters * 10.764;
}

// Apply directional setbacks to create buildable envelope
function createBuildableEnvelope(parcel: any, setbacks: Setbacks): any {
  try {
    // Handle MultiPolygon by using largest polygon
    if (parcel.geometry.type === 'MultiPolygon') {
      const polygons = parcel.geometry.coordinates.map((coords: any) => turf.polygon(coords));
      const areas = polygons.map((p: any) => turf.area(p));
      const maxIndex = areas.indexOf(Math.max(...areas));
      parcel = turf.polygon(parcel.geometry.coordinates[maxIndex]);
    }

    // Apply uniform side setback first
    const sideBuffer = -setbacks.sideFt * 0.3048; // Convert feet to meters
    let envelope = turf.buffer(parcel, sideBuffer, { units: 'meters' });

    if (!envelope) return null;

    // For directional setbacks (front/rear), we'd need parcel orientation
    // For now, apply additional conservative reduction for front/rear
    const additionalBuffer =
      -Math.max(setbacks.frontFt - setbacks.sideFt, setbacks.rearFt - setbacks.sideFt) *
      0.3048 *
      0.5;
    if (additionalBuffer < 0) {
      envelope = turf.buffer(envelope, additionalBuffer, { units: 'meters' });
    }

    return envelope;
  } catch (_e) {
    return null;
  }
}

// QC validation through grid-based cross-check
function performQC(polygon: any): string {
  if (!polygon) return 'envelope_failed';

  try {
    const area = turf.area(polygon);
    const bbox = turf.bbox(polygon);
    const gridSpacing = 3 * 0.3048; // 3 feet in meters

    // Create grid points
    let pointsInside = 0;
    let totalPoints = 0;

    for (let x = bbox[0]; x <= bbox[2]; x += gridSpacing) {
      for (let y = bbox[1]; y <= bbox[3]; y += gridSpacing) {
        const pt = turf.point([x, y]);
        totalPoints++;
        if (turf.booleanPointInPolygon(pt, polygon)) {
          pointsInside++;
        }
      }
    }

    const proxyArea = pointsInside * gridSpacing * gridSpacing;
    const diff = Math.abs(proxyArea - area) / area;

    if (diff > 0.1) {
      return `envelope_mismatch:${(diff * 100).toFixed(1)}%`;
    }

    return '';
  } catch (_e) {
    return 'qc_failed';
  }
}

export async function processLocalParcels(
  inputFile: string,
  outputDb: string,
  limit: number = 1000,
) {
  const db = dbInit(outputDb);

  // Create results table with all required fields
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS results (
      apn TEXT PRIMARY KEY,
      zip TEXT,
      address TEXT,
      zone TEXT,
      lot_area_sqft REAL,
      buildable_sqft REAL,
      envelope_strategy TEXT DEFAULT 'directional',
      qc_flags TEXT DEFAULT '',
      score REAL,
      lat REAL,
      lon REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  ).run();

  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let processed = 0;
  let viable = 0;
  let errors = 0;
  const results: any[] = [];

  console.log(`Processing parcels from: ${inputFile}`);
  console.log(`Output database: ${outputDb}`);

  for await (const line of rl) {
    if (processed >= limit) break;

    try {
      const feature = JSON.parse(line);

      if (!feature.type || feature.type !== 'Feature' || !feature.properties) {
        continue;
      }

      const props = feature.properties;
      const apn = props.APN || props.AIN;
      const zip = (props.SitusZIP || '').substring(0, 5);
      const address = props.SitusAddress || props.SitusFullAddress || '';

      if (!apn) continue;

      // Calculate lot area from geometry
      const lotAreaSqft = toSqft(turf.area(feature));

      // Determine zone - default to R1 for residential areas
      let zone = props.UseType || 'R1';
      if (zone.includes('Residential') || zone.includes('Single')) {
        zone = 'R1';
      }

      // Standard California ADU setbacks
      const setbacks: Setbacks = {
        frontFt: 10, // Front setback for ADUs
        sideFt: 4, // Side setback for ADUs
        rearFt: 4, // Rear setback for ADUs
      };

      // Create buildable envelope
      const envelope = createBuildableEnvelope(feature, setbacks);

      let buildableSqft = 0;
      let qcFlags = '';

      if (envelope) {
        // Subtract estimated building footprint (25% of lot area as conservative estimate)
        const estimatedBuildingArea = lotAreaSqft * 0.25;
        const envelopeArea = toSqft(turf.area(envelope));
        buildableSqft = Math.max(0, envelopeArea - estimatedBuildingArea);

        // Perform QC
        qcFlags = performQC(envelope);
      } else {
        qcFlags = 'envelope_failed';
      }

      // Calculate score based on buildability and lot size
      const score = Math.min(1, buildableSqft / 1200) * (lotAreaSqft > 6000 ? 1.2 : 1.0);

      // Get centroid for location
      const centroid = turf.centroid(feature);
      const [lon, lat] = centroid.geometry.coordinates;

      // Store result
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO results
        (apn, zip, address, zone, lot_area_sqft, buildable_sqft, envelope_strategy, qc_flags, score, lat, lon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        apn,
        zip,
        address,
        zone,
        lotAreaSqft,
        buildableSqft,
        'directional',
        qcFlags,
        score,
        lat,
        lon,
      );

      processed++;
      if (buildableSqft >= 770) {
        viable++;
        results.push({
          apn,
          zip,
          address,
          lotAreaSqft,
          buildableSqft,
          score,
          lat,
          lon,
        });
      }

      if (processed % 50 === 0) {
        console.log(`Processed: ${processed}, Viable (≥770 sqft): ${viable}`);
      }
    } catch (err: any) {
      errors++;
      console.error(`Error processing parcel: ${err.message}`);
    }
  }

  const viableRate = ((viable / processed) * 100).toFixed(1);

  console.log(`
  === Processing Complete ===
  Total Processed: ${processed}
  Viable (≥770 sqft): ${viable} (${viableRate}%)
  Errors: ${errors}
  Database: ${outputDb}
  `);

  return { processed, viable, viableRate, results };
}

// CLI usage
if (process.argv[1].endsWith('local_analyze.ts')) {
  const inputFile = process.argv[2];
  const outputDb = process.argv[3] || 'westlake-agoura.db';
  const limit = parseInt(process.argv[4] || '1000');

  if (!inputFile) {
    console.error('Usage: tsx local_analyze.ts <input.jsonl> [output.db] [limit]');
    process.exit(1);
  }

  processLocalParcels(inputFile, outputDb, limit)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
