import Database from 'better-sqlite3';

export type ParcelRow = {
  apn: string;
  zip: string;
  zone?: string;
  parcel_geojson: string;
  footprints_geojson: string;
  buildable_geojson: string;
  buildable_footprint_sqft: number;
  score: number;
  static_thumb_url?: string;
};

export function dbInit(path = 'data.db') {
  const db = new Database(path);
  db.exec(`
    create table if not exists candidates (
      apn text primary key,
      zip text,
      zone text,
      parcel_geojson text,
      footprints_geojson text,
      buildable_geojson text,
      buildable_footprint_sqft real,
      score real,
      static_thumb_url text,
      created_at datetime default current_timestamp
    );
  `);
  return db;
}
