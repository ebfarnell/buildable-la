import * as fs from 'fs';
import * as readline from 'readline';
import { analyzeParcel } from './agent_task.js';
import { RateLimiter, withRetry } from './rate_limit.js';
import { dbInit } from './storage.js';

interface ProcessOptions {
  inputFile: string;
  resumeFrom?: number;
  maxParcels?: number;
  zipcodes?: string[];
}

/**
 * Process parcels from NDJSON file with rate limiting and resume capability
 */
export async function processParcels(options: ProcessOptions) {
  const { inputFile, resumeFrom = 0, maxParcels = Infinity, zipcodes } = options;

  const db = dbInit();
  const limiter = new RateLimiter(2, 200); // 2 concurrent, 200ms delay

  // Track progress
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let currentLine = 0;

  // Create progress table if doesn't exist
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY,
      input_file TEXT,
      last_line INTEGER,
      processed INTEGER,
      errors INTEGER,
      updated_at TEXT
    )
  `,
  ).run();

  // Get last progress for this file
  const lastProgress = db
    .prepare('SELECT last_line FROM progress WHERE input_file = ? ORDER BY id DESC LIMIT 1')
    .get(inputFile) as any;

  const startLine = resumeFrom || lastProgress?.last_line || 0;
  if (startLine > 0) {
    console.log(`Resuming from line ${startLine}`);
  }

  const fileStream = fs.createReadStream(inputFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  console.log(`Processing parcels from: ${inputFile}`);
  console.log(`Filters: ZIP codes=${zipcodes?.join(',') || 'all'}, max=${maxParcels}`);

  const startTime = Date.now();

  for await (const line of rl) {
    currentLine++;

    // Skip until we reach resume point
    if (currentLine <= startLine) {
      continue;
    }

    // Check max parcels limit
    if (processed >= maxParcels) {
      console.log(`Reached max parcels limit: ${maxParcels}`);
      break;
    }

    try {
      const feature = JSON.parse(line);

      // Skip if not a valid feature
      if (!feature.type || feature.type !== 'Feature' || !feature.properties) {
        continue;
      }

      const apn = feature.properties.APN || feature.properties.AIN;
      const zip = (feature.properties.SitusZIP || '').substring(0, 5); // Extract first 5 digits of ZIP

      if (!apn) {
        skipped++;
        continue;
      }

      // Filter by ZIP if specified
      if (zipcodes && zipcodes.length && !zipcodes.includes(zip)) {
        skipped++;
        continue;
      }

      // Check if already processed
      const existing = db.prepare('SELECT apn FROM candidates WHERE apn = ?').get(apn);
      if (existing) {
        skipped++;
        continue;
      }

      // Process with rate limiting and retry
      await limiter.run(async () => {
        try {
          const result = await withRetry(
            () => analyzeParcel(apn, zip, { type: 'FeatureCollection', features: [feature] }),
            3,
            500,
          );

          processed++;
          console.log(
            `✓ [${processed}] APN: ${apn}, ZIP: ${zip}, Buildable: ${result.buildable_footprint_sqft.toFixed(0)} sqft`,
          );

          // Save progress every 10 parcels
          if (processed % 10 === 0) {
            saveProgress();
          }

          // Refresh report every 500 rows for live progress
          if (processed % 500 === 0) {
            try {
              console.log(`refresh report… (${processed})`);
              // Best-effort report generation
              await import('./report_html.js')
                .then((m) => (m as any).default?.('out/report_live.html'))
                .catch(() => {});
            } catch {}
          }
        } catch (err: any) {
          errors++;
          console.error(`✗ [Error ${errors}] APN: ${apn} - ${err.message}`);

          // Log error to database
          db.prepare(
            `
            INSERT INTO errors (apn, zip, error_message, timestamp)
            VALUES (?, ?, ?, datetime('now'))
          `,
          ).run(apn, zip, err.message);
        }
      });
    } catch (err: any) {
      console.error(`Failed to parse line ${currentLine}: ${err.message}`);
    }
  }

  // Final progress save
  saveProgress();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`
  === Processing Complete ===
  Processed: ${processed}
  Skipped: ${skipped}
  Errors: ${errors}
  Time: ${elapsed.toFixed(1)}s
  Rate: ${(processed / elapsed).toFixed(2)} parcels/sec
  `);

  function saveProgress() {
    db.prepare(
      `
      INSERT INTO progress (input_file, last_line, processed, errors, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `,
    ).run(inputFile, currentLine, processed, errors);
  }
}

// Create errors table
const db = dbInit();
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apn TEXT,
    zip TEXT,
    error_message TEXT,
    timestamp TEXT
  )
`,
).run();

// CLI usage
if (process.argv[1].endsWith('batch_all.ts')) {
  const inputFile = process.argv[2];
  const maxParcels = process.argv[3] ? parseInt(process.argv[3]) : 2000;

  if (!inputFile) {
    console.error('Usage: tsx batch_all.ts <input.jsonl> [max_parcels]');
    console.error('Example: tsx batch_all.ts data/parcels_90024.jsonl 100');
    process.exit(1);
  }

  processParcels({
    inputFile,
    maxParcels,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
