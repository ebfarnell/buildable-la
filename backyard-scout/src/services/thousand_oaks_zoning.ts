/**
 * Thousand Oaks Zoning Data Service
 *
 * Since the city's zoning service is not publicly accessible,
 * this module provides known zoning requirements based on
 * research and municipal code references.
 */

interface ZoningRequirements {
  zone: string;
  description: string;
  setbacks: {
    front: number;
    side: number;
    rear: number;
    corner_side?: number;
  };
  lot_coverage: number; // Maximum percentage
  height_limit: number; // In feet
  min_lot_size?: number; // In square feet
  adu_allowed: boolean;
  source: string;
  verified: boolean;
}

// Based on typical Thousand Oaks zoning patterns and regional standards
const THOUSAND_OAKS_ZONING: Record<string, ZoningRequirements> = {
  'RE-1AC': {
    zone: 'RE-1AC',
    description: 'Residential Estate - 1 Acre Minimum',
    setbacks: {
      front: 30,
      side: 10,
      rear: 25,
      corner_side: 20,
    },
    lot_coverage: 0.35, // 35% maximum
    height_limit: 25, // Primary structure
    min_lot_size: 43560, // 1 acre
    adu_allowed: true,
    source: 'Regional standards for RE zones',
    verified: false,
  },
  'RE-20': {
    zone: 'RE-20',
    description: 'Residential Estate - 20,000 sqft minimum',
    setbacks: {
      front: 25,
      side: 8,
      rear: 20,
      corner_side: 15,
    },
    lot_coverage: 0.4,
    height_limit: 25,
    min_lot_size: 20000,
    adu_allowed: true,
    source: 'Regional standards for RE zones',
    verified: false,
  },
  'RE-10': {
    zone: 'RE-10',
    description: 'Residential Estate - 10,000 sqft minimum',
    setbacks: {
      front: 20,
      side: 5,
      rear: 15,
      corner_side: 12.5,
    },
    lot_coverage: 0.45,
    height_limit: 25,
    min_lot_size: 10000,
    adu_allowed: true,
    source: 'Regional standards for RE zones',
    verified: false,
  },
  'R-1': {
    zone: 'R-1',
    description: 'Single Family Residential',
    setbacks: {
      front: 20,
      side: 5,
      rear: 15,
      corner_side: 12.5,
    },
    lot_coverage: 0.5,
    height_limit: 25,
    min_lot_size: 7000,
    adu_allowed: true,
    source: 'Typical R-1 standards in Ventura County',
    verified: false,
  },
  DEFAULT: {
    zone: 'DEFAULT',
    description: 'Conservative defaults when zone unknown',
    setbacks: {
      front: 25,
      side: 5,
      rear: 15,
      corner_side: 12.5,
    },
    lot_coverage: 0.4,
    height_limit: 25,
    adu_allowed: true,
    source: 'Conservative estimates',
    verified: false,
  },
};

// ADU-specific requirements for Thousand Oaks (per state law and local ordinance)
const ADU_REQUIREMENTS = {
  max_size: 1200, // Maximum ADU size in sqft
  min_size: 150, // Minimum efficiency unit
  max_height: 16, // Maximum height for ADU
  min_setbacks: {
    // Minimum required setbacks
    side: 4, // 4 feet per state law
    rear: 4, // 4 feet per state law
    front: 'match_primary', // Must match primary structure
    separation: 10, // From primary structure
  },
  parking: {
    required_spaces: 1, // Per ADU
    waivable_near_transit: true,
  },
  source: 'California ADU laws + Thousand Oaks ordinance',
};

/**
 * Get zoning requirements for a specific zone
 */
export function getZoningRequirements(zoneCode: string): ZoningRequirements {
  const upperZone = zoneCode.toUpperCase();

  // Check for exact match
  if (THOUSAND_OAKS_ZONING[upperZone]) {
    return THOUSAND_OAKS_ZONING[upperZone];
  }

  // Check for partial match (e.g., 'RE' matches 'RE-20')
  for (const [key, value] of Object.entries(THOUSAND_OAKS_ZONING)) {
    if (upperZone.startsWith(key.split('-')[0])) {
      return value;
    }
  }

  // Return defaults
  return THOUSAND_OAKS_ZONING.DEFAULT;
}

/**
 * Estimate zone based on lot size
 */
export function estimateZoneFromLotSize(lotSizeSqft: number): string {
  if (lotSizeSqft >= 43560) return 'RE-1AC';
  if (lotSizeSqft >= 20000) return 'RE-20';
  if (lotSizeSqft >= 10000) return 'RE-10';
  if (lotSizeSqft >= 7000) return 'R-1';
  return 'R-1';
}

/**
 * Get ADU requirements
 */
export function getADURequirements() {
  return ADU_REQUIREMENTS;
}

/**
 * Calculate buildable envelope with proper setbacks
 */
export function calculateSetbackEnvelope(
  lotSizeSqft: number,
  zoneCode?: string,
): {
  zone: string;
  setbacks: any;
  maxCoverage: number;
  buildableAreaEstimate: number;
} {
  const zone = zoneCode || estimateZoneFromLotSize(lotSizeSqft);
  const requirements = getZoningRequirements(zone);

  // Rough estimate of buildable area
  // Assumes rectangular lot, reduces by setback percentages
  const widthReduction = ((requirements.setbacks.side * 2) / Math.sqrt(lotSizeSqft)) * 100;
  const depthReduction =
    ((requirements.setbacks.front + requirements.setbacks.rear) / Math.sqrt(lotSizeSqft)) * 100;
  const envelopePercent = ((100 - widthReduction) * (100 - depthReduction)) / 10000;

  return {
    zone: requirements.zone,
    setbacks: requirements.setbacks,
    maxCoverage: requirements.lot_coverage,
    buildableAreaEstimate: Math.round(lotSizeSqft * envelopePercent),
  };
}

/**
 * Get data quality disclaimer
 */
export function getDataQualityNote(): string {
  return `Note: Zoning data based on regional standards and typical RE zone requirements.
Official zoning verification recommended through Thousand Oaks Planning Department.
Call: (805) 449-2300 or visit: https://www.toaks.org/departments/community-development`;
}
