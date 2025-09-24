import * as fs from 'fs';
import * as readline from 'readline';
import { analyzeParcelSimple } from './analyze_simple.js';
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
  const viableProperties: any[] = [];

  console.log('Processing parcels for ZIP 91301 (Agoura Hills)...');
  console.log('Target: Properties with ≥1000 sqft buildable area for ADU');
  console.log('Using default R1 zoning assumptions\n');

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
        feature.properties.SitusFullAddress ||
        feature.properties.SitusAddress ||
        `${feature.properties.SitusHouseNo || ''} ${feature.properties.SitusStreet || ''}`.trim() ||
        'Address N/A';

      // Check if already processed
      const existing = db.prepare('SELECT apn FROM candidates WHERE apn = ?').get(apn);
      if (existing) {
        console.log(`Skipping already processed: ${apn}`);
        continue;
      }

      // Process with rate limiting
      await limiter.run(async () => {
        try {
          const result = await analyzeParcelSimple(apn, zip, address, {
            type: 'FeatureCollection',
            features: [feature],
          });

          processed++;

          // Check if viable for 1000 sqft ADU
          if (result.buildable_footprint_sqft >= 1000) {
            viable++;
            viableProperties.push({
              ...result,
              address: address,
            });
            console.log(`✓ [${processed}] VIABLE - ${address}`);
            console.log(
              `   APN: ${apn}, Buildable: ${result.buildable_footprint_sqft.toFixed(0)} sqft, Lot: ${result.lot_area_sqft.toFixed(0)} sqft`,
            );
          } else if (result.buildable_footprint_sqft >= 770) {
            console.log(`~ [${processed}] MAYBE - ${address}`);
            console.log(
              `   APN: ${apn}, Buildable: ${result.buildable_footprint_sqft.toFixed(0)} sqft`,
            );
          } else {
            console.log(
              `  [${processed}] ${apn}: ${result.buildable_footprint_sqft.toFixed(0)} sqft`,
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
Rate: ${(processed / elapsed).toFixed(2)} parcels/sec
`);

  // Get top viable properties from database
  console.log('\n=== Top Properties for 1000 sqft ADU ===');
  const topProperties = db
    .prepare(
      `
    SELECT
      address,
      apn,
      zone,
      buildable_footprint_sqft,
      lot_area_sqft
    FROM candidates
    WHERE buildable_footprint_sqft >= 1000
    ORDER BY buildable_footprint_sqft DESC
    LIMIT 15
  `,
    )
    .all();

  if (topProperties.length === 0) {
    console.log('No properties found with ≥1000 sqft buildable area.');
    console.log('\n=== Properties with ≥770 sqft (min ADU size) ===');
    const alternativeProperties = db
      .prepare(
        `
      SELECT
        address,
        apn,
        zone,
        buildable_footprint_sqft,
        lot_area_sqft
      FROM candidates
      WHERE buildable_footprint_sqft >= 770
      ORDER BY buildable_footprint_sqft DESC
      LIMIT 15
    `,
      )
      .all();

    alternativeProperties.forEach((prop: any, idx: number) => {
      console.log(`${idx + 1}. ${prop.address || 'Address N/A'}`);
      console.log(`   APN: ${prop.apn}`);
      console.log(`   Buildable: ${prop.buildable_footprint_sqft.toFixed(0)} sqft`);
      console.log(`   Lot Size: ${(prop.lot_area_sqft || 0).toFixed(0)} sqft\n`);
    });
  } else {
    topProperties.forEach((prop: any, idx: number) => {
      console.log(`${idx + 1}. ${prop.address || 'Address N/A'}`);
      console.log(`   APN: ${prop.apn}`);
      console.log(`   Zone: ${prop.zone}`);
      console.log(`   Buildable: ${prop.buildable_footprint_sqft.toFixed(0)} sqft`);
      console.log(`   Lot Size: ${(prop.lot_area_sqft || 0).toFixed(0)} sqft`);
      console.log(
        `   Potential ADU size: ${Math.min(1000, prop.buildable_footprint_sqft * 0.9).toFixed(0)} sqft\n`,
      );
    });
  }

  // Export to CSV
  const csvPath = 'out/agoura_hills_91301.csv';
  const csvContent = [
    'Address,APN,Zone,Buildable_SqFt,Lot_SqFt,Viable_1000sqft',
    ...db
      .prepare(
        `
      SELECT address, apn, zone, buildable_footprint_sqft, lot_area_sqft
      FROM candidates
      ORDER BY buildable_footprint_sqft DESC
    `,
      )
      .all()
      .map(
        (row: any) =>
          `"${row.address || ''}",${row.apn},${row.zone},${row.buildable_footprint_sqft.toFixed(0)},${(row.lot_area_sqft || 0).toFixed(0)},${row.buildable_footprint_sqft >= 1000 ? 'Yes' : 'No'}`,
      ),
  ].join('\n');

  fs.writeFileSync(csvPath, csvContent);
  console.log(`\n✓ Results exported to: ${csvPath}`);

  db.close();
}

processAgouraHills()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
