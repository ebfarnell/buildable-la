# 📊 ADU Analysis Templates Guide

## Overview
This directory contains CSV templates for different ADU analysis use cases, from technical feasibility to business development prospecting.

---

## 🎯 Template Selection Guide

### **For Prospecting & Deal Finding:**
Use: `adu_prospecting_template.csv`

**Purpose:** Find property owners who don't know they're sitting on ADU goldmines
- **Key Columns:** opportunity_score, hidden_value, pitch_angle, owner_info
- **Best For:** Cold outreach, direct mail campaigns, door knocking lists
- **Sort By:** opportunity_score DESC to find best deals first

**Example Use Case:**
```
"Your unused backyard could generate $43,200/year in passive income"
```

---

### **For Developer Analysis:**
Use: `developer_analysis_template.csv`

**Purpose:** Quick go/no-go decisions and financial analysis
- **Key Columns:** go_no_go, deal_score, cap_rate, irr_5yr, timeline_weeks
- **Best For:** Investment committees, loan applications, partner discussions
- **Sort By:** deal_score DESC or cap_rate DESC

**Decision Matrix:**
- GO = deal_score > 7.0 AND cap_rate > 12%
- MAYBE = deal_score 5.0-7.0 OR cap_rate 8-12%
- NO-GO = deal_score < 5.0 OR critical_issues present

---

### **For Comprehensive Analysis:**
Use: `MASTER_ADU_TEMPLATE.csv`

**Purpose:** Complete data capture for serious due diligence
- **100+ columns** covering every aspect
- **Best For:** Detailed reports, investor packages, permit applications
- **Includes:** Technical specs + financial analysis + prospecting data

---

## 📈 Key Metrics Explained

### **Opportunity Score (1-10)**
Composite score weighing:
- Income potential (40%)
- Development ease (30%)
- Owner likelihood to act (30%)

### **Deal Score (1-10)**
Investment quality rating:
- 8-10: Premium deals (pursue aggressively)
- 6-8: Good deals (worth pursuing)
- 4-6: Marginal (need special circumstances)
- <4: Pass

### **Hidden Value**
The annual income opportunity owners don't realize exists
- Calculation: (Buildable SQFT × Rent/SQFT × 12) - Current Use Value

### **Pitch Angle**
The compelling story for each property:
- **Income**: "Generate $X/month passive income"
- **Family**: "House aging parents while earning income"
- **Equity**: "Unlock $X in property value"
- **Tax**: "Offset property taxes with rental income"

---

## 🔄 Workflow Integration

### **1. Batch Analysis → Prospecting List**
```bash
# Run batch analysis
npx tsx src/batch_all.ts data/parcels_90210.jsonl 1000

# Export to prospecting template
npx tsx src/csv_export.ts prospects_90210.csv --template=prospecting
```

### **2. Filter High-Value Targets**
```sql
-- In SQLite or Excel
SELECT * FROM results
WHERE opportunity_score > 8
  AND owner_years > 10
  AND buildable_sqft > 800
ORDER BY hidden_value DESC
LIMIT 100;
```

### **3. Generate Outreach Lists**
- **Direct Mail**: Filter by owner_address != property_address
- **Door Knocking**: Filter by owner_address = property_address
- **Phone**: Filter by opportunity_score > 9

---

## 💡 Pro Tips

### **For Maximum Conversions:**
1. **Lead with Hidden Value**: "You have $43,200/year sitting in your backyard"
2. **Address Pain Points**: Match solution to owner's current problems
3. **Use Social Proof**: "Your neighbor at 123 Main St built one last month"
4. **Create Urgency**: "New ADU regulations make it easier than ever"

### **Red Flags to Note:**
- 🚩 Building data = "ESTIMATED" (needs field verification)
- 🚩 Zone confidence < 80% (verify with planning dept)
- 🚩 Multiple structures detected (complex site)
- 🚩 Lot coverage > 40% (limited remaining space)

### **Green Flags to Highlight:**
- ✅ Verified OSM building data
- ✅ Simple rectangular lot
- ✅ RS or R1 zoning (straightforward ADU rules)
- ✅ Large unused backyard (>3000 sqft buildable)
- ✅ Owner lived there >10 years (equity available)

---

## 📊 Template Customization

To add custom columns for your market:
```csv
# Add after standard columns:
,school_district,hoa_name,view_type,pool_exists,garage_conversion_potential,jadu_potential,solar_ready
```

Common market-specific additions:
- **Coastal areas**: tsunami_zone, coastal_commission
- **Fire areas**: fire_zone, defensible_space
- **Urban areas**: rent_control, ellis_act
- **Suburban**: hoa_restrictions, cc_and_rs

---

## 🎯 Success Metrics

Track your prospecting effectiveness:
- **Response Rate**: Contacts responded / Total outreach
- **Conversion Rate**: Deals closed / Qualified leads
- **Average Deal Size**: Total revenue / Deals closed
- **Time to Close**: Average days from first contact

Benchmark targets:
- Direct Mail: 1-3% response rate
- Cold Calling: 8-10% response rate
- Door Knocking: 15-20% response rate
- Conversion: 10-15% of qualified leads

---

**Remember:** The best ADU deal is one where everyone wins - owner gets income, tenant gets housing, developer makes profit, and community gains density!