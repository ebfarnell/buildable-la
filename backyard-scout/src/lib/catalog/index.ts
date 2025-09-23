import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export type Capability = 'zoning' | 'parcels' | 'buildings' | 'addresses' | 'permits' | 'overlays' | 'flood' | 'elevation';

export interface Layer {
  id: string;
  type: 'vector_tile' | 'feature' | 'map' | 'web_app' | 'stac' | 'flatgeobuf';
  url: string;
  format?: string;
  geometryField?: string;
  auth?: {
    type: 'token' | 'basic' | 'none';
    env?: string;
  };
  rateLimit?: {
    perMinute?: number;
    burst?: number;
  };
  properties?: Record<string, string[]>;
  capabilities?: Capability[];
  priority?: number;
  notes?: string;
}

export interface Jurisdiction {
  key: string;
  name: string;
  match: {
    type: 'polygon' | 'bbox';
    source: string;
    note?: string;
  };
  layers: Layer[];
  docs?: string[];
}

export interface DataCatalog {
  version: number;
  updatedAt?: string;
  jurisdictions: Jurisdiction[];
}

let catalogCache: DataCatalog | null = null;

export async function loadCatalog(): Promise<DataCatalog> {
  if (catalogCache) return catalogCache;

  const catalogPath = path.resolve(process.cwd(), 'config/data_catalog.json');
  const schemaPath = path.resolve(process.cwd(), 'config/data_catalog.schema.json');

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog not found at ${catalogPath}`);
  }

  const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);

  const validate = ajv.compile(schemaData);
  const valid = validate(catalogData);

  if (!valid) {
    const errors = validate.errors?.map(e => `${e.instancePath} ${e.message}`).join(', ');
    throw new Error(`Catalog validation failed: ${errors}`);
  }

  catalogCache = catalogData as DataCatalog;
  return catalogCache;
}

const typePreference = {
  vector_tile: 0,
  feature: 1,
  map: 2,
  web_app: 3,
  stac: 4,
  flatgeobuf: 5,
};

export function pickLayersFor(
  catalog: DataCatalog,
  jurisdictionKey: string,
  needs?: Capability[]
): Layer[] {
  const jurisdiction = catalog.jurisdictions.find(j => j.key === jurisdictionKey);

  if (!jurisdiction) {
    return [];
  }

  let layers = [...jurisdiction.layers];

  if (needs && needs.length > 0) {
    layers = layers.filter(layer => {
      if (!layer.capabilities) return false;
      return needs.some(need => layer.capabilities?.includes(need));
    });
  }

  layers.sort((a, b) => {
    const aPriority = a.priority ?? 999;
    const bPriority = b.priority ?? 999;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const aTypePreference = typePreference[a.type] ?? 999;
    const bTypePreference = typePreference[b.type] ?? 999;
    return aTypePreference - bTypePreference;
  });

  return layers;
}

export function resolveProperties(layer: Layer, raw: Record<string, unknown>): Record<string, unknown> {
  if (!layer.properties) return raw;

  const resolved: Record<string, unknown> = {};

  for (const [canonical, providerFields] of Object.entries(layer.properties)) {
    for (const field of providerFields) {
      if (field in raw && raw[field] !== undefined && raw[field] !== null) {
        resolved[canonical] = raw[field];
        break;
      }
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!(key in resolved)) {
      resolved[key] = value;
    }
  }

  return resolved;
}