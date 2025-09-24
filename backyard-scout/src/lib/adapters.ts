import fetch from "node-fetch";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

// Tile coordinate helpers
function tileSpace(lon: number, lat: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);

  // Calculate pixel position within tile (assuming 4096x4096 extent for vector tiles)
  const extent = 4096;
  const tileX = ((lon + 180) / 360) * n;
  const tileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const px = Math.floor((tileX - x) * extent);
  const py = Math.floor((tileY - y) * extent);

  return { z: zoom, x, y, px, py, extent };
}

// Point-in-polygon test for vector tile geometries
function pip(point: [number, number], geometry: any[][]): boolean {
  const [x, y] = point;

  for (const ring of geometry) {
    if (!Array.isArray(ring) || ring.length < 3) continue;

    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];

      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }

    // First ring is outer boundary, subsequent rings are holes
    if (geometry.indexOf(ring) === 0) {
      if (!inside) return false;
    } else {
      if (inside) return false; // Point is in a hole
    }
  }

  return true;
}

// Development standards based on zone code
function standardsFromZone(zoneCode: string | undefined): Record<string, any> {
  if (!zoneCode) {
    return {
      frontSetback: 20,
      sideSetback: 5,
      rearSetback: 15,
      maxLotCoverage: 0.40,
      maxHeight: 35,
      minLotSize: 5000,
      notes: "Default standards - no zone specified"
    };
  }

  const code = zoneCode.toUpperCase();

  // Residential zones
  if (code.startsWith('R1') || code.includes('RS')) {
    return {
      frontSetback: 25,
      sideSetback: 5,
      rearSetback: 15,
      maxLotCoverage: 0.40,
      maxHeight: 30,
      minLotSize: 7500,
      allowsADU: true,
      notes: "Single-family residential"
    };
  }

  if (code.startsWith('R2') || code.includes('RD')) {
    return {
      frontSetback: 20,
      sideSetback: 5,
      rearSetback: 15,
      maxLotCoverage: 0.45,
      maxHeight: 35,
      minLotSize: 5000,
      allowsADU: true,
      allowsDuplex: true,
      notes: "Two-family residential"
    };
  }

  if (code.startsWith('R3') || code.startsWith('R4') || code.includes('RM')) {
    return {
      frontSetback: 15,
      sideSetback: 5,
      rearSetback: 15,
      maxLotCoverage: 0.50,
      maxHeight: 45,
      minLotSize: 5000,
      allowsADU: true,
      allowsMultiFamily: true,
      notes: "Multi-family residential"
    };
  }

  // Agricultural zones
  if (code.startsWith('A') || code.includes('AG')) {
    return {
      frontSetback: 50,
      sideSetback: 20,
      rearSetback: 25,
      maxLotCoverage: 0.25,
      maxHeight: 35,
      minLotSize: 20000,
      allowsADU: true,
      notes: "Agricultural zone"
    };
  }

  // Commercial zones
  if (code.startsWith('C') || code.includes('COM')) {
    return {
      frontSetback: 0,
      sideSetback: 0,
      rearSetback: 10,
      maxLotCoverage: 0.80,
      maxHeight: 65,
      minLotSize: 5000,
      allowsMixedUse: true,
      notes: "Commercial zone"
    };
  }

  // Industrial zones
  if (code.startsWith('M') || code.includes('IND')) {
    return {
      frontSetback: 15,
      sideSetback: 10,
      rearSetback: 10,
      maxLotCoverage: 0.60,
      maxHeight: 45,
      minLotSize: 10000,
      notes: "Industrial zone"
    };
  }

  // Default for unrecognized zones
  return {
    frontSetback: 20,
    sideSetback: 5,
    rearSetback: 15,
    maxLotCoverage: 0.40,
    maxHeight: 35,
    minLotSize: 5000,
    notes: `Zone ${code} - using default standards`
  };
}

// FeatureServer (parcel by tiny envelope)
export async function fetchFeatureAtPoint(layer: {type:string,url:string}, lon:number, lat:number) {
  if (layer.type !== "feature") throw new Error("parcel layer must be feature");
  const u = new URL(layer.url);
  u.searchParams.set("f","json");
  u.searchParams.set("outFields","*");
  u.searchParams.set("returnGeometry","true");
  u.searchParams.set("geometryType","esriGeometryPoint");
  u.searchParams.set("geometry", JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  u.searchParams.set("inSR","4326"); u.searchParams.set("outSR","4326");
  const r = await fetch(u.toString()); const j = await r.json();
  return j.features?.[0] ?? null;
}

// Zoning (vector tile OR feature)
export async function fetchZoningAtPoint(layer: {type:string,url:string,properties?:any}, lon:number, lat:number) {
  if (layer.type === "vector_tile") {
    const { z,x,y, px, py, extent } = tileSpace(lon, lat, 15);
    const url = layer.url.replace("{z}", `${z}`).replace("{x}", `${x}`).replace("{y}", `${y}`);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const tile = new VectorTile(new Pbf(buf));
    const candidate = tile.layers["zoning"] || tile.layers["zones"] || tile.layers["districts"];
    for (let i = 0; i < (candidate?.length || 0); i++) {
      const f = candidate!.feature(i); const g = f.loadGeometry();
      if (pip([px,py], g)) return { ...normalize(layer, f.properties) };
    }
    return { zone_code: undefined, standards: undefined };
  } else if (layer.type === "feature" || layer.type === "map") {
    // Feature service - do a spatial query with a small buffer around the point
    const u = new URL(layer.url);
    u.searchParams.set("f", "json");
    u.searchParams.set("outFields", "*");
    u.searchParams.set("returnGeometry", "false");
    u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    u.searchParams.set("geometryType", "esriGeometryPoint");
    u.searchParams.set("geometry", JSON.stringify({
      x: lon,
      y: lat,
      spatialReference: { wkid: 4326 }
    }));
    u.searchParams.set("inSR", "4326");
    u.searchParams.set("outSR", "4326");

    // For map services, we might need to identify visible layers first
    if (layer.type === "map") {
      // Map server identify operation
      const identifyUrl = layer.url.replace(/\/MapServer\/?$/i, '/MapServer/identify');
      const iu = new URL(identifyUrl);
      iu.searchParams.set("f", "json");
      iu.searchParams.set("geometry", JSON.stringify({ x: lon, y: lat }));
      iu.searchParams.set("geometryType", "esriGeometryPoint");
      iu.searchParams.set("sr", "4326");
      iu.searchParams.set("layers", "visible");
      iu.searchParams.set("tolerance", "5");
      iu.searchParams.set("mapExtent", `${lon-0.01},${lat-0.01},${lon+0.01},${lat+0.01}`);
      iu.searchParams.set("imageDisplay", "400,400,96");
      iu.searchParams.set("returnGeometry", "false");

      try {
        const r = await fetch(iu.toString());
        const j = await r.json();
        if (j.results && j.results.length > 0) {
          // Pick the first zoning-related result
          const zoningResult = j.results.find((r: any) =>
            r.layerName?.toLowerCase().includes('zon') ||
            r.attributes?.ZONE ||
            r.attributes?.ZONE_CODE
          ) || j.results[0];

          if (zoningResult?.attributes) {
            return { ...normalize(layer, zoningResult.attributes) };
          }
        }
      } catch (e) {
        console.error('Map service identify failed:', e);
      }
    } else {
      // Feature service query
      try {
        const r = await fetch(u.toString());
        const j = await r.json();

        if (j.features && j.features.length > 0) {
          // If multiple features, pick the smallest one (most specific zone)
          let selected = j.features[0];
          if (j.features.length > 1 && j.features[0].geometry) {
            // Sort by area if geometry is available
            selected = j.features.reduce((smallest: any, current: any) => {
              if (!current.geometry?.rings) return smallest;
              const area = calculatePolygonArea(current.geometry.rings);
              const smallestArea = smallest.geometry?.rings ?
                calculatePolygonArea(smallest.geometry.rings) : Infinity;
              return area < smallestArea ? current : smallest;
            });
          }

          return { ...normalize(layer, selected.attributes || selected.properties) };
        }
      } catch (e) {
        console.error('Feature service query failed:', e);
      }
    }

    // No zoning found
    return { zone_code: undefined, standards: undefined };
  } else {
    throw new Error("unsupported zoning layer type");
  }
}

// Helper to calculate rough polygon area for selecting most specific zone
function calculatePolygonArea(rings: number[][][]): number {
  if (!rings || rings.length === 0) return 0;
  const ring = rings[0]; // Use outer ring only
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

function normalize(layer: {properties?:Record<string,string[]>}, props:Record<string,any>) {
  const out: any = {};
  const map = layer.properties || {};
  for (const canonical of Object.keys(map)) {
    const first = (map[canonical]||[]).find(k => k in props);
    if (first) out[canonical] = props[first];
  }
  out.standards = standardsFromZone(out.zone_code);
  return out;
}