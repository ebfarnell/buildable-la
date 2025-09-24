import * as fs from 'fs';
import * as path from 'path';

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    key: string;
    [key: string]: any;
  };
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

function pointInMultiPolygon(point: [number, number], multiPolygon: number[][][]): boolean {
  for (const polygon of multiPolygon) {
    if (pointInPolygon(point, polygon)) {
      return true;
    }
  }
  return false;
}

function pointInFeature(lon: number, lat: number, feature: GeoJsonFeature): boolean {
  const point: [number, number] = [lon, lat];

  if (feature.geometry.type === 'Polygon') {
    const coordinates = feature.geometry.coordinates as number[][][];
    return pointInPolygon(point, coordinates[0]);
  } else if (feature.geometry.type === 'MultiPolygon') {
    const coordinates = feature.geometry.coordinates as number[][][][];
    for (const polygon of coordinates) {
      if (pointInMultiPolygon(point, polygon)) {
        return true;
      }
    }
  }

  return false;
}

let boundaryCache: Map<string, GeoJsonFeatureCollection> = new Map();

export async function resolveJurisdiction(lon: number, lat: number): Promise<string | null> {
  const boundariesDir = path.resolve(process.cwd(), 'config/boundaries');

  if (!fs.existsSync(boundariesDir)) {
    return null;
  }

  const files = fs.readdirSync(boundariesDir).filter(f => f.endsWith('.geojson'));

  if (files.length === 0) {
    return null;
  }

  for (const file of files) {
    const key = file.replace('.geojson', '');

    if (!boundaryCache.has(key)) {
      const filePath = path.join(boundariesDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const geojson = JSON.parse(content) as GeoJsonFeatureCollection;
        boundaryCache.set(key, geojson);
      } catch (e) {
        console.error(`Failed to load boundary file ${file}: ${e}`);
        continue;
      }
    }

    const geojson = boundaryCache.get(key);
    if (!geojson) continue;

    for (const feature of geojson.features) {
      if (pointInFeature(lon, lat, feature)) {
        return feature.properties.key || key;
      }
    }
  }

  return null;
}