import * as fs from 'fs';
import * as readline from 'readline';
import { analyzeParcel } from './agent_task.js';
import { RateLimiter } from './rate_limit.js';
import { dbInit } from './storage.js';

async function processAgouraHills() {
  const inputFile = 'data/parcels_91301.jsonl';
  const db = dbInit('backyard-scout.db');
  const limiter = new RateLimiter(2, 200);

  // Track progress
  let processed = 0;
  let viable = 0;
  let errors = 0;
  const startTime = Date.now();

  console.log('Processing parcels for ZIP 91301 (Agoura Hills)...');
  console.log('Looking for properties with ≥1000 sqft buildable area...\n');

  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (processed >= 50) break;

    try {
      const feature = JSON.parse(line);
      const apn = feature.properties.APN;
      const zip = feature.properties.ZIPCode5 || '91301';
      const address =
        feature.properties.SitusFullAddress || feature.properties.SitusAddress || 'Address N/A';

      // Check if already processed
      const existing = db.prepare('SELECT apn FROM candidates WHERE apn = ?').get(apn);
      if (existing) {
        console.log(`Skipping already processed: ${apn}`);
        continue;
      }

      // Process with rate limiting
      await limiter.run(async () => {
        try {
          const result = await analyzeParcel(apn, zip, {
            type: 'FeatureCollection',
            features: [feature],
          });

          processed++;

          // Update with address
          db.prepare('UPDATE candidates SET address = ? WHERE apn = ?').run(address, apn);

          // Check if viable for 1000 sqft ADU
          if (result.buildable_footprint_sqft >= 1000) {
            viable++;
            console.log(
              `✓ [${processed}] VIABLE - APN: ${apn}, Address: ${address}, Buildable: ${result.buildable_footprint_sqft.toFixed(0)} sqft`,
            );
          } else {
            console.log(
              `  [${processed}] APN: ${apn}, Buildable: ${result.buildable_footprint_sqft.toFixed(0)} sqft`,
            );
          }
        } catch (err: any) {
          errors++;
          console.error(`✗ Error processing ${apn}: ${err.message}`);
        }
      });
    } catch (err: any) {
      console.error(`Failed to parse line: ${err.message}`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`
=== Processing Complete ===
Processed: ${processed}
Viable (≥1000 sqft): ${viable} (${((viable / processed) * 100).toFixed(1)}%)
Errors: ${errors}
Time: ${elapsed.toFixed(1)}s
`);

  // First add address column if it doesn't exist
  try {
    db.prepare('ALTER TABLE candidates ADD COLUMN address TEXT').run();
  } catch {
    // Column might already exist
  }

  // Get top viable properties
  console.log('\n=== Top Properties for 1000 sqft ADU ===');
  const topProperties = db
    .prepare(
      `
    SELECT
      address,
      apn,
      zone,
      buildable_footprint_sqft
    FROM candidates
    WHERE buildable_footprint_sqft >= 1000
    ORDER BY buildable_footprint_sqft DESC
    LIMIT 10
  `,
    )
    .all();

  topProperties.forEach((prop: any, idx: number) => {
    console.log(`${idx + 1}. ${prop.address || 'Address N/A'}`);
    console.log(`   APN: ${prop.apn}`);
    console.log(`   Zone: ${prop.zone}`);
    console.log(`   Buildable: ${prop.buildable_footprint_sqft.toFixed(0)} sqft\n`);
  });

  db.close();
}

processAgouraHills()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
