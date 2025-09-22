import * as turf from '@turf/turf';
import { fetch } from 'undici';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { getCaliforniaServices, buildCaliforniaQuery } from './services/california_router.js';
import {
  getBuildingFootprints,
  calculateBuildableArea,
} from './services/building_footprints_deterministic.js';
import {
  getEnhancedZoning,
  getZoningRequirementsFromResult,
} from './services/enhanced_zoning_service.js';

// Import comprehensive formula library
import {
  calcBuildableEnvelope,
  calcNetBuildableArea,
  calcMaxADUSize,
  isADUViable,
  calcTotalDevelopmentCost,
  calcMonthlyRent,
  calcAnnualNOI,
  calcCapRate,
  calcCashOnCashReturn,
  calcPaybackMonths,
  calcLoanPayment,
  calcMonthlyCashFlow,
  calcOpportunityScore,
  calcDealScore,
  calcRiskScore,
  calcLotCoverage,
  calcUnusedSpace,
  calcHiddenValue,
  calcRentalDemandScore,
  formatCurrency,
  formatPercent,
  runCompleteAnalysis,
} from './formulas/adu_formulas.js';

interface PropertyAnalysis {
  // Property identification
  address: string;
  apn: string;
  county: string;
  city: string;

  // Parcel details
  parcel: {
    area_sqft: number;
    dimensions: { width: number; depth: number };
    geometry: any;
    lot_coverage_percent: number;
    unused_space_sqft: number;
  };

  // Zoning information
  zoning: {
    zone_code: string;
    zone_name?: string;
    source: string;
    confidence: number;
    verified: boolean;
    max_adu_size: number;
    setback_requirements: {
      front: number;
      side: number;
      rear: number;
    };
  };

  // Building footprints (real OSM data)
  buildings: {
    count: number;
    total_area_sqft: number;
    source: string;
    checksum: string;
    data_quality: 'high' | 'medium' | 'low';
    details: Array<{
      id: string;
      area_sqft: number;
      building_type?: string;
    }>;
  };

  // Buildable area calculations
  buildable: {
    envelope_sqft: number;
    net_buildable_sqft: number;
    max_adu_size: number;
    recommended_adu_size: number;
    envelope_strategy: string;
    viable_for_adu: boolean;
    viability_threshold: number;
  };

  // Financial analysis
  financial: {
    development_cost: number;
    site_work_cost: number;
    soft_costs: number;
    total_project_cost: number;

    monthly_rent: number;
    annual_gross_income: number;
    annual_noi: number;

    cap_rate: number;
    payback_months: number;

    // Financing metrics
    loan_amount: number;
    cash_required: number;
    monthly_payment: number;
    monthly_cash_flow: number;
    cash_on_cash_return: number;
  };

  // Market analysis
  market: {
    rental_demand_score: number;
    vacancy_rate: number;
    days_on_market: number;
    yoy_growth: number;
    market_rent_psf: number;
  };

  // Scoring & opportunity
  scoring: {
    opportunity_score: number;
    deal_score: number;
    risk_score: number;
    development_ease: number;
    owner_likelihood: number;
    hidden_value_annual: number;
  };

  // Report metadata
  report: {
    generated_at: string;
    analysis_version: string;
    data_sources: string[];
  };
}

/**
 * Resolve address to APN and county using California Statewide Parcels
 */
async function resolveAddressToParcel(address: string): Promise<{
  apn: string;
  county: string;
  city: string;
  parcelFeature: any;
}> {
  const CA_STATEWIDE_URL =
    'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

  // Clean and prepare address for search
  const cleanAddress = address.split(',')[0].toUpperCase().trim();

  console.log(`🔍 Resolving address: ${address}`);
  console.log(`   Search term: ${cleanAddress}`);

  const where = `SITE_ADDR LIKE '%${cleanAddress}%'`;
  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields: '*',
    returnGeometry: 'true',
  });

  const url = `${CA_STATEWIDE_URL}/query?${params}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to query parcels: ${response.status}`);
  }

  const data = (await response.json()) as any;

  if (!data.features || data.features.length === 0) {
    throw new Error(`No parcel found for address: ${address}`);
  }

  // Take first match
  const feature = data.features[0];
  const attrs = feature.attributes;

  console.log(`✅ Found parcel:`);
  console.log(`   Address: ${attrs.SITE_ADDR || 'N/A'}`);
  console.log(`   APN: ${attrs.PARCEL_APN || 'N/A'}`);
  console.log(`   County: ${attrs.COUNTYNAME || 'N/A'}`);
  console.log(`   City: ${attrs.SITE_CITY || 'N/A'}`);

  return {
    apn: attrs.PARCEL_APN,
    county: attrs.COUNTYNAME,
    city: attrs.SITE_CITY || 'Unknown',
    parcelFeature: feature,
  };
}

/**
 * Calculate parcel dimensions
 */
function calculateDimensions(geometry: any): { width: number; depth: number } {
  const polygon = turf.polygon(geometry.rings);
  const bbox = turf.bbox(polygon);
  const [minX, minY, maxX, maxY] = bbox;

  // Convert from degrees to feet (approximate)
  const width = Math.round((maxX - minX) * 364000);
  const depth = Math.round((maxY - minY) * 365000);

  return { width, depth };
}

/**
 * Determine data quality based on source and completeness
 */
function assessDataQuality(buildings: any[], zoningConfidence: number): 'high' | 'medium' | 'low' {
  if (buildings.length > 0 && buildings[0].source === 'OpenStreetMap' && zoningConfidence > 80) {
    return 'high';
  } else if (buildings.length > 0 && zoningConfidence > 60) {
    return 'medium';
  }
  return 'low';
}

/**
 * Get market metrics for a location
 */
function getMarketMetrics(
  county: string,
  city: string,
): {
  vacancy_rate: number;
  days_on_market: number;
  yoy_growth: number;
  rent_psf: number;
} {
  // Market data by county/city (these would normally come from a service)
  const markets: Record<string, any> = {
    'LOS ANGELES': {
      default: { vacancy_rate: 0.04, days_on_market: 25, yoy_growth: 5, rent_psf: 3.0 },
      'Los Angeles': { vacancy_rate: 0.035, days_on_market: 20, yoy_growth: 6, rent_psf: 3.5 },
      Winnetka: { vacancy_rate: 0.045, days_on_market: 28, yoy_growth: 4.5, rent_psf: 2.8 },
    },
    'SAN DIEGO': {
      default: { vacancy_rate: 0.035, days_on_market: 22, yoy_growth: 7, rent_psf: 3.2 },
      'San Diego': { vacancy_rate: 0.03, days_on_market: 18, yoy_growth: 8, rent_psf: 3.5 },
    },
    VENTURA: {
      default: { vacancy_rate: 0.04, days_on_market: 30, yoy_growth: 4, rent_psf: 2.5 },
    },
  };

  const countyData = markets[county] || markets['LOS ANGELES'];
  const cityData = countyData[city] || countyData.default;

  return cityData;
}

/**
 * Analyze property for ADU buildability with comprehensive metrics
 */
async function analyzeProperty(address: string): Promise<PropertyAnalysis> {
  console.log('\n' + '='.repeat(70));
  console.log('🏠 PROPERTY ANALYSIS');
  console.log('='.repeat(70));
  console.log(`📍 Address: ${address}\n`);

  // 1. Resolve address to parcel data
  console.log('Step 1: Resolving address to parcel...');
  const { apn, county, city, parcelFeature } = await resolveAddressToParcel(address);
  const parcelGeometry = parcelFeature.geometry;
  const parcelAttrs = parcelFeature.attributes;

  // Convert Esri geometry to GeoJSON format
  const geoJSONGeometry = {
    type: 'Polygon',
    coordinates: parcelGeometry.rings,
  };

  // Calculate parcel metrics using geometry
  const parcelPolygon = turf.polygon(geoJSONGeometry.coordinates);
  const parcelArea = Math.round(turf.area(parcelPolygon) * 10.7639); // Convert to sqft
  const dimensions = calculateDimensions(parcelGeometry);

  console.log(`  ✅ Lot Size: ${parcelArea.toLocaleString()} sqft`);
  console.log(`  ✅ Dimensions: ~${dimensions.width}' x ${dimensions.depth}'`);

  // 2. Get enhanced zoning information
  console.log('\nStep 2: Getting enhanced zoning data...');
  const parcelGeoJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: geoJSONGeometry,
        properties: parcelAttrs,
      },
    ],
  };

  const zoningResult = await getEnhancedZoning(parcelGeoJSON);
  const zoningReqs = getZoningRequirementsFromResult(zoningResult);

  const zoningConfidence = zoningResult.verified ? 95 : zoningResult.source === 'ArcGIS' ? 85 : 70;

  console.log(`  ✅ Zone: ${zoningResult.zone_code} (${zoningResult.source})`);
  console.log(`  ✅ Description: ${zoningResult.description || zoningResult.zone_name || 'N/A'}`);
  console.log(`  ✅ Confidence: ${zoningConfidence}%`);

  // 3. Get real building footprints from OSM
  console.log('\nStep 3: Fetching building footprints (OpenStreetMap)...');
  const buildings = await getBuildingFootprints(parcelGeometry, county, apn);

  const totalBuildingArea = buildings.reduce((sum, b) => sum + b.area_sqft, 0);
  const dataQuality = assessDataQuality(buildings, zoningConfidence);

  console.log(`  ✅ Buildings Found: ${buildings.length}`);
  console.log(`  ✅ Total Building Area: ${totalBuildingArea.toLocaleString()} sqft`);
  console.log(`  ✅ Data Source: ${buildings[0]?.source || 'N/A'}`);
  console.log(`  ✅ Data Quality: ${dataQuality}`);

  // 4. Calculate buildable area using formula library
  console.log('\nStep 4: Calculating buildable area (using formulas)...');

  // Use directional setbacks from zoning - handle missing values
  const setbacks = {
    front: zoningReqs?.front_setback || 20,
    side: zoningReqs?.side_setback || 5,
    rear: zoningReqs?.rear_setback || 15,
  };

  // Calculate envelope using formula
  const buildableEnvelope = calcBuildableEnvelope(
    dimensions.width,
    dimensions.depth,
    setbacks.front,
    setbacks.side,
    setbacks.rear,
  );

  // Calculate net buildable area
  const netBuildableArea = calcNetBuildableArea(
    buildableEnvelope,
    totalBuildingArea,
    parcelArea * 0.1, // 10% required open space
  );

  // Calculate maximum allowed ADU size
  const maxADUSize = calcMaxADUSize(
    parcelArea,
    zoningReqs?.max_adu_size || 1200,
    zoningReqs?.max_lot_coverage || 0.4,
  );

  // Recommended ADU size (80% of available or max allowed)
  const recommendedADUSize = Math.min(maxADUSize, Math.floor(netBuildableArea * 0.8));

  // Check viability
  const viable = isADUViable(netBuildableArea, 770);

  console.log(
    `  ✅ Setbacks: Front ${setbacks.front}', Side ${setbacks.side}', Rear ${setbacks.rear}'`,
  );
  console.log(`  ✅ Buildable Envelope: ${buildableEnvelope.toLocaleString()} sqft`);
  console.log(`  ✅ Net Buildable Area: ${netBuildableArea.toLocaleString()} sqft`);
  console.log(`  ✅ Max ADU Size: ${maxADUSize} sqft`);
  console.log(`  ✅ Recommended ADU: ${recommendedADUSize} sqft`);
  console.log(`  ${viable ? '✅' : '⚠️'} Viable for ADU (≥770 sqft): ${viable ? 'YES' : 'NO'}`);

  // 5. Financial analysis using formula library
  console.log('\nStep 5: Financial Analysis...');

  // Get market metrics
  const marketMetrics = getMarketMetrics(county, city);

  // Calculate development costs
  const costPerSqft = county === 'SAN DIEGO' ? 275 : county === 'LOS ANGELES' ? 250 : 225;
  const totalCost = calcTotalDevelopmentCost(recommendedADUSize, costPerSqft);

  // Calculate rental income
  const monthlyRent = calcMonthlyRent(recommendedADUSize, marketMetrics.rent_psf, 1500, 5000);

  // Calculate NOI and returns
  const annualNOI = calcAnnualNOI(monthlyRent, marketMetrics.vacancy_rate, 0.3);

  const capRate = calcCapRate(annualNOI, totalCost);
  const paybackMonths = calcPaybackMonths(totalCost, annualNOI / 12);

  // Financing calculations (80% LTV, 7% interest)
  const loanAmount = totalCost * 0.8;
  const cashRequired = totalCost * 0.2;
  const loanPayment = calcLoanPayment(loanAmount, 0.07, 30);
  const monthlyCashFlow = calcMonthlyCashFlow(monthlyRent, loanPayment, monthlyRent * 0.1);
  const cashOnCash = calcCashOnCashReturn(monthlyCashFlow * 12, cashRequired);

  console.log(`  ✅ Total Development Cost: ${formatCurrency(totalCost)}`);
  console.log(`  ✅ Monthly Rent: ${formatCurrency(monthlyRent)}`);
  console.log(`  ✅ Annual NOI: ${formatCurrency(annualNOI)}`);
  console.log(`  ✅ Cap Rate: ${formatPercent(capRate)}`);
  console.log(`  ✅ Payback: ${paybackMonths} months`);
  console.log(`  ✅ Cash-on-Cash Return: ${formatPercent(cashOnCash)}`);

  // 6. Scoring and opportunity analysis
  console.log('\nStep 6: Opportunity Scoring...');

  // Calculate unused space and hidden value
  const lotCoverage = calcLotCoverage(totalBuildingArea, parcelArea);
  const unusedSpace = calcUnusedSpace(parcelArea, totalBuildingArea);
  const hiddenValue = calcHiddenValue(unusedSpace, recommendedADUSize, monthlyRent);

  // Calculate scores
  const developmentEase = viable ? 8 : 3;
  const ownerLikelihood = capRate > 8 ? 9 : capRate > 6 ? 7 : 5;
  const opportunityScore = calcOpportunityScore(hiddenValue, developmentEase, ownerLikelihood);

  const marketStability = 100 - marketMetrics.vacancy_rate * 100;
  const constructionComplexity = netBuildableArea > 1000 ? 3 : 5;
  const riskScore = calcRiskScore(
    zoningConfidence,
    dataQuality === 'high' ? 90 : dataQuality === 'medium' ? 70 : 50,
    marketStability,
    constructionComplexity,
  );

  const dealScore = calcDealScore(capRate, paybackMonths, riskScore);
  const rentalDemandScore = calcRentalDemandScore(
    marketMetrics.vacancy_rate,
    marketMetrics.days_on_market,
    marketMetrics.yoy_growth,
  );

  console.log(`  ✅ Hidden Value (Annual): ${formatCurrency(hiddenValue)}`);
  console.log(`  ✅ Opportunity Score: ${opportunityScore}/10`);
  console.log(`  ✅ Deal Score: ${dealScore}/10`);
  console.log(`  ✅ Risk Score: ${riskScore}/10 (lower is better)`);
  console.log(`  ✅ Rental Demand: ${rentalDemandScore}/10`);

  // Compile comprehensive analysis
  const analysis: PropertyAnalysis = {
    address,
    apn,
    county,
    city,

    parcel: {
      area_sqft: parcelArea,
      dimensions,
      geometry: geoJSONGeometry,
      lot_coverage_percent: lotCoverage,
      unused_space_sqft: unusedSpace,
    },

    zoning: {
      zone_code: zoningResult.zone_code,
      zone_name: zoningResult.zone_name || zoningResult.description,
      source: zoningResult.source,
      confidence: zoningConfidence,
      verified: zoningResult.verified,
      max_adu_size: zoningReqs?.max_adu_size || 1200,
      setback_requirements: setbacks,
    },

    buildings: {
      count: buildings.length,
      total_area_sqft: totalBuildingArea,
      source: buildings[0]?.source || 'N/A',
      checksum: buildings[0]?.checksum || 'N/A',
      data_quality: dataQuality,
      details: buildings.map((b) => ({
        id: b.id,
        area_sqft: b.area_sqft,
        building_type: b.type || 'residential',
      })),
    },

    buildable: {
      envelope_sqft: buildableEnvelope,
      net_buildable_sqft: netBuildableArea,
      max_adu_size: maxADUSize,
      recommended_adu_size: recommendedADUSize,
      envelope_strategy: 'directional',
      viable_for_adu: viable,
      viability_threshold: 770,
    },

    financial: {
      development_cost: totalCost * 0.83, // Base construction
      site_work_cost: totalCost * 0.05,
      soft_costs: totalCost * 0.12,
      total_project_cost: totalCost,

      monthly_rent: monthlyRent,
      annual_gross_income: monthlyRent * 12,
      annual_noi: annualNOI,

      cap_rate: capRate,
      payback_months: paybackMonths,

      loan_amount: loanAmount,
      cash_required: cashRequired,
      monthly_payment: loanPayment,
      monthly_cash_flow: monthlyCashFlow,
      cash_on_cash_return: cashOnCash,
    },

    market: {
      rental_demand_score: rentalDemandScore,
      vacancy_rate: marketMetrics.vacancy_rate,
      days_on_market: marketMetrics.days_on_market,
      yoy_growth: marketMetrics.yoy_growth,
      market_rent_psf: marketMetrics.rent_psf,
    },

    scoring: {
      opportunity_score: opportunityScore,
      deal_score: dealScore,
      risk_score: riskScore,
      development_ease: developmentEase,
      owner_likelihood: ownerLikelihood,
      hidden_value_annual: hiddenValue,
    },

    report: {
      generated_at: new Date().toISOString(),
      analysis_version: '2.0-enhanced',
      data_sources: [
        'CA Statewide Parcels',
        `Enhanced Zoning (${zoningResult.source})`,
        'OpenStreetMap Buildings',
        'Formula Library v1.0',
      ],
    },
  };

  return analysis;
}

/**
 * Generate comprehensive CSV with prospecting template
 */
function generateProspectingCSV(analyses: PropertyAnalysis[]): string {
  const headers = [
    'Address',
    'City',
    'County',
    'APN',
    'Lot Size (sqft)',
    'Zone Code',
    'Zone Source',
    'Zone Confidence',
    'Building Count',
    'Building Area (sqft)',
    'Data Quality',
    'Buildable Envelope (sqft)',
    'Net Buildable (sqft)',
    'Max ADU Size',
    'Recommended ADU',
    'Viable (Y/N)',
    'Total Cost',
    'Monthly Rent',
    'Annual NOI',
    'Cap Rate (%)',
    'Payback (months)',
    'Cash Required',
    'Monthly Cash Flow',
    'Cash-on-Cash (%)',
    'Hidden Value (Annual)',
    'Opportunity Score',
    'Deal Score',
    'Risk Score',
    'Rental Demand Score',
    'Market Rent PSF',
  ];

  const rows = analyses.map((a) => [
    a.address,
    a.city,
    a.county,
    a.apn,
    a.parcel.area_sqft,
    a.zoning.zone_code,
    a.zoning.source,
    a.zoning.confidence,
    a.buildings.count,
    a.buildings.total_area_sqft,
    a.buildings.data_quality,
    a.buildable.envelope_sqft,
    a.buildable.net_buildable_sqft,
    a.buildable.max_adu_size,
    a.buildable.recommended_adu_size,
    a.buildable.viable_for_adu ? 'Y' : 'N',
    a.financial.total_project_cost,
    a.financial.monthly_rent,
    a.financial.annual_noi,
    a.financial.cap_rate,
    a.financial.payback_months,
    a.financial.cash_required,
    a.financial.monthly_cash_flow,
    a.financial.cash_on_cash_return,
    a.scoring.hidden_value_annual,
    a.scoring.opportunity_score,
    a.scoring.deal_score,
    a.scoring.risk_score,
    a.market.rental_demand_score,
    a.market.market_rent_psf,
  ]);

  return [headers, ...rows].map((row) => row.join(',')).join('\n');
}

/**
 * Generate enhanced HTML report with all metrics
 */
function generateEnhancedHTML(analyses: PropertyAnalysis[]): string {
  const viableProperties = analyses.filter((a) => a.buildable.viable_for_adu);
  const avgCapRate = analyses.reduce((sum, a) => sum + a.financial.cap_rate, 0) / analyses.length;
  const totalHiddenValue = analyses.reduce((sum, a) => sum + a.scoring.hidden_value_annual, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ADU Feasibility Analysis - Enhanced Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #2c3e50;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        }
        .container {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .summary-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            font-size: 14px;
            opacity: 0.9;
            text-transform: uppercase;
        }
        .summary-card .value {
            font-size: 28px;
            font-weight: bold;
        }
        .property-card {
            background: #f8f9fa;
            border-left: 4px solid #3498db;
            padding: 20px;
            margin: 20px 0;
            border-radius: 8px;
        }
        .property-card.viable {
            border-left-color: #27ae60;
            background: #d4edda;
        }
        .property-card h3 {
            margin-top: 0;
            color: #2c3e50;
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 15px 0;
        }
        .metric-item {
            background: white;
            padding: 10px;
            border-radius: 5px;
            border: 1px solid #e0e0e0;
        }
        .metric-label {
            font-size: 12px;
            color: #7f8c8d;
            text-transform: uppercase;
        }
        .metric-value {
            font-size: 18px;
            font-weight: bold;
            color: #3498db;
        }
        .score-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
        }
        .score-high { background: #27ae60; color: white; }
        .score-medium { background: #f39c12; color: white; }
        .score-low { background: #e74c3c; color: white; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background: #3498db;
            color: white;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #7f8c8d;
            font-size: 14px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏠 ADU Feasibility Analysis Report</h1>

        <div class="summary-grid">
            <div class="summary-card">
                <h3>Properties Analyzed</h3>
                <div class="value">${analyses.length}</div>
            </div>
            <div class="summary-card">
                <h3>Viable for ADU</h3>
                <div class="value">${viableProperties.length}/${analyses.length}</div>
            </div>
            <div class="summary-card">
                <h3>Avg Cap Rate</h3>
                <div class="value">${avgCapRate.toFixed(1)}%</div>
            </div>
            <div class="summary-card">
                <h3>Total Hidden Value</h3>
                <div class="value">${formatCurrency(totalHiddenValue)}</div>
            </div>
        </div>

        <h2>📊 Property Analysis Details</h2>
        ${analyses
          .map(
            (a) => `
            <div class="property-card ${a.buildable.viable_for_adu ? 'viable' : ''}">
                <h3>${a.address}</h3>
                <p><strong>APN:</strong> ${a.apn} | <strong>County:</strong> ${a.county} | <strong>City:</strong> ${a.city}</p>

                <div class="metrics-grid">
                    <div class="metric-item">
                        <div class="metric-label">Lot Size</div>
                        <div class="metric-value">${a.parcel.area_sqft.toLocaleString()} sqft</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Zone</div>
                        <div class="metric-value">${a.zoning.zone_code}</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Net Buildable</div>
                        <div class="metric-value">${a.buildable.net_buildable_sqft.toLocaleString()} sqft</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">ADU Size</div>
                        <div class="metric-value">${a.buildable.recommended_adu_size} sqft</div>
                    </div>
                </div>

                <h4>💰 Financial Metrics</h4>
                <div class="metrics-grid">
                    <div class="metric-item">
                        <div class="metric-label">Total Cost</div>
                        <div class="metric-value">${formatCurrency(a.financial.total_project_cost)}</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Monthly Rent</div>
                        <div class="metric-value">${formatCurrency(a.financial.monthly_rent)}</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Cap Rate</div>
                        <div class="metric-value">${a.financial.cap_rate.toFixed(1)}%</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Cash-on-Cash</div>
                        <div class="metric-value">${a.financial.cash_on_cash_return.toFixed(1)}%</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Payback</div>
                        <div class="metric-value">${a.financial.payback_months} months</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-label">Hidden Value</div>
                        <div class="metric-value">${formatCurrency(a.scoring.hidden_value_annual)}/yr</div>
                    </div>
                </div>

                <h4>📈 Scoring</h4>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span>Opportunity: <span class="score-badge ${a.scoring.opportunity_score >= 7 ? 'score-high' : a.scoring.opportunity_score >= 5 ? 'score-medium' : 'score-low'}">${a.scoring.opportunity_score}/10</span></span>
                    <span>Deal: <span class="score-badge ${a.scoring.deal_score >= 7 ? 'score-high' : a.scoring.deal_score >= 5 ? 'score-medium' : 'score-low'}">${a.scoring.deal_score}/10</span></span>
                    <span>Risk: <span class="score-badge ${a.scoring.risk_score <= 3 ? 'score-high' : a.scoring.risk_score <= 6 ? 'score-medium' : 'score-low'}">${a.scoring.risk_score}/10</span></span>
                    <span>Demand: <span class="score-badge ${a.market.rental_demand_score >= 7 ? 'score-high' : a.market.rental_demand_score >= 5 ? 'score-medium' : 'score-low'}">${a.market.rental_demand_score}/10</span></span>
                </div>

                <p style="margin-top: 15px;">
                    <strong>Data Quality:</strong> ${a.buildings.data_quality} |
                    <strong>Zoning Confidence:</strong> ${a.zoning.confidence}% |
                    <strong>Building Source:</strong> ${a.buildings.source}
                </p>
            </div>
        `,
          )
          .join('')}

        <h2>🎯 Investment Summary</h2>
        <table>
            <thead>
                <tr>
                    <th>Address</th>
                    <th>Viable</th>
                    <th>Total Cost</th>
                    <th>Annual NOI</th>
                    <th>Cap Rate</th>
                    <th>Opportunity Score</th>
                </tr>
            </thead>
            <tbody>
                ${analyses
                  .map(
                    (a) => `
                    <tr>
                        <td>${a.address}</td>
                        <td>${a.buildable.viable_for_adu ? '✅ Yes' : '⚠️ No'}</td>
                        <td>${formatCurrency(a.financial.total_project_cost)}</td>
                        <td>${formatCurrency(a.financial.annual_noi)}</td>
                        <td>${a.financial.cap_rate.toFixed(1)}%</td>
                        <td>${a.scoring.opportunity_score}/10</td>
                    </tr>
                `,
                  )
                  .join('')}
            </tbody>
        </table>

        <div class="footer">
            <p>Report Generated: ${new Date().toLocaleString()}<br>
            Analysis Version: 2.0-enhanced<br>
            Data Sources: CA Statewide Parcels, Enhanced Zoning Service, OpenStreetMap, ADU Formula Library v1.0<br>
            Powered by Backyard Scout ADU Analysis System</p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Main execution
 */
async function main() {
  const addresses = [
    '20616 Archwood St, Winnetka, CA, 91306',
    '10921 Polaris Dr, San Diego, CA, 92126',
    '1843 S Bedford St, Los Angeles, CA, 90035',
  ];

  console.log('🏠 Starting Enhanced ADU Feasibility Analysis');
  console.log('📋 Using Formula Library for All Calculations');
  console.log(`📍 Analyzing ${addresses.length} properties...\n`);

  const analyses: PropertyAnalysis[] = [];

  for (const address of addresses) {
    try {
      const analysis = await analyzeProperty(address);
      analyses.push(analysis);

      console.log('\n' + '='.repeat(70));
      if (analysis.buildable.viable_for_adu) {
        console.log('✅ PROPERTY IS VIABLE FOR ADU DEVELOPMENT');
        console.log(
          `   ${analysis.buildable.net_buildable_sqft.toLocaleString()} sqft buildable area`,
        );
        console.log(`   Recommended ${analysis.buildable.recommended_adu_size} sqft ADU`);
        console.log(`   ${formatCurrency(analysis.financial.monthly_rent)}/month rental income`);
        console.log(`   ${analysis.financial.cap_rate.toFixed(1)}% cap rate`);
        console.log(`   Opportunity Score: ${analysis.scoring.opportunity_score}/10`);
      } else {
        console.log('⚠️ PROPERTY HAS LIMITED ADU POTENTIAL');
        console.log(
          `   Only ${analysis.buildable.net_buildable_sqft.toLocaleString()} sqft buildable (need ≥770 sqft)`,
        );
        console.log(`   Consider alternative strategies (JADU, garage conversion)`);
      }
      console.log('='.repeat(70) + '\n');
    } catch (error) {
      console.error(`❌ Error analyzing ${address}:`, error);
    }
  }

  // Create output directory
  const outDir = '/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA/backyard-scout/out';
  await fs.mkdir(outDir, { recursive: true });

  // Save individual JSON reports
  for (const analysis of analyses) {
    const fileName = `enhanced_analysis_${analysis.apn}.json`;
    const jsonPath = `${outDir}/${fileName}`;
    await fs.writeFile(jsonPath, JSON.stringify(analysis, null, 2), 'utf-8');
    console.log(`✅ JSON report saved: ${jsonPath}`);
  }

  // Save prospecting CSV
  const csvContent = generateProspectingCSV(analyses);
  const csvPath = `${outDir}/adu_prospecting_results.csv`;
  await fs.writeFile(csvPath, csvContent, 'utf-8');
  console.log(`✅ Prospecting CSV saved: ${csvPath}`);

  // Save enhanced HTML report
  const htmlContent = generateEnhancedHTML(analyses);
  const htmlPath = `${outDir}/adu_analysis_enhanced.html`;
  await fs.writeFile(htmlPath, htmlContent, 'utf-8');
  console.log(`✅ Enhanced HTML report saved: ${htmlPath}`);

  // Final summary
  const viableCount = analyses.filter((a) => a.buildable.viable_for_adu).length;
  const avgOpportunityScore =
    analyses.reduce((sum, a) => sum + a.scoring.opportunity_score, 0) / analyses.length;
  const totalHiddenValue = analyses.reduce((sum, a) => sum + a.scoring.hidden_value_annual, 0);

  console.log('\n' + '='.repeat(70));
  console.log('🎯 FINAL SUMMARY');
  console.log('='.repeat(70));
  console.log(`   Properties Analyzed: ${analyses.length}`);
  console.log(
    `   Viable for ADU: ${viableCount}/${analyses.length} (${Math.round((viableCount / analyses.length) * 100)}%)`,
  );
  console.log(`   Average Opportunity Score: ${avgOpportunityScore.toFixed(1)}/10`);
  console.log(`   Total Hidden Value: ${formatCurrency(totalHiddenValue)}/year`);
  console.log(`\n   Reports Generated:`);
  console.log(`   - Individual JSON reports (detailed data)`);
  console.log(`   - Prospecting CSV (for data analysis)`);
  console.log(`   - Enhanced HTML report (comprehensive view)`);
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
