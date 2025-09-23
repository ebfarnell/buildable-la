import * as turf from '@turf/turf';
import { ENDPOINTS } from './config.js';
import { exportImage } from './arcgis.js';
import { footprintsByParcel } from './sources.js';
import { inwardSetbackEnvelope, subtractFootprints, toSqft } from './geo.js';
import { dbInit } from './storage.js';

export async function analyzeParcelSimple(
  apn: string,
  zip: string,
  address: string,
  parcelGeojson: any,
) {
  // 1) LIVE footprints
  const footprints: any = await footprintsByParcel(parcelGeojson);

  // 2) Default to residential zoning for Agoura Hills
  // Standard residential setbacks for ADUs in California
  const zoneCode = 'R1'; // Assume single family residential
  const setbacks = { frontFt: 10, sideFt: 4, rearFt: 4 };

  // Handle MultiPolygon by converting to first polygon if needed
  const parcelFeature = parcelGeojson.features[0];
  if (parcelFeature.geometry.type === 'MultiPolygon') {
    // Convert MultiPolygon to Polygon by using the largest polygon
    const polygons = parcelFeature.geometry.coordinates.map((coords: any) => turf.polygon(coords));
    const areas = polygons.map((p: any) => turf.area(p));
    const maxIndex = areas.indexOf(Math.max(...areas));
    parcelFeature.geometry = {
      type: 'Polygon',
      coordinates: parcelFeature.geometry.coordinates[maxIndex],
    };
  }

  const envelope = inwardSetbackEnvelope(parcelFeature, setbacks);

  // 3) subtract existing structures
  const buildable = subtractFootprints(envelope as any, footprints);

  // 4) area metrics
  const areaSqft = toSqft(turf.area(buildable as any));
  const lotAreaSqft = toSqft(turf.area(parcelFeature));

  // 5) NAIP thumbnail
  const bbox = turf.bbox(parcelGeojson);
  const thumb = await exportImage(ENDPOINTS.naipImageServer, bbox as any, [512, 512]);

  // 6) score
  const score = Math.min(1, areaSqft / 1200);

  // 7) persist with address
  const db = dbInit('backyard-scout.db');

  // First add address column if it doesn't exist
  try {
    db.prepare('ALTER TABLE candidates ADD COLUMN address TEXT').run();
  } catch (_e) {
    // Column might already exist
  }

  try {
    db.prepare('ALTER TABLE candidates ADD COLUMN lot_area_sqft REAL').run();
  } catch (_e) {
    // Column might already exist
  }

  const stmt = db.prepare(`
    insert into candidates(apn, zip, zone, parcel_geojson, footprints_geojson, buildable_geojson,
                          buildable_footprint_sqft, score, static_thumb_url, address, lot_area_sqft)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(apn) do update set
      zip=excluded.zip, zone=excluded.zone, parcel_geojson=excluded.parcel_geojson,
      footprints_geojson=excluded.footprints_geojson, buildable_geojson=excluded.buildable_geojson,
      buildable_footprint_sqft=excluded.buildable_footprint_sqft, score=excluded.score,
      static_thumb_url=excluded.static_thumb_url, address=excluded.address, lot_area_sqft=excluded.lot_area_sqft
  `);

  stmt.run(
    apn,
    zip,
    String(zoneCode),
    JSON.stringify(parcelGeojson),
    JSON.stringify(footprints),
    JSON.stringify(buildable),
    areaSqft,
    score,
    thumb,
    address,
    lotAreaSqft,
  );

  return {
    apn,
    zip,
    address,
    buildable_footprint_sqft: areaSqft,
    lot_area_sqft: lotAreaSqft,
    score,
    static_thumb_url: thumb,
    zoning: { zone_code: zoneCode },
  };
}
