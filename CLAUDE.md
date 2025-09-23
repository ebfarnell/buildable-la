# CLAUDE.md - Complete Project Instructions

## 🎯 PROJECT PURPOSE
This is the Buildable-LA property development analysis system for California. It analyzes properties for multiple development opportunities including:
- **ADU (Accessory Dwelling Unit)**: Adding a secondary unit on existing lot
- **Lot Subdivision/Splitting**: Dividing property into multiple parcels (SB 9)
- **Multi-Unit Development**: Building duplexes, triplexes, or fourplexes
- **Mixed Strategies**: Combining subdivision with multi-unit buildings

## ⚠️ CRITICAL INSTRUCTIONS

### 🎯 QUICK START - Master Script:
```bash
# Interactive menu to select the right tool
./analyze-property

# Or direct usage with auto-detection
./analyze-property "123 Main St, City, CA"          # Quick check
./analyze-property split --zip 91301                # Lot splitting
./analyze-property area --city "Agoura Hills"       # Area search
```

### 🛠️ TOOL SELECTION GUIDE - Choose the Right Tool:

#### 1. **Quick Feasibility Check** (`quick_check.ts`)
**Use when:** User wants a rapid assessment with minimal details
```bash
cd backyard-scout && npx tsx src/tools/quick_check.ts "address"
```
- ⚡ Single API call, instant results
- Returns: Basic viability status (🟢🟡🟠🔴)
- Best for: Initial screening, batch checking

#### 2. **Development Detailed Analysis** (`analyze_requested_properties.ts`)
**Use when:** User asks about ADU, duplex, or development feasibility
```bash
cd backyard-scout && npx tsx src/analyze_requested_properties.ts "address1" "address2"
```
- 🏠 Full development potential analysis (ADU/duplex/multi-unit)
- Returns: Setbacks, buildable area, financials, unit potential
- Best for: "Can I build an ADU/duplex/units at..."

#### 3. **Lot Splitting & Multi-Unit Analysis** (`lot_split_analyzer.ts`)
**Use when:** User asks about subdividing lots OR building multiple units
```bash
cd backyard-scout && npx tsx src/tools/lot_split_analyzer.ts --zip 91301 --min-size 20000
```
- ✂️ Finds properties for subdivision or multi-unit development
- Returns: Properties suitable for splitting or duplex/triplex/fourplex
- Best for: "Find lots I can split" or "build multiple units on"

#### 4. **Area-Wide ADU Search** (`area_adu_search.ts`)
**Use when:** User wants to find ALL ADU opportunities in an area
```bash
cd backyard-scout && npx tsx src/tools/area_adu_search.ts --zip 91301
cd backyard-scout && npx tsx src/tools/area_adu_search.ts --city "Agoura Hills"
```
- 🗺️ Scans entire neighborhoods/cities
- Returns: Ranked list of ADU opportunities
- Best for: "Find ADU opportunities in Old Agoura"

#### 5. **Property Comparison** (`property_compare.ts`)
**Use when:** User has multiple properties to compare
```bash
cd backyard-scout && npx tsx src/tools/property_compare.ts "addr1" "addr2" "addr3"
```
- 📊 Side-by-side comparison
- Returns: Rankings by ADU, splitting, investment
- Best for: "Which property is better..."

### NEVER USE WEB SEARCH FOR:
- Property feasibility/viability
- ADU/duplex/multi-unit analysis
- California addresses or properties
- Building/zoning lookups
- Buildable area calculations
- Development/subdivision potential
- SB 9 eligibility

## 📊 DATA SOURCES (USE THESE ONLY)

### Primary Sources:
1. **California Statewide Parcels API** ✅ WORKING - Parcel boundaries & APNs
   - URL: `https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0`
   - **STATUS: CRITICAL - System cannot operate without this**

2. **Zoneomics API** ❌ UNAVAILABLE - Zoning data
   - API key may be expired or service has changed
   - Documentation shows `zoneDetail` endpoint should work but returns 400 errors
   - **FALLBACK ACTIVE: Using default setbacks (20' front, 5' side, 15' rear)**
   - System remains fully operational with conservative zoning estimates

3. **Unified Building Detector** - Hierarchical building detection
   - Priority order:
     - County-specific endpoints (most accurate)
     - Microsoft Buildings (MSBFP2) - May timeout, but works
     - OpenStreetMap ✅ WORKING - Good urban coverage
     - Assessor data (LA County only)
     - **FALLBACK: 22% lot coverage estimate (always available)**

### ❌ DO NOT USE:
- LA County/City ArcGIS zoning endpoints (unreliable)
- Local estimate databases (incomplete)
- Any web search for property data

## 📁 PROJECT STRUCTURE
```
Buildable-LA/
├── analyze                      # Quick analysis script
├── CLAUDE.md                    # THIS FILE - Main instructions
├── BUILDING_DETECTOR_IMPROVEMENT.md # Building detector documentation
├── backyard-scout/              # Main analysis directory
│   ├── src/
│   │   ├── analyze_requested_properties.ts  # ADU detailed analysis
│   │   ├── tools/               # Specialized analysis tools
│   │   │   ├── quick_check.ts              # Rapid feasibility check
│   │   │   ├── lot_split_analyzer.ts       # Lot splitting finder
│   │   │   ├── area_adu_search.ts          # Area-wide ADU search
│   │   │   └── property_compare.ts         # Multi-property comparison
│   │   ├── services/
│   │   │   ├── zoning_enhanced.ts          # Zoneomics integration
│   │   │   ├── zoneomics_tiles_service.ts  # Zoning API
│   │   │   └── unified_building_detector.ts # Unified building detection
│   │   └── formulas/
│   │       └── adu_formulas.ts             # Calculations
│   ├── cache/                   # API response cache
│   └── out/                     # JSON/CSV outputs
└── README.md                    # User documentation
```

## 🔧 TRIGGER WORDS & TOOL MAPPING:

### Quick Check Tool:
- "quick check"
- "rapid assessment"
- "worth looking at"
- "initial screening"
- "development potential"

### Development Analysis Tool (ADU/Duplex/Multi-Unit):
- "Can I build an ADU"
- "ADU feasibility"
- "build a duplex"
- "triplex/fourplex potential"
- "multi-unit development"
- "multiple units"
- "buildable area"
- "accessory dwelling unit"
- "secondary unit"
- "granny flat"
- "in-law unit"

### Lot Splitting & Multi-Unit Tool:
- "split lots"
- "subdivide"
- "lot splitting"
- "SB 9" or "SB9"
- "find splittable properties"
- "parcels to split"
- "build two homes"
- "duplex development"
- "triplex/fourplex sites"
- "multi-family potential"
- "multiple units on one lot"

### Area Search Tool:
- "find properties in [area]"
- "ADU opportunities in [city]"
- "development opportunities"
- "duplex sites in [area]"
- "multi-unit potential in [ZIP]"
- "scan neighborhood"
- "all properties in ZIP"
- "subdivision opportunities"

### Property Comparison:
- "compare properties"
- "which is better"
- "rank these"
- "best investment"

## 📊 CALCULATION METHODOLOGY

### Development Types Explained:
1. **ADU (Accessory Dwelling Unit)**: Secondary unit on lot with existing home
   - Max 1,200 sqft or 50% of primary home
   - Requires 4-foot side/rear setbacks
   - Does NOT require lot split

2. **Lot Split/Subdivision (SB 9)**: Dividing property into separate parcels
   - Each new parcel can have its own primary dwelling
   - Can build up to 4 units total (2 per parcel)
   - Minimum parcel size requirements apply

3. **Duplex/Triplex/Fourplex**: Multiple units on single parcel
   - Does NOT require lot split
   - Subject to local zoning for multi-family
   - Different setback and coverage requirements

### ADU/Development Buildability Formula:
1. Get parcel area from CA Statewide Parcels
2. Get zone from Zoneomics → apply setbacks
3. Calculate buildable envelope = lot - setbacks
4. Detect buildings using unified detector:
   - Try county-specific data (HIGH quality)
   - Try Microsoft Buildings (MEDIUM quality)
   - Try OpenStreetMap (MEDIUM quality)
   - Try LA County Assessor (LOW quality)
   - Use intelligent estimate (ESTIMATED - last resort)
5. Net buildable = envelope - existing buildings
6. Max ADU = min(1200 sqft, 40% lot coverage)
7. Viable if net buildable ≥ 770 sqft

### Financial Analysis:
- Development cost: $195/sqft
- Monthly rent: $3/sqft
- Annual NOI: (monthly rent × 12) × 0.665
- Cap rate: NOI / development cost

## ⚠️ CONSISTENCY REQUIREMENTS

### To Ensure Consistent Results:
1. **ALWAYS use Zoneomics** for zoning (never ArcGIS)
2. **Use baseline estimates** when building data unavailable
3. **Clear cache if getting stale data**: `rm -rf backyard-scout/cache/*`
4. **Use exact addresses** in format: "123 Main St, City, CA ZIP"

## 🚨 COMMON ISSUES & FIXES

### "Getting different results each run":
- Ensure using Zoneomics (not ArcGIS endpoints)
- Check cache isn't corrupted
- Verify using consistent building detection

### "No zoning data found":
- Verify Zoneomics API key is valid
- Check network connectivity
- Cache may need clearing

### "Building area seems wrong":
- Check the data quality indicator (HIGH/MEDIUM/LOW/ESTIMATED)
- If ESTIMATED, no real building data was available
- Review confidence score and sources checked
- Clear cache if needed: `rm -rf backyard-scout/cache/buildings/*`

## 📝 AGENT BEHAVIOR

When acting as the backyard-scout agent:
1. Change to backyard-scout directory
2. Use analyze_requested_properties.ts
3. Parse results from JSON output
4. Present summary with viability assessment
5. Never search web for property data
6. Use only local APIs and tools

## ✅ EXAMPLE INTERACTIONS

### Example 1: Area Search for Lot Splitting
**User:** "Find properties in Old Agoura 91301 that I can split into multiple lots"

**Claude:** [Uses lot_split_analyzer.ts]
```bash
cd backyard-scout && npx tsx src/tools/lot_split_analyzer.ts --zip 91301 --min-size 20000
```

### Example 2: Quick Check
**User:** "Quick check if 123 Main St, Agoura, CA is worth looking at"

**Claude:** [Uses quick_check.ts]
```bash
cd backyard-scout && npx tsx src/tools/quick_check.ts "123 Main St, Agoura, CA"
```

### Example 3: Area-Wide ADU Search
**User:** "Show me all ADU opportunities in Agoura Hills"

**Claude:** [Uses area_adu_search.ts]
```bash
cd backyard-scout && npx tsx src/tools/area_adu_search.ts --city "Agoura Hills"
```

### Example 4: Property Comparison
**User:** "Compare these three properties and tell me which is best"

**Claude:** [Uses property_compare.ts]
```bash
cd backyard-scout && npx tsx src/tools/property_compare.ts "addr1" "addr2" "addr3"
```

### Example 5: Detailed ADU Analysis
**User:** "Can I build an ADU at 20616 Archwood St, Winnetka?"

**Claude:** [Uses analyze_requested_properties.ts]
```bash
cd backyard-scout && npx tsx src/analyze_requested_properties.ts "20616 Archwood St, Winnetka, CA 91306"
```

### Example 6: Duplex/Multi-Unit Potential
**User:** "Can I build a duplex or subdivide the lot at 123 Main St?"

**Claude:** I'll analyze both subdivision and multi-unit development potential.
[Uses both lot_split_analyzer.ts and analyze_requested_properties.ts]
```bash
cd backyard-scout && npx tsx src/tools/lot_split_analyzer.ts "123 Main St, City, CA"
cd backyard-scout && npx tsx src/analyze_requested_properties.ts "123 Main St, City, CA"
```

## 🔧 API STATUS CHECK
To verify all APIs are working:
```bash
node test-apis.js
```
This will test all endpoints and report their status.

## 🔄 LAST UPDATED
December 22, 2024 - Expanded scope to include subdivision and multi-unit development

---
*This is the ONLY instruction file needed for the Buildable-LA project.*