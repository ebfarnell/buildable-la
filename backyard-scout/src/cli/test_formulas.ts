/**
 * Test the ADU formula library
 */

import * as formulas from '../formulas/adu_formulas.js';

function testFormulas() {
  console.log('🧮 Testing ADU Formula Library');
  console.log('='.repeat(60));

  // Test property inputs
  const testInputs = {
    // Lot characteristics
    lotWidth: 50,
    lotDepth: 150,
    lotSizeSqft: 7500,
    existingBuildingSqft: 2000,

    // Setbacks
    frontSetback: 20,
    sideSetback: 5,
    rearSetback: 15,

    // Financial inputs
    costPerSqft: 150,
    rentPerSqft: 3.0,
    loanToValue: 0.8,
    interestRate: 0.07,
  };

  console.log('\n📏 Property Inputs:');
  console.log(
    `Lot: ${testInputs.lotWidth}' × ${testInputs.lotDepth}' = ${testInputs.lotSizeSqft} sqft`,
  );
  console.log(`Existing Building: ${testInputs.existingBuildingSqft} sqft`);
  console.log(
    `Setbacks: F=${testInputs.frontSetback}' S=${testInputs.sideSetback}' R=${testInputs.rearSetback}'`,
  );

  console.log('\n🏗️ Buildability Analysis:');
  const buildableEnvelope = formulas.calcBuildableEnvelope(
    testInputs.lotWidth,
    testInputs.lotDepth,
    testInputs.frontSetback,
    testInputs.sideSetback,
    testInputs.rearSetback,
  );
  console.log(`Buildable Envelope: ${buildableEnvelope.toLocaleString()} sqft`);

  const netBuildable = formulas.calcNetBuildableArea(
    buildableEnvelope,
    testInputs.existingBuildingSqft,
  );
  console.log(`Net Buildable Area: ${netBuildable.toLocaleString()} sqft`);

  const maxADUSize = formulas.calcMaxADUSize(testInputs.lotSizeSqft);
  console.log(`Maximum ADU Size: ${maxADUSize.toLocaleString()} sqft`);

  const recommendedADU = Math.min(maxADUSize, netBuildable, 1000);
  console.log(`Recommended ADU Size: ${recommendedADU.toLocaleString()} sqft`);

  const viable = formulas.isADUViable(netBuildable);
  console.log(`ADU Viable: ${viable ? '✅ YES' : '❌ NO'}`);

  console.log('\n💰 Financial Analysis:');
  const totalCost = formulas.calcTotalDevelopmentCost(recommendedADU, testInputs.costPerSqft);
  console.log(`Total Development Cost: ${formulas.formatCurrency(totalCost)}`);

  const monthlyRent = formulas.calcMonthlyRent(recommendedADU, testInputs.rentPerSqft);
  console.log(`Monthly Rent: ${formulas.formatCurrency(monthlyRent)}`);

  const annualNOI = formulas.calcAnnualNOI(monthlyRent);
  console.log(`Annual NOI: ${formulas.formatCurrency(annualNOI)}`);

  const capRate = formulas.calcCapRate(annualNOI, totalCost);
  console.log(`Cap Rate: ${formulas.formatPercent(capRate)}`);

  const paybackMonths = formulas.calcPaybackMonths(totalCost, annualNOI / 12);
  console.log(`Payback Period: ${paybackMonths} months (${(paybackMonths / 12).toFixed(1)} years)`);

  console.log('\n🏦 Financing Analysis:');
  const loanAmount = totalCost * testInputs.loanToValue;
  const cashRequired = totalCost - loanAmount;
  console.log(`Loan Amount (80% LTV): ${formulas.formatCurrency(loanAmount)}`);
  console.log(`Cash Required: ${formulas.formatCurrency(cashRequired)}`);

  const loanPayment = formulas.calcLoanPayment(loanAmount, testInputs.interestRate);
  console.log(`Monthly Loan Payment: ${formulas.formatCurrency(loanPayment)}`);

  const monthlyCashFlow = formulas.calcMonthlyCashFlow(monthlyRent, loanPayment);
  console.log(`Monthly Cash Flow: ${formulas.formatCurrency(monthlyCashFlow)}`);

  const cashOnCash = formulas.calcCashOnCashReturn(monthlyCashFlow * 12, cashRequired);
  console.log(`Cash-on-Cash Return: ${formulas.formatPercent(cashOnCash)}`);

  console.log('\n📊 Scoring Analysis:');

  const opportunityScore = formulas.calcOpportunityScore(
    annualNOI,
    7, // Development ease
    6, // Owner likelihood
  );
  console.log(`Opportunity Score: ${opportunityScore}/10`);

  const dealScore = formulas.calcDealScore(
    capRate,
    paybackMonths,
    4, // Risk score
  );
  console.log(`Deal Score: ${dealScore}/10`);

  const riskScore = formulas.calcRiskScore(
    85, // Zoning confidence
    95, // Building data quality
    80, // Market stability
    3, // Construction complexity
  );
  console.log(`Risk Score: ${riskScore}/10 (lower is better)`);

  console.log('\n🎯 Complete Analysis (All at once):');
  const completeAnalysis = formulas.runCompleteAnalysis(testInputs);

  console.log('Results:');
  Object.entries(completeAnalysis).forEach(([key, value]) => {
    if (typeof value === 'number') {
      if (
        key.includes('Cost') ||
        key.includes('Rent') ||
        key.includes('NOI') ||
        key.includes('loan') ||
        key.includes('cash')
      ) {
        console.log(`  ${key}: ${formulas.formatCurrency(value as number)}`);
      } else if (key.includes('Rate') || key.includes('Cash')) {
        console.log(`  ${key}: ${formulas.formatPercent(value as number)}`);
      } else {
        console.log(`  ${key}: ${(value as number).toLocaleString()}`);
      }
    } else {
      console.log(`  ${key}: ${value}`);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('✅ Formula Library Test Complete');
  console.log('All calculations are deterministic - same inputs = same outputs');
  console.log('='.repeat(60));
}

testFormulas();
