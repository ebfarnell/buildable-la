/**
 * Dynamic Building Estimation Service
 * Provides intelligent estimates based on zone, lot size, location, and typical patterns
 */

interface EstimationFactors {
  zoneCode: string;
  lotSizeSqft: number;
  county: string;
  city?: string;
  yearBuilt?: number;
  useCode?: string;
}

interface BuildingEstimate {
  estimatedSqft: number;
  confidence: number; // 0-1
  methodology: string;
  factors: {
    baseCoverage: number;
    zoneAdjustment: number;
    sizeAdjustment: number;
    locationAdjustment: number;
  };
}

/**
 * Zone-based coverage patterns from California planning data
 */
const ZONE_COVERAGE_PATTERNS: Record<string, { min: number; typical: number; max: number }> = {
  // Single Family Residential Zones
  R1: { min: 0.15, typical: 0.25, max: 0.4 },
  RS: { min: 0.15, typical: 0.25, max: 0.4 },
  'R-1': { min: 0.15, typical: 0.25, max: 0.4 },
  'RS-1': { min: 0.18, typical: 0.28, max: 0.45 },
  RD: { min: 0.2, typical: 0.3, max: 0.45 },
  RE: { min: 0.1, typical: 0.15, max: 0.25 }, // Rural Estate - larger lots, less coverage
  RA: { min: 0.08, typical: 0.12, max: 0.2 }, // Rural Agricultural

  // Multi-Family Residential
  R2: { min: 0.25, typical: 0.35, max: 0.5 },
  R3: { min: 0.3, typical: 0.4, max: 0.55 },
  R4: { min: 0.35, typical: 0.45, max: 0.6 },
  RM: { min: 0.3, typical: 0.4, max: 0.55 },
  RD2: { min: 0.25, typical: 0.35, max: 0.5 },

  // Mixed Use
  MU: { min: 0.4, typical: 0.5, max: 0.7 },
  MX: { min: 0.4, typical: 0.5, max: 0.7 },
  EMX: { min: 0.35, typical: 0.45, max: 0.65 },

  // Commercial
  C: { min: 0.3, typical: 0.4, max: 0.6 },
  C1: { min: 0.25, typical: 0.35, max: 0.55 },
  C2: { min: 0.3, typical: 0.4, max: 0.6 },
  CC: { min: 0.35, typical: 0.45, max: 0.65 },

  // Planned Development
  PD: { min: 0.2, typical: 0.3, max: 0.45 },
  PUD: { min: 0.2, typical: 0.3, max: 0.45 },

  // Industrial (usually not residential but included for completeness)
  M: { min: 0.2, typical: 0.3, max: 0.5 },
  M1: { min: 0.2, typical: 0.3, max: 0.5 },

  // Default for unknown zones
  DEFAULT: { min: 0.15, typical: 0.22, max: 0.4 },
};

/**
 * Lot size adjustments - smaller lots tend to have higher coverage ratios
 */
const LOT_SIZE_ADJUSTMENTS: Array<{ maxSize: number; adjustment: number }> = [
  { maxSize: 3000, adjustment: 1.2 }, // Very small lots - higher coverage
  { maxSize: 5000, adjustment: 1.1 }, // Small lots
  { maxSize: 7500, adjustment: 1.0 }, // Standard lots
  { maxSize: 10000, adjustment: 0.95 }, // Large lots
  { maxSize: 20000, adjustment: 0.85 }, // Very large lots
  { maxSize: 43560, adjustment: 0.7 }, // Acre lots
  { maxSize: Infinity, adjustment: 0.5 }, // Multi-acre parcels
];

/**
 * County/regional adjustments based on typical development patterns
 */
const REGIONAL_ADJUSTMENTS: Record<string, number> = {
  'LOS ANGELES': 1.0, // Baseline
  ORANGE: 1.05, // Slightly denser development
  'SAN DIEGO': 1.02, // Similar to LA
  'SAN FRANCISCO': 1.15, // Much denser urban development
  ALAMEDA: 1.1, // Bay Area density
  'SANTA CLARA': 1.08, // Silicon Valley
  SACRAMENTO: 0.95, // Less dense
  RIVERSIDE: 0.92, // Suburban/exurban
  'SAN BERNARDINO': 0.9,
  VENTURA: 0.95,
  KERN: 0.85, // Rural areas
  DEFAULT: 1.0,
};

/**
 * City-specific overrides for known patterns
 */
const CITY_PATTERNS: Record<string, number> = {
  'BEVERLY HILLS': 1.15,
  'SANTA MONICA': 1.12,
  'MANHATTAN BEACH': 1.1,
  PASADENA: 1.05,
  GLENDALE: 1.03,
  BURBANK: 1.02,
  WINNETKA: 0.98,
  PALMDALE: 0.85,
  LANCASTER: 0.85,
  DEFAULT: 1.0,
};

/**
 * Get zone pattern based on zone code
 */
function getZonePattern(zoneCode: string): { min: number; typical: number; max: number } {
  if (!zoneCode) return ZONE_COVERAGE_PATTERNS['DEFAULT'];

  // Clean zone code - remove special suffixes
  const cleanZone = zoneCode
    .toUpperCase()
    .replace(/-\d+$/, '') // Remove trailing numbers
    .replace(/-RIO$/, '') // Remove overlay suffixes
    .replace(/-SP$/, '')
    .replace(/-POD$/, '')
    .split('-')[0]; // Take first part of compound zones

  // Try exact match first
  if (ZONE_COVERAGE_PATTERNS[cleanZone]) {
    return ZONE_COVERAGE_PATTERNS[cleanZone];
  }

  // Try prefix match (R1, R2, etc.)
  for (const [pattern, coverage] of Object.entries(ZONE_COVERAGE_PATTERNS)) {
    if (cleanZone.startsWith(pattern)) {
      return coverage;
    }
  }

  // Check for general residential
  if (cleanZone.startsWith('R')) {
    return ZONE_COVERAGE_PATTERNS['R1']; // Default residential
  }

  // Check for commercial
  if (cleanZone.startsWith('C')) {
    return ZONE_COVERAGE_PATTERNS['C']; // Default commercial
  }

  return ZONE_COVERAGE_PATTERNS['DEFAULT'];
}

/**
 * Get lot size adjustment factor
 */
function getLotSizeAdjustment(lotSizeSqft: number): number {
  for (const { maxSize, adjustment } of LOT_SIZE_ADJUSTMENTS) {
    if (lotSizeSqft <= maxSize) {
      return adjustment;
    }
  }
  return 0.5; // Very large parcels
}

/**
 * Calculate dynamic building estimate
 */
export function calculateDynamicEstimate(factors: EstimationFactors): BuildingEstimate {
  // Get base coverage from zone
  const zonePattern = getZonePattern(factors.zoneCode);
  const baseCoverage = zonePattern.typical;

  // Apply lot size adjustment
  const sizeAdjustment = getLotSizeAdjustment(factors.lotSizeSqft);

  // Apply regional adjustment
  const regionalAdjustment =
    REGIONAL_ADJUSTMENTS[factors.county.toUpperCase()] || REGIONAL_ADJUSTMENTS['DEFAULT'];

  // Apply city adjustment if available
  const cityAdjustment = factors.city
    ? CITY_PATTERNS[factors.city.toUpperCase()] || CITY_PATTERNS['DEFAULT']
    : 1.0;

  // Calculate final coverage ratio
  let finalCoverage = baseCoverage * sizeAdjustment * regionalAdjustment * cityAdjustment;

  // Cap between zone min and max
  finalCoverage = Math.max(zonePattern.min, Math.min(zonePattern.max, finalCoverage));

  // Calculate estimated square footage
  const estimatedSqft = Math.round(factors.lotSizeSqft * finalCoverage);

  // Calculate confidence based on how many factors we have
  let confidence = 0.3; // Base confidence for estimate
  if (factors.zoneCode && factors.zoneCode !== 'UNKNOWN') confidence += 0.2;
  if (factors.city) confidence += 0.1;
  if (factors.yearBuilt) confidence += 0.1;
  if (factors.lotSizeSqft > 3000 && factors.lotSizeSqft < 20000) confidence += 0.1; // Typical residential size

  // Build methodology string
  const methodology = `Dynamic estimate: ${(finalCoverage * 100).toFixed(1)}% coverage based on ${factors.zoneCode || 'unknown'} zone, ${Math.round(factors.lotSizeSqft).toLocaleString()} sqft lot in ${factors.county} County`;

  return {
    estimatedSqft,
    confidence: Math.min(0.8, confidence), // Cap at 0.8 since it's still an estimate
    methodology,
    factors: {
      baseCoverage,
      zoneAdjustment: sizeAdjustment,
      sizeAdjustment: sizeAdjustment,
      locationAdjustment: regionalAdjustment * cityAdjustment,
    },
  };
}

/**
 * Enhanced estimation with neighborhood analysis
 * If we have nearby parcels with known building data, use that to calibrate
 */
export async function calculateEnhancedEstimate(
  factors: EstimationFactors,
  nearbyParcels?: Array<{ lotSize: number; buildingSize: number }>,
): Promise<BuildingEstimate> {
  // Start with dynamic estimate
  let estimate = calculateDynamicEstimate(factors);

  // If we have nearby data, calibrate
  if (nearbyParcels && nearbyParcels.length >= 3) {
    const avgCoverage =
      nearbyParcels.reduce((sum, p) => {
        return sum + p.buildingSize / p.lotSize;
      }, 0) / nearbyParcels.length;

    console.log(`   📊 Neighborhood average: ${(avgCoverage * 100).toFixed(1)}% coverage`);

    // Blend neighborhood average with our estimate (50/50)
    const blendedCoverage = (estimate.estimatedSqft / factors.lotSizeSqft + avgCoverage) / 2;
    const calibratedSqft = Math.round(factors.lotSizeSqft * blendedCoverage);

    estimate = {
      ...estimate,
      estimatedSqft: calibratedSqft,
      confidence: Math.min(0.9, estimate.confidence + 0.2), // Higher confidence with neighborhood data
      methodology:
        estimate.methodology + ` (calibrated with ${nearbyParcels.length} nearby parcels)`,
    };
  }

  return estimate;
}

/**
 * Quick estimate for when we need a fallback
 */
export function getQuickEstimate(
  zoneCode: string | undefined,
  lotSizeSqft: number,
  county: string = 'LOS ANGELES',
): number {
  const estimate = calculateDynamicEstimate({
    zoneCode: zoneCode || 'R1',
    lotSizeSqft,
    county,
  });

  return estimate.estimatedSqft;
}

/**
 * Export coverage patterns for reference
 */
export const getCoveragePatterns = () => ZONE_COVERAGE_PATTERNS;
export const getRegionalFactors = () => REGIONAL_ADJUSTMENTS;
