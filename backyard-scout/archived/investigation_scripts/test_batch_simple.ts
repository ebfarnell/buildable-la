import * as fs from 'fs';
import * as readline from 'readline';
import { analyzeParcel } from './src/agent_task.js';
import { RateLimiter, withRetry } from './src/rate_limit.js';

async function processSimple() {
  const limiter = new RateLimiter(2, 200);
  const fileStream = fs.createReadStream('data/parcels_90024.jsonl');
  const rl = readline.createInterface({ input: fileStream });

  let processed = 0;
  let errors = 0;
  const maxParcels = 5;

  console.log('Processing first 5 parcels from 90024...');

  for await (const line of rl) {
    if (processed >= maxParcels) break;

    try {
      const feature = JSON.parse(line);
      const apn = feature.properties.APN;
      const zip = (feature.properties.SitusZIP || '').substring(0, 5);

      await limiter.run(async () => {
        const result = await withRetry(
          () => analyzeParcel(apn, zip, { type: 'FeatureCollection', features: [feature] }),
          3,
          500,
        );
        processed++;
        console.log(
          `✓ [${processed}] APN: ${apn}, Zone: ${result.zoning?.zone_code || '?'}, Buildable: ${result.buildable_footprint_sqft.toFixed(0)} sqft`,
        );
      });
    } catch (err: any) {
      errors++;
      console.error(`✗ [Error ${errors}] ${err.message.split('\n')[0]}`);
    }
  }

  rl.close();
  console.log(`\nCompleted: ${processed} processed, ${errors} errors`);
}

processSimple().catch(console.error);
