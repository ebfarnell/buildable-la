import * as turf from '@turf/turf';

// Simple college resolver - in production, use a geocoding service
export async function resolveCollege(name: string, _city?: string) {
  // California Lutheran University coordinates
  if (name.toLowerCase().includes('lutheran') || name.toLowerCase().includes('clu')) {
    return {
      name: 'California Lutheran University',
      lon: -118.8784,
      lat: 34.2249,
      address: '60 West Olsen Road, Thousand Oaks, CA 91360',
    };
  }
  // Could add more colleges or use geocoding API
  return null;
}

export function bufferMiles(lon: number, lat: number, miles: number) {
  const point = turf.point([lon, lat]);
  const buffered = turf.buffer(point, miles, { units: 'miles' });
  return buffered;
}
