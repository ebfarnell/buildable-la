/**
 * Usage:
 *   npx tsx src/monitor.ts [--db backyard-scout.db] [--table results] [--viable 770]
 */
import { openDb, tableExists, tableHasColumn } from './lib/sql.js';
import process from 'node:process';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const key = a.replace(/^--/, '');
    const val = process.argv[i + 1]?.startsWith('--') ? 'true' : (process.argv[i + 1] ?? 'true');
    if (!val.startsWith('--')) i += 1;
    args.set(key, val);
  }
}

const DB_PATH = args.get('db') ?? 'backyard-scout.db';
const TABLE = args.get('table') ?? 'results';
const VIABLE_MIN = Number(args.get('viable') ?? '770');

function main() {
  const db = openDb(DB_PATH);

  // First check if the table exists
  if (!tableExists(db, TABLE)) {
    // Try alternative table names
    const altTables = ['candidates', 'results', 'parcels'];
    const found = altTables.find((t) => tableExists(db, t));
    if (found) {
      console.log(
        `No table "${TABLE}" found, but found "${found}". Use --table ${found} to analyze it.`,
      );
    } else {
      console.log(`No table "${TABLE}" found in ${DB_PATH}.`);
    }
    process.exit(0);
  }

  // Check which columns exist
  const hasBuildable =
    tableHasColumn(db, TABLE, 'buildable_sqft') ||
    tableHasColumn(db, TABLE, 'buildable_footprint_sqft');
  const buildableCol = tableHasColumn(db, TABLE, 'buildable_sqft')
    ? 'buildable_sqft'
    : 'buildable_footprint_sqft';
  const hasZone = tableHasColumn(db, TABLE, 'zone');
  const hasErr = tableHasColumn(db, TABLE, 'error_flags');
  const hasConstraints = tableHasColumn(db, TABLE, 'constraints');

  const total = (db.prepare(`SELECT COUNT(*) as c FROM ${TABLE}`).get() as any)?.c ?? 0;
  const viable = hasBuildable
    ? ((
        db
          .prepare(`SELECT COUNT(*) as c FROM ${TABLE} WHERE IFNULL(${buildableCol},0) >= ?`)
          .get(VIABLE_MIN) as any
      )?.c ?? 0)
    : 0;
  const viablePct = total ? ((viable / total) * 100).toFixed(1) : '0.0';

  console.log(`\n=== Backyard Scout Analysis ===`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Table: ${TABLE}`);
  console.log(`\nAnalyzed: ${total} parcels`);

  if (hasBuildable) {
    console.log(`Viable (≥ ${VIABLE_MIN} sqft): ${viable} (${viablePct}%)`);

    // Get buildable area statistics
    const stats = db
      .prepare(
        `
      SELECT
        ROUND(AVG(${buildableCol}), 0) as avg_sqft,
        ROUND(MIN(${buildableCol}), 0) as min_sqft,
        ROUND(MAX(${buildableCol}), 0) as max_sqft
      FROM ${TABLE}
      WHERE ${buildableCol} > 0
    `,
      )
      .get() as any;

    if (stats) {
      console.log(`\nBuildable Area Stats:`);
      console.log(`  Average: ${stats.avg_sqft} sqft`);
      console.log(`  Min: ${stats.min_sqft} sqft`);
      console.log(`  Max: ${stats.max_sqft} sqft`);
    }
  }

  if (hasErr) {
    const err = db
      .prepare(
        `SELECT error_flags AS key, COUNT(*) AS c
       FROM ${TABLE}
       WHERE IFNULL(error_flags,'') != ''
       GROUP BY error_flags
       ORDER BY c DESC LIMIT 10`,
      )
      .all() as any[];
    if (err.length) {
      console.log('\nTop error flags:');
      for (const r of err) console.log(`  ${r.key}: ${r.c}`);
    }
  }

  if (hasConstraints) {
    const constraints = db
      .prepare(
        `SELECT constraints AS key, COUNT(*) AS c
       FROM ${TABLE}
       WHERE IFNULL(constraints,'') != ''
       GROUP BY constraints
       ORDER BY c DESC LIMIT 10`,
      )
      .all() as any[];
    if (constraints.length) {
      console.log('\nTop constraints:');
      for (const r of constraints) console.log(`  ${r.key}: ${r.c}`);
    }
  }

  if (hasZone) {
    const zones = db
      .prepare(
        `SELECT zone AS key, COUNT(*) AS c
       FROM ${TABLE}
       GROUP BY zone
       ORDER BY c DESC LIMIT 15`,
      )
      .all() as any[];
    if (zones.length) {
      console.log('\nZone distribution (top 15):');
      const zTotal = zones.reduce((s, r) => s + (r.c ?? 0), 0);
      for (const r of zones) {
        const pct = zTotal ? ((r.c / zTotal) * 100).toFixed(1) : '0.0';
        console.log(`  ${r.key ?? '(null)'}: ${r.c} (${pct}%)`);
      }
    }
  }

  // Top candidates
  if (hasBuildable) {
    const nameCol = tableHasColumn(db, TABLE, 'address')
      ? 'address'
      : tableHasColumn(db, TABLE, 'apn')
        ? 'apn'
        : 'id';
    const top = db
      .prepare(
        `SELECT ${nameCol} AS name, zone, ${buildableCol} as buildable_sqft
       FROM ${TABLE}
       WHERE IFNULL(${buildableCol},0) >= ?
       ORDER BY ${buildableCol} DESC
       LIMIT 10`,
      )
      .all(VIABLE_MIN) as any[];
    if (top.length) {
      console.log('\nTop candidates:');
      for (const r of top)
        console.log(`  ${r.name ?? '(unknown)'} | ${r.zone ?? ''} | ${r.buildable_sqft} sqft`);
    }
  }

  db.close();
}

main();
