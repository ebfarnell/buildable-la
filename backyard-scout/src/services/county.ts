// Simple county router by point
export function routeCountyByPoint(lon: number, lat: number): 'los_angeles' | 'ventura' {
  // Rough boundary: Ventura is generally west/north of LA County
  // This is simplified - in production use proper county boundaries
  if (lat > 34.3 && lon < -118.7) return 'ventura';
  return 'los_angeles';
}
