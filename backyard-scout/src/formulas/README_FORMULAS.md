# 📐 ADU Formula Library

## Overview
Standardized, deterministic formulas for ADU feasibility analysis. Just plug in values and get consistent results.

---

## 🧮 Quick Formula Reference

### **Buildable Area Formulas**

```typescript
// Buildable envelope (after setbacks)
buildableEnvelope = (lotWidth - sideSetback*2) × (lotDepth - frontSetback - rearSetback)

// Net buildable area (after existing structures)
netBuildable = buildableEnvelope - existingBuildings - requiredOpenSpace

// Maximum ADU size
maxADU = MIN(1200, zoneMax, lotSize × maxCoverage%)

// ADU viability check
viable = netBuildable >= 770 sqft
```

### **Financial Formulas**

```typescript
// Development cost
totalCost = (aduSqft × $150) + siteWork + softCosts(20%)

// Monthly rent
rent = aduSqft × $3.00/sqft (min $1500, max $5000)

// Annual NOI
NOI = (rent × 12) × (1 - vacancy%) × (1 - expenses%)

// Cap Rate
capRate = NOI / totalCost × 100

// Payback period
paybackMonths = totalCost / (NOI / 12)
```

---

## 💻 Usage Examples

### **Basic Property Analysis**
```typescript
import * as formulas from './src/formulas/adu_formulas.js';

// Input variables
const lot = {
  width: 50,
  depth: 150,
  size: 7500,
  existingBuilding: 2000
};

const setbacks = {
  front: 20,
  side: 5,
  rear: 15
};

// Calculate buildable area
const buildableEnvelope = formulas.calcBuildableEnvelope(
  lot.width, lot.depth,
  setbacks.front, setbacks.side, setbacks.rear
);
// Result: 3,200 sqft

const netBuildable = formulas.calcNetBuildableArea(
  buildableEnvelope,
  lot.existingBuilding
);
// Result: 1,200 sqft

const viable = formulas.isADUViable(netBuildable);
// Result: true (1,200 > 770)
```

### **Financial Analysis**
```typescript
// Calculate investment metrics
const aduSize = 1000;
const totalCost = formulas.calcTotalDevelopmentCost(aduSize);
// Result: $195,000

const monthlyRent = formulas.calcMonthlyRent(aduSize);
// Result: $3,000

const annualNOI = formulas.calcAnnualNOI(monthlyRent);
// Result: $23,940

const capRate = formulas.calcCapRate(annualNOI, totalCost);
// Result: 12.3%

const paybackMonths = formulas.calcPaybackMonths(totalCost, annualNOI/12);
// Result: 98 months
```

### **Complete Analysis**
```typescript
// Run all calculations at once
const analysis = formulas.runCompleteAnalysis({
  lotWidth: 50,
  lotDepth: 150,
  lotSizeSqft: 7500,
  existingBuildingSqft: 2000,
  frontSetback: 20,
  sideSetback: 5,
  rearSetback: 15,
  costPerSqft: 150,
  rentPerSqft: 3.0,
  loanToValue: 0.8,
  interestRate: 0.07
});

console.log(analysis);
// Returns complete object with all metrics
```

---

## 📊 Formula Parameters

### **Default Values**
| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| costPerSqft | $150 | $100-300 | Varies by finish level |
| rentPerSqft | $3.00 | $2-5 | Market dependent |
| minADUSize | 770 sqft | 600-770 | CA minimum |
| maxADUSize | 1,200 sqft | 800-1200 | CA maximum |
| vacancyRate | 5% | 3-10% | Market average |
| operatingExpenses | 30% | 25-35% | Of gross income |
| loanToValue | 80% | 70-90% | Typical ADU loan |
| interestRate | 7% | 5-9% | Current rates |
| softCostPercent | 20% | 15-25% | Permits, design, etc |

### **Scoring Scales**
| Score Type | Scale | Excellent | Good | Fair | Poor |
|------------|-------|-----------|------|------|------|
| Opportunity | 1-10 | 8-10 | 6-8 | 4-6 | <4 |
| Deal Score | 1-10 | 8-10 | 6-8 | 4-6 | <4 |
| Risk Score | 1-10 | 1-3 | 3-5 | 5-7 | >7 |
| Cap Rate | % | >15% | 12-15% | 8-12% | <8% |
| Payback | Months | <60 | 60-84 | 84-120 | >120 |

---

## 🎯 Decision Thresholds

### **Go/No-Go Criteria**
```typescript
// Minimum requirements for GO decision
const GO_CRITERIA = {
  netBuildable: >= 770,      // Minimum ADU size
  capRate: >= 10,            // Minimum return
  paybackMonths: <= 120,     // Maximum 10 years
  dealScore: >= 6.0,         // Minimum quality
  riskScore: <= 7.0          // Maximum risk
};

// Automatic NO-GO conditions
const NO_GO = {
  netBuildable: < 600,       // Too small
  existingCoverage: > 50%,   // Over-built
  capRate: < 6%,            // Poor return
  paybackMonths: > 180       // Too long
};
```

### **Prospecting Priorities**
```typescript
// HIGH Priority (pursue aggressively)
opportunityScore >= 8.0 && unusedSpace >= 3000

// MEDIUM Priority (worth pursuing)
opportunityScore >= 6.0 && unusedSpace >= 2000

// LOW Priority (only if easy)
opportunityScore >= 4.0 || unusedSpace < 2000
```

---

## 🔧 Integration with Templates

The formula library outputs directly map to CSV template columns:

```typescript
// Map formula outputs to CSV columns
const csvRow = {
  // From buildable area calcs
  buildable_envelope_sqft: analysis.buildableEnvelope,
  net_buildable_area_sqft: analysis.netBuildableArea,
  max_adu_size: analysis.maxADUSize,
  adu_viable: analysis.viable ? 'YES' : 'NO',

  // From financial calcs
  total_development_cost: analysis.totalCost,
  estimated_monthly_rent: analysis.monthlyRent,
  annual_noi: analysis.annualNOI,
  cap_rate: analysis.capRate,
  payback_months: analysis.paybackMonths,

  // From scoring calcs
  opportunity_score: opportunityScore,
  deal_score: dealScore,
  risk_score: riskScore
};
```

---

## 🚀 Best Practices

1. **Always validate inputs** - Check for negative or zero values
2. **Use consistent units** - All areas in sqft, all money in USD
3. **Round appropriately** - Money to dollars, percentages to 0.1%
4. **Cache calculations** - Results are deterministic, so cache them
5. **Document assumptions** - Note when using default values

---

## 📈 Sensitivity Analysis

Test how changes affect outcomes:

```typescript
// Test rent sensitivity
[2.5, 3.0, 3.5, 4.0].forEach(rentPerSqft => {
  const rent = calcMonthlyRent(1000, rentPerSqft);
  const noi = calcAnnualNOI(rent);
  const cap = calcCapRate(noi, 195000);
  console.log(`$${rentPerSqft}/sqft → ${cap}% cap rate`);
});

// Test cost sensitivity
[125, 150, 175, 200].forEach(costPerSqft => {
  const cost = calcTotalDevelopmentCost(1000, costPerSqft);
  const cap = calcCapRate(23940, cost);
  console.log(`$${costPerSqft}/sqft → ${cap}% cap rate`);
});
```

---

**Remember:** These formulas ensure consistent analysis across all properties. The agent can rely on them for deterministic, reproducible results!