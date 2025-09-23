import { ENDPOINTS } from './config.js';
import { queryFeatureLayer } from './arcgis.js';
import * as turf from '@turf/turf';
import fetch from 'node-fetch';

/** Footprints intersect */
export async function footprintsByParcel(parcelGeojson: any) {
  const feat = parcelGeojson?.features?.[0];
  if (!feat?.geometry) throw new Error('parcel geometry missing');

  // Handle both Polygon and MultiPolygon
  let rings;
  if (feat.geometry.type === 'MultiPolygon') {
    rings = feat.geometry.coordinates[0];
  } else if (feat.geometry.type === 'Polygon') {
    rings = feat.geometry.coordinates;
  } else {
    throw new Error(`Unsupported geometry type: ${feat.geometry.type}`);
  }

  const esriPoly = { rings, spatialReference: { wkid: 4326 } };
  return queryFeatureLayer(ENDPOINTS.footprints, {
    geometry: JSON.stringify(esriPoly),
    geometryType: 'esriGeometryPolygon',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'OBJECTID,HEIGHT,AREA',
    inSR: 4326,
  });
}

/** Jurisdiction via City Boundaries (point intersect) */
export async function jurisdictionByParcel(parcelGeojson: any) {
  const feat = parcelGeojson.features?.[0];
  if (!feat?.geometry) throw new Error('parcel geometry missing');
  const [lon, lat] = turf.center(feat).geometry.coordinates as [number, number];
  const esriPoint = { x: lon, y: lat, spatialReference: { wkid: 4326 } };
  const res: any = await queryFeatureLayer(ENDPOINTS.cityBoundaries, {
    geometry: JSON.stringify(esriPoint),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'CITY_NAME',
    returnGeometry: false,
    inSR: 4326,
  });
  return res.features?.[0]?.properties?.CITY_NAME || 'Unincorporated';
}

/** Zoning routed by jurisdiction; LA uses ZIMAS layers cascade */
export async function zoningIntersect(parcelGeojson: any) {
  const feat = parcelGeojson?.features?.[0];
  if (!feat?.geometry) throw new Error('parcel geometry missing');
  const city = await jurisdictionByParcel(parcelGeojson);

  // Handle both Polygon and MultiPolygon
  let rings;
  if (feat.geometry.type === 'MultiPolygon') {
    rings = feat.geometry.coordinates[0];
  } else if (feat.geometry.type === 'Polygon') {
    rings = feat.geometry.coordinates;
  } else {
    throw new Error(`Unsupported geometry type: ${feat.geometry.type}`);
  }

  const esriPoly = { rings, spatialReference: { wkid: 4326 } };

  let layersToTry: string[] = [];
  if (city === 'Los Angeles') {
    // Try standard zoning layer (1102) first, then Chapter 1A (1101)
    layersToTry = [
      `${ENDPOINTS.cityZimasMap}/1102`, // Standard zoning with ZONE_CLASS, ZONE_CODE fields
      `${ENDPOINTS.cityZimasMap}/1101`, // Chapter 1A zoning
    ];
  } else if (city === 'Unincorporated') {
    layersToTry = [ENDPOINTS.countyZoningLayer];
  } else if (city === 'Westlake Village') {
    layersToTry = [ENDPOINTS.westlakeVillageZoning];
  } else if (city === 'Agoura Hills') {
    // Agoura Hills is an incorporated city in LA County - use county zoning layer
    layersToTry = [ENDPOINTS.countyZoningLayer];
  } else {
    throw new Error(`No zoning source configured for city: ${city}`);
  }

  for (const layer of layersToTry) {
    const res: any = await queryFeatureLayer(layer, {
      geometry: JSON.stringify(esriPoly),
      geometryType: 'esriGeometryPolygon',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: false,
      inSR: 4326,
    });
    if (res.features?.length) return res;
  }
  throw new Error(`Zoning returned 0 features for city=${city}`);
}

/** Metro v2: stops near centroid within radiusMeters */
export async function metroStopsNearby(parcelGeojson: any, radiusMeters = 800) {
  const feat = parcelGeojson.features?.[0];
  if (!feat?.geometry) throw new Error('parcel geometry missing');
  const [lon, lat] = turf.center(feat).geometry.coordinates as [number, number];
  const url = `${ENDPOINTS.metroStopsV2}/agencies/lametro/stops?lat=${lat}&lon=${lon}&radius=${radiusMeters}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Metro stops failed ${r.status}`);
  const js = await r.json();
  const arr = Array.isArray(js) ? js : Array.isArray((js as any).data) ? (js as any).data : [];
  return { count: arr.length, nearest: arr[0] || null };
}
