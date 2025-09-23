import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../config/california_services.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// California Statewide Parcels Service
const CA_PARCELS_URL = config.statewide.parcels.url;

// All 58 California Counties
export const CALIFORNIA_COUNTIES = [
  'ALAMEDA',
  'ALPINE',
  'AMADOR',
  'BUTTE',
  'CALAVERAS',
  'COLUSA',
  'CONTRA COSTA',
  'DEL NORTE',
  'EL DORADO',
  'FRESNO',
  'GLENN',
  'HUMBOLDT',
  'IMPERIAL',
  'INYO',
  'KERN',
  'KINGS',
  'LAKE',
  'LASSEN',
  'LOS ANGELES',
  'MADERA',
  'MARIN',
  'MARIPOSA',
  'MENDOCINO',
  'MERCED',
  'MODOC',
  'MONO',
  'MONTEREY',
  'NAPA',
  'NEVADA',
  'ORANGE',
  'PLACER',
  'PLUMAS',
  'RIVERSIDE',
  'SACRAMENTO',
  'SAN BENITO',
  'SAN BERNARDINO',
  'SAN DIEGO',
  'SAN FRANCISCO',
  'SAN JOAQUIN',
  'SAN LUIS OBISPO',
  'SAN MATEO',
  'SANTA BARBARA',
  'SANTA CLARA',
  'SANTA CRUZ',
  'SHASTA',
  'SIERRA',
  'SISKIYOU',
  'SOLANO',
  'SONOMA',
  'STANISLAUS',
  'SUTTER',
  'TEHAMA',
  'TRINITY',
  'TULARE',
  'TUOLUMNE',
  'VENTURA',
  'YOLO',
  'YUBA',
];

export interface CaliforniaServiceConfig {
  parcels: {
    url: string;
    fields: {
      county: string;
      city: string;
      apn: string;
      address: string;
      zip: string;
    };
  };
  zoning?: { url: string };
  buildings?: { url: string };
}

/**
 * Get the appropriate service configuration for any California county
 */
export function getCaliforniaServices(countyName: string): CaliforniaServiceConfig {
  // Normalize county name to uppercase
  const county = countyName.toUpperCase().replace(' COUNTY', '');

  // Check if it's a valid California county
  if (!CALIFORNIA_COUNTIES.includes(county)) {
    throw new Error(
      `Invalid California county: ${countyName}. Valid counties: ${CALIFORNIA_COUNTIES.join(', ')}`,
    );
  }

  // Base configuration using statewide service
  const services: CaliforniaServiceConfig = {
    parcels: {
      url: CA_PARCELS_URL,
      fields: config.statewide.parcels.fields,
    },
  };

  // Check for county-specific additional services
  const countyKey = county.toLowerCase().replace(' ', '_');
  const countyConfig = config.counties[countyKey];

  if (countyConfig?.additional_services) {
    // Add local services if available (often more detailed)
    if (countyConfig.additional_services.parcels_local) {
      // Option to use local service instead
      services.parcels.url = countyConfig.additional_services.parcels_local;
    }
    if (countyConfig.additional_services.zoning) {
      services.zoning = { url: countyConfig.additional_services.zoning };
    }
    if (countyConfig.additional_services.buildings) {
      services.buildings = { url: countyConfig.additional_services.buildings };
    }
  }

  return services;
}

/**
 * Build a WHERE clause for querying California parcels
 */
export function buildCaliforniaQuery(params: {
  county?: string;
  city?: string;
  zip?: string;
  apn?: string;
}): string {
  const conditions: string[] = [];

  if (params.county) {
    const county = params.county.toUpperCase().replace(' COUNTY', '');
    conditions.push(`COUNTYNAME='${county}'`);
  }

  if (params.city) {
    const city = params.city.toUpperCase();
    conditions.push(`SITE_CITY='${city}'`);
  }

  if (params.zip) {
    conditions.push(`SITE_ZIP='${params.zip}'`);
  }

  if (params.apn) {
    conditions.push(`PARCEL_APN='${params.apn}'`);
  }

  return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
}

/**
 * Get major cities for a California county
 */
export function getCountyCities(countyName: string): string[] {
  const countyKey = countyName.toLowerCase().replace(' ', '_');
  const countyConfig = config.counties[countyKey];
  return countyConfig?.cities || [];
}

/**
 * Get overlay services (fire hazard, flood, etc.)
 */
export function getOverlayServices() {
  return config.overlays;
}

/**
 * Example usage
 */
export function exampleQueries() {
  console.log('California Service Router Examples:\n');

  // Example 1: Get services for Orange County
  const orangeServices = getCaliforniaServices('Orange');
  console.log('Orange County Services:', orangeServices);

  // Example 2: Build query for Irvine parcels
  const irvineQuery = buildCaliforniaQuery({
    county: 'Orange',
    city: 'Irvine',
  });
  console.log('\nIrvine Query:', irvineQuery);

  // Example 3: Get cities in Santa Clara County
  const santaClaraCities = getCountyCities('Santa Clara');
  console.log('\nSanta Clara County Cities:', santaClaraCities);

  // Example 4: Get overlay services
  const overlays = getOverlayServices();
  console.log('\nOverlay Services:', Object.keys(overlays));
}

// Export configuration for direct access if needed
export { config as californiaConfig };
