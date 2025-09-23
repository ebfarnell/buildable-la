import { fetch } from 'undici';
export async function searchArcGISBoundary(_name: string, _city?: string) {
  // Intentionally minimal: in practice you'd point to known city/County hubs.
  return null; // prefer OSM first; you can extend this with your known hubs later
}
