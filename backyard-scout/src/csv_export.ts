/**
 * Usage:
 *   npx tsx src/csv_export.ts out/results.csv [--db backyard-scout.db] [--table results]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { stringify } from 'csv-stringify/sync';
import { openDb, tableExists } from './lib/sql.js';

const outPath = process.argv[2];
if (!outPath) {
  console.error('Usage: npx tsx src/csv_export.ts out/results.csv [--db path] [--table name]');
  process.exit(1);
}

const args = new Map<string, string>();
for (let i = 3; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a?.startsWith('--')) {
    const key = a.replace(/^--/, '');
    const val = process.argv[i + 1]?.startsWith('--') ? 'true' : (process.argv[i + 1] ?? 'true');
    if (!val.startsWith('--')) i += 1;
    args.set(key, val);
  }
}

const DB_PATH = args.get('db') ?? 'backyard-scout.db';
const TABLE = args.get('table') ?? 'results';

const db = openDb(DB_PATH);

if (!tableExists(db, TABLE)) {
  // Try alternative table names
  const altTables = ['candidates', 'results', 'parcels'];
  const found = altTables.find((t) => tableExists(db, t));
  if (found) {
    console.error(
      `No table "${TABLE}" found, but found "${found}". Use --table ${found} to export it.`,
    );
  } else {
    console.error(`No table "${TABLE}" found in ${DB_PATH}.`);
  }
  process.exit(0);
}

// Dynamically discover columns to avoid schema drift issues
const cols = (db.prepare(`PRAGMA table_info(${TABLE})`).all() as any[]).map((r) => r.name);
const rows = db.prepare(`SELECT * FROM ${TABLE}`).all() as any[];
const csv = stringify(rows, { header: true, columns: cols });

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, csv, 'utf8');
console.log(`Wrote CSV → ${outPath} (${rows.length} rows)`);

db.close();
