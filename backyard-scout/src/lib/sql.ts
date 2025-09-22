/* Minimal SQLite helper using better-sqlite3 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DBOptions = { readonly?: boolean };

export function openDb(dbPath: string, opts: DBOptions = {}): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath, { readonly: !!opts.readonly, fileMustExist: false });
  // Pragmas for speed + safety; adjust if needed
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function tableHasColumn(db: Database.Database, table: string, col: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return rows.some((r) => r.name === col);
  } catch {
    return false;
  }
}

export function tableExists(db: Database.Database, table: string): boolean {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
      .get(table) as any;
    return !!row;
  } catch {
    return false;
  }
}
