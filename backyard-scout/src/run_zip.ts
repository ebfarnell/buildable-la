import fs from 'node:fs';
import path from 'node:path';
import { analyzeParcel } from './agent_task.js';

/**
 * Usage: tsx src/run_zip.ts 91361 --limit 100
 *
 * Expects an input JSON file at data/parcels_91361.json containing an array of
 * { apn: string, zip: string, parcel_geojson: FeatureCollection }
 */
async function main() {
  const zip = process.argv[2];
  if (!zip) throw new Error('ZIP required e.g. 91361');
  const limitArg = process.argv.find((a) => a.startsWith('--limit'));
  const limit = limitArg ? parseInt(limitArg.split('=')[1] || '100', 10) : 100;

  const file = path.join(process.cwd(), 'data', `parcels_${zip}.json`);
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    console.error(`Please create a JSON file with parcel data for ZIP ${zip}`);
    process.exit(1);
  }

  const arr = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<{
    apn: string;
    zip: string;
    parcel_geojson: any;
  }>;
  console.log(`Processing ${Math.min(arr.length, limit)} parcels for ZIP ${zip}...`);

  let count = 0;
  let successCount = 0;
  for (const row of arr) {
    if (count >= limit) break;
    try {
      const res = await analyzeParcel(row.apn, row.zip || zip, row.parcel_geojson);
      console.log(
        `[OK] ${row.apn} buildable=${res.buildable_footprint_sqft.toFixed(0)} sqft score=${res.score.toFixed(2)}`,
      );
      successCount++;
    } catch (e: any) {
      console.warn(`[ERR] ${row.apn}: ${e.message}`);
    }
    count++;
  }

  console.log(`\nCompleted: ${successCount}/${count} parcels processed successfully`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
