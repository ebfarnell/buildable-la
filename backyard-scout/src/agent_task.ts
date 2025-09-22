import * as turf from '@turf/turf';
import { ENDPOINTS } from './config.js';
import { exportImage } from './arcgis.js';
import { footprintsByParcel, zoningIntersect, metroStopsNearby } from './sources.js';
import { inwardSetbackEnvelope, subtractFootprints, toSqft } from './geo.js';
import { dbInit } from './storage.js';

export async function analyzeParcel(apn: string, zip: string, parcelGeojson: any) {
  // 1) LIVE footprints
  const footprints: any = await footprintsByParcel(parcelGeojson);

  // 2) LIVE zoning → basic setbacks scaffold
  const zoning: any = await zoningIntersect(parcelGeojson);
  const zp = zoning.features?.[0]?.properties || {};
  const zoneCode =
    zp.ZONE_CLASS || // ZIMAS layer 1102 field
    zp.ZONE_CMPLT || // ZIMAS complete zone name
    zp.ZONELEGEND || // ZIMAS legend field
    zp.ZONE || // county / some layers
    zp.ZONING || // many cities
    zp.ZONE_SYMBOL || // alt key
    zp.ZONE_CODE || // numeric code in some layers
    'UNKNOWN';
  const isR = typeof zoneCode === 'string' && /^R[0-9D]/i.test(zoneCode);
  const setbacks = isR
    ? { frontFt: 10, sideFt: 4, rearFt: 4 }
    : zoneCode === 'UNKNOWN'
      ? { frontFt: 4, sideFt: 4, rearFt: 4 }
      : { frontFt: 10, sideFt: 5, rearFt: 5 };

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
  let areaSqft = toSqft(turf.area(buildable as any));

  // QC clamps to prevent bogus numbers
  const qcFlags = [];
  const parcelAreaSqft = toSqft(turf.area(parcelFeature));

  if (areaSqft > parcelAreaSqft && parcelAreaSqft > 0) {
    qcFlags.push('buildable_gt_lot');
    // Clamp to lot area
    areaSqft = parcelAreaSqft;
  }

  if (!isFinite(areaSqft) || areaSqft < 0) {
    qcFlags.push('buildable_invalid');
    areaSqft = 0;
  }

  // 5) NAIP thumbnail
  const bbox = turf.bbox(parcelGeojson);
  const thumb = await exportImage(ENDPOINTS.naipImageServer, bbox as any, [512, 512]);

  // 6) Metro proximity (parking relief) - skip if unavailable
  let metro = { count: 0, nearest: null };
  let parking_relief = false;
  try {
    metro = await metroStopsNearby(parcelGeojson, 800);
    parking_relief = metro.count > 0;
  } catch (e) {
    console.warn(`Metro API unavailable: ${e instanceof Error ? e.message : 'Unknown error'}`);
    // Continue without Metro data - don't fail the entire analysis
  }

  // 7) score
  const score = Math.min(1, areaSqft / 1200);

  // 8) persist
  const db = dbInit();
  const stmt = db.prepare(`
    insert into candidates(apn, zip, zone, parcel_geojson, footprints_geojson, buildable_geojson, buildable_footprint_sqft, score, static_thumb_url)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(apn) do update set
      zip=excluded.zip, zone=excluded.zone, parcel_geojson=excluded.parcel_geojson,
      footprints_geojson=excluded.footprints_geojson, buildable_geojson=excluded.buildable_geojson,
      buildable_footprint_sqft=excluded.buildable_footprint_sqft, score=excluded.score,
      static_thumb_url=excluded.static_thumb_url
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
  );

  return {
    apn,
    zip,
    buildable_footprint_sqft: areaSqft,
    score,
    static_thumb_url: thumb,
    zoning: { zone_code: zoneCode },
    flags: { parking_relief },
    citations: {
      footprints: ENDPOINTS.footprints,
      zoning: zoneCode,
      naip: ENDPOINTS.naipImageServer,
      metro: ENDPOINTS.metroStopsV2,
    },
  };
}
