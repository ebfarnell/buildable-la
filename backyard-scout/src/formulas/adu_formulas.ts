/**
 * ADU Analysis Formula Library
 * Standardized calculations for ADU feasibility analysis
 * All formulas return deterministic results
 */

// ============================================
// BUILDABLE AREA CALCULATIONS
// ============================================

/**
 * Calculate buildable envelope based on setbacks
 * @returns Square footage of buildable envelope
 */
export function calcBuildableEnvelope(
  lotWidth: number,
  lotDepth: number,
  frontSetback: number,
  sideSetback: number,
  rearSetback: number,
): number {
  const buildableWidth = Math.max(0, lotWidth - sideSetback * 2);
  const buildableDepth = Math.max(0, lotDepth - frontSetback - rearSetback);
  return Math.round(buildableWidth * buildableDepth);
}

/**
 * Calculate net buildable area after subtracting existing structures
 * @returns Square footage available for ADU
 */
export function calcNetBuildableArea(
  buildableEnvelope: number,
  existingBuildingSqft: number,
  requiredOpenSpace: number = 0,
): number {
  return Math.max(0, buildableEnvelope - existingBuildingSqft - requiredOpenSpace);
}

/**
 * Calculate maximum ADU size based on regulations
 * @returns Maximum allowed ADU square footage
 */
export function calcMaxADUSize(
  lotSizeSqft: number,
  zoneMaxSqft: number = 1200,
  maxLotCoveragePercent: number = 0.4,
): number {
  const lotCoverageMax = lotSizeSqft * maxLotCoveragePercent;
  return Math.min(zoneMaxSqft, lotCoverageMax, 1200); // CA state max is 1200 sqft
}

/**
 * Check if ADU is viable based on minimum size
 * @returns Boolean indicating viability
 */
export function isADUViable(netBuildableArea: number, minADUSqft: number = 770): boolean {
  return netBuildableArea >= minADUSqft;
}

// ============================================
// FINANCIAL CALCULATIONS
// ============================================

/**
 * Calculate total development cost
 * @returns Total all-in development cost
 */
export function calcTotalDevelopmentCost(
  aduSqft: number,
  costPerSqft: number = 150,
  siteWorkCost: number = 15000,
  softCostPercent: number = 0.2,
): number {
  const constructionCost = aduSqft * costPerSqft;
  const subtotal = constructionCost + siteWorkCost;
  const softCosts = subtotal * softCostPercent;
  return Math.round(subtotal + softCosts);
}

/**
 * Calculate monthly rental income
 * @returns Estimated monthly rent
 */
export function calcMonthlyRent(
  aduSqft: number,
  rentPerSqft: number = 3.0,
  minRent: number = 1500,
  maxRent: number = 5000,
): number {
  const calculatedRent = aduSqft * rentPerSqft;
  return Math.min(maxRent, Math.max(minRent, Math.round(calculatedRent)));
}

/**
 * Calculate annual Net Operating Income
 * @returns Annual NOI after expenses
 */
export function calcAnnualNOI(
  monthlyRent: number,
  vacancyRate: number = 0.05,
  operatingExpenseRate: number = 0.3,
): number {
  const annualGrossIncome = monthlyRent * 12;
  const effectiveGrossIncome = annualGrossIncome * (1 - vacancyRate);
  const operatingExpenses = effectiveGrossIncome * operatingExpenseRate;
  return Math.round(effectiveGrossIncome - operatingExpenses);
}

/**
 * Calculate Cap Rate
 * @returns Capitalization rate as percentage
 */
export function calcCapRate(annualNOI: number, totalCost: number): number {
  if (totalCost === 0) return 0;
  return Math.round((annualNOI / totalCost) * 1000) / 10; // Round to 1 decimal
}

/**
 * Calculate Cash-on-Cash Return
 * @returns Cash-on-cash return as percentage
 */
export function calcCashOnCashReturn(annualCashFlow: number, cashInvested: number): number {
  if (cashInvested === 0) return 0;
  return Math.round((annualCashFlow / cashInvested) * 1000) / 10;
}

/**
 * Calculate payback period
 * @returns Months to recover investment
 */
export function calcPaybackMonths(totalCost: number, monthlyNOI: number): number {
  if (monthlyNOI <= 0) return 999;
  return Math.round(totalCost / monthlyNOI);
}

/**
 * Calculate loan payment
 * @returns Monthly loan payment
 */
export function calcLoanPayment(
  loanAmount: number,
  annualInterestRate: number = 0.07,
  loanTermYears: number = 30,
): number {
  const monthlyRate = annualInterestRate / 12;
  const numPayments = loanTermYears * 12;

  if (monthlyRate === 0) return loanAmount / numPayments;

  const payment =
    (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  return Math.round(payment);
}

/**
 * Calculate monthly cash flow after debt service
 * @returns Monthly cash flow
 */
export function calcMonthlyCashFlow(
  monthlyRent: number,
  loanPayment: number,
  monthlyExpenses: number = 0,
): number {
  return monthlyRent - loanPayment - monthlyExpenses;
}

// ============================================
// SCORING & RANKING
// ============================================

/**
 * Calculate opportunity score for prospecting
 * @returns Score from 1-10
 */
export function calcOpportunityScore(
  hiddenValueAnnual: number,
  developmentEase: number, // 1-10
  ownerLikelihood: number, // 1-10
): number {
  // Normalize hidden value to 1-10 scale
  const valueScore = Math.min(10, hiddenValueAnnual / 10000);

  // Weighted average: 40% value, 30% ease, 30% owner
  const score = valueScore * 0.4 + developmentEase * 0.3 + ownerLikelihood * 0.3;
  return Math.round(score * 10) / 10; // Round to 1 decimal
}

/**
 * Calculate deal score for investment analysis
 * @returns Score from 1-10
 */
export function calcDealScore(
  capRate: number,
  paybackMonths: number,
  riskScore: number, // 1-10, lower is better
): number {
  // Normalize cap rate (0-20% → 0-10)
  const capRateScore = Math.min(10, capRate / 2);

  // Normalize payback (60 months = 5, 30 months = 10)
  const paybackScore = Math.max(0, Math.min(10, 10 - (paybackMonths - 30) / 6));

  // Invert risk score (lower risk = higher score)
  const safetyScore = 11 - riskScore;

  // Weighted average: 40% return, 30% payback, 30% safety
  const score = capRateScore * 0.4 + paybackScore * 0.3 + safetyScore * 0.3;
  return Math.round(score * 10) / 10;
}

/**
 * Calculate risk score
 * @returns Combined risk score 1-10
 */
export function calcRiskScore(
  zoningConfidence: number, // 0-100%
  buildingDataQuality: number, // 0-100%
  marketStability: number, // 0-100%
  constructionComplexity: number, // 1-10
): number {
  // Convert percentages to 1-10 scale
  const zoningRisk = 10 - zoningConfidence / 10;
  const dataRisk = 10 - buildingDataQuality / 10;
  const marketRisk = 10 - marketStability / 10;

  // Weighted average
  const score = zoningRisk * 0.3 + dataRisk * 0.2 + marketRisk * 0.2 + constructionComplexity * 0.3;

  return Math.round(score * 10) / 10;
}

// ============================================
// LOT ANALYSIS
// ============================================

/**
 * Calculate lot coverage percentage
 * @returns Current lot coverage as percentage
 */
export function calcLotCoverage(buildingSqft: number, lotSizeSqft: number): number {
  if (lotSizeSqft === 0) return 0;
  return Math.round((buildingSqft / lotSizeSqft) * 1000) / 10;
}

/**
 * Calculate unused lot space
 * @returns Unused square footage
 */
export function calcUnusedSpace(
  lotSizeSqft: number,
  buildingSqft: number,
  pavementSqft: number = 0,
): number {
  return Math.max(0, lotSizeSqft - buildingSqft - pavementSqft);
}

/**
 * Calculate lot regularity score
 * @returns Score 1-10 for lot shape regularity
 */
export function calcLotRegularity(lotWidth: number, lotDepth: number, actualArea: number): number {
  const rectangularArea = lotWidth * lotDepth;
  const irregularity = Math.abs(rectangularArea - actualArea) / actualArea;
  const score = Math.max(1, 10 - irregularity * 20);
  return Math.round(score * 10) / 10;
}

// ============================================
// MARKET ANALYSIS
// ============================================

/**
 * Calculate hidden value (annual opportunity cost)
 * @returns Annual income opportunity
 */
export function calcHiddenValue(
  unusedSqft: number,
  potentialADUSqft: number,
  monthlyRentPotential: number,
): number {
  if (unusedSqft < 770) return 0; // Not enough space for ADU
  const annualIncome = monthlyRentPotential * 12;
  return Math.round(annualIncome);
}

/**
 * Calculate rental demand score
 * @returns Score 1-10 based on market indicators
 */
export function calcRentalDemandScore(
  vacancyRate: number, // 0-1
  daysOnMarket: number, // Average days
  yearOverYearGrowth: number, // Percentage
): number {
  // Lower vacancy = higher demand
  const vacancyScore = (1 - vacancyRate) * 10;

  // Faster rental = higher demand (30 days = 10, 60 days = 5)
  const velocityScore = Math.max(0, 10 - (daysOnMarket - 30) / 3);

  // Growth rate (10% = 10, 0% = 5)
  const growthScore = Math.min(10, 5 + yearOverYearGrowth / 2);

  const score = vacancyScore * 0.4 + velocityScore * 0.3 + growthScore * 0.3;
  return Math.round(score * 10) / 10;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Calculate all metrics for a property
 * @returns Complete analysis object
 */
export function runCompleteAnalysis(inputs: {
  // Lot characteristics
  lotWidth: number;
  lotDepth: number;
  lotSizeSqft: number;
  existingBuildingSqft: number;

  // Setbacks
  frontSetback: number;
  sideSetback: number;
  rearSetback: number;

  // Financial inputs
  costPerSqft?: number;
  rentPerSqft?: number;
  loanToValue?: number;
  interestRate?: number;

  // Market inputs
  vacancyRate?: number;
  operatingExpenseRate?: number;
}) {
  // Calculate buildable area
  const buildableEnvelope = calcBuildableEnvelope(
    inputs.lotWidth,
    inputs.lotDepth,
    inputs.frontSetback,
    inputs.sideSetback,
    inputs.rearSetback,
  );

  const netBuildableArea = calcNetBuildableArea(buildableEnvelope, inputs.existingBuildingSqft);

  const maxADUSize = calcMaxADUSize(inputs.lotSizeSqft);
  const recommendedADUSize = Math.min(maxADUSize, netBuildableArea, 1000);
  const viable = isADUViable(netBuildableArea);

  // Calculate financials
  const totalCost = calcTotalDevelopmentCost(recommendedADUSize, inputs.costPerSqft);

  const monthlyRent = calcMonthlyRent(recommendedADUSize, inputs.rentPerSqft);

  const annualNOI = calcAnnualNOI(monthlyRent, inputs.vacancyRate, inputs.operatingExpenseRate);

  const capRate = calcCapRate(annualNOI, totalCost);
  const paybackMonths = calcPaybackMonths(totalCost, annualNOI / 12);

  // Calculate loan metrics
  const loanAmount = totalCost * (inputs.loanToValue || 0.8);
  const cashRequired = totalCost - loanAmount;
  const loanPayment = calcLoanPayment(loanAmount, inputs.interestRate);
  const monthlyCashFlow = calcMonthlyCashFlow(monthlyRent, loanPayment);
  const cashOnCash = calcCashOnCashReturn(monthlyCashFlow * 12, cashRequired);

  return {
    // Buildability
    buildableEnvelope,
    netBuildableArea,
    maxADUSize,
    recommendedADUSize,
    viable,

    // Financials
    totalCost,
    monthlyRent,
    annualNOI,
    capRate,
    paybackMonths,

    // Loan metrics
    loanAmount,
    cashRequired,
    loanPayment,
    monthlyCashFlow,
    cashOnCash,
  };
}
