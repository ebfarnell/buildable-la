import { loadCatalog, pickLayersFor, resolveProperties } from './index.js';
import { resolveJurisdiction as resolveJurisdictionFromFile } from './resolver.js';
import {
  probeFeatureServer,
  probeMapServer,
  probeVectorTile,
  probeSTAC,
  probeFlatGeobuf,
} from './healthcheck.js';

export type Capability = 'zoning' | 'parcels' | 'buildings' | 'overlays' | 'flood' | 'addresses';

export interface EndpointResult {
  jurisdiction: string;
  layer: {
    id: string;
    type: string;
    url: string;
    properties?: Record<string, string[]>;
  };
}

export async function resolveJurisdiction(lon: number, lat: number): Promise<string | null> {
  return resolveJurisdictionFromFile(lon, lat);
}

export async function pickEndpoint(jurisdictionKey: string, needs: Capability[]): Promise<EndpointResult> {
  const catalog = await loadCatalog();
  const layers = pickLayersFor(catalog, jurisdictionKey, needs);

  if (layers.length === 0) {
    throw new Error(`No layers found for jurisdiction ${jurisdictionKey} with capabilities ${needs.join(', ')}`);
  }

  const triedLayers: string[] = [];

  for (const layer of layers) {
    let healthy = false;
    const startTime = Date.now();

    try {
      switch (layer.type) {
        case 'feature':
          healthy = await probeFeatureServer(layer.url);
          break;
        case 'map':
          healthy = await probeMapServer(layer.url);
          break;
        case 'vector_tile':
          healthy = await probeVectorTile(layer.url);
          break;
        case 'stac':
          healthy = await probeSTAC(layer.url);
          break;
        case 'flatgeobuf':
          healthy = await probeFlatGeobuf(layer.url);
          break;
        case 'web_app':
          healthy = true;
          break;
        default:
          healthy = false;
      }

      const elapsed = Date.now() - startTime;

      if (healthy) {
        return {
          jurisdiction: jurisdictionKey,
          layer: {
            id: layer.id,
            type: layer.type,
            url: layer.url,
            properties: layer.properties,
          },
        };
      } else {
        triedLayers.push(`${layer.id} (${layer.type}) - unhealthy [${elapsed}ms]`);
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      triedLayers.push(`${layer.id} (${layer.type}) - error: ${error} [${elapsed}ms]`);
    }
  }

  throw new Error(
    `No healthy endpoints found for ${jurisdictionKey} with ${needs.join(', ')}. Tried: ${triedLayers.join('; ')}`
  );
}

export function normalizeProps(
  layer: { properties?: Record<string, string[]> },
  raw: Record<string, unknown>
): Record<string, unknown> {
  return resolveProperties(layer as any, raw);
}