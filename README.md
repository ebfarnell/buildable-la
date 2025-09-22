# Buildable LA - Property Development Analysis

![CI Status](https://github.com/ebfarnell/buildable-la/workflows/CI/badge.svg)

Comprehensive California property analysis for multiple development opportunities:
- **ADUs** (Accessory Dwelling Units) - Secondary units on existing lots
- **Lot Subdivision** - Splitting properties into multiple parcels (SB 9)
- **Multi-Unit Development** - Duplexes, triplexes, and fourplexes
- **Mixed Strategies** - Combining subdivision with multi-unit buildings

## Quick Start

```bash
# Interactive menu - Select the right tool for your needs
./analyze-property

# Quick feasibility check (5 seconds)
./analyze-property "123 Main St, City, CA ZIP"

# Find subdivision opportunities in a ZIP code
./analyze-property split --zip 91301

# Search for development opportunities in a city
./analyze-property area --city "Agoura Hills"

# Compare multiple properties
./analyze-property compare "addr1" "addr2" "addr3"
```

## What It Does

### Property Analysis
- Finds parcel boundaries and exact lot size
- Retrieves official zoning codes and regulations
- Detects existing buildings and structures
- Calculates buildable area after setbacks

### Development Options
- **ADU Analysis** - Maximum ADU size and placement
- **Subdivision Potential** - Can the lot be split? How many parcels?
- **Multi-Unit Feasibility** - Duplex, triplex, or fourplex potential
- **SB 9 Eligibility** - California lot split law compliance

### Financial Analysis
- Development costs by unit type
- Projected rental income
- Cap rates and ROI calculations
- Investment comparison rankings

## Development Types Explained

### ADU (Accessory Dwelling Unit)
- Secondary unit on lot with existing home
- Max 1,200 sqft or 50% of primary home
- 4-foot side/rear setbacks required
- No lot split needed

### Lot Split/Subdivision (SB 9)
- Divide property into separate parcels
- Each parcel can have primary dwelling
- Up to 4 units total (2 per parcel)
- Minimum parcel size requirements

### Multi-Unit Development
- Build duplex, triplex, or fourplex
- Single parcel, multiple units
- Subject to local multi-family zoning
- Different setback requirements

## Example Output

```
Property: 20616 Archwood St, Winnetka, CA
Zone: RS-1-RIO
Lot Size: 7,504 sqft

DEVELOPMENT OPTIONS:
- ADU: 1,200 sqft max
- Lot Split: Can divide into 2 parcels
- Duplex: Feasible with rezoning
- Total Units Possible: 4 (with SB 9)

FINANCIALS:
Development Cost: $234,000 - $936,000
Monthly Income: $3,600 - $14,400
Cap Rate: 12.3%
Status: HIGHLY VIABLE
```

## Specialized Tools

### 1. Quick Check (`quick_check.ts`)
5-second feasibility assessment with color-coded results

### 2. Lot Split Analyzer (`lot_split_analyzer.ts`)
Finds subdivision opportunities in any ZIP or city

### 3. Area Search (`area_adu_search.ts`)
Scans entire neighborhoods for development potential

### 4. Property Comparison (`property_compare.ts`)
Side-by-side analysis of multiple properties

### 5. Detailed Analysis (`analyze_requested_properties.ts`)
Comprehensive development potential report

## Project Structure

```
Buildable-LA/
├── analyze-property      # Master script with menu
├── CLAUDE.md            # AI agent instructions
├── README.md            # This file
└── backyard-scout/      # Analysis engine
    ├── src/
    │   ├── tools/       # Specialized analyzers
    │   ├── services/    # API integrations
    │   └── formulas/    # Calculations
    ├── cache/           # API cache
    └── out/             # Reports (JSON/CSV)
```

## For Developers/AI Agents

See **[CLAUDE.md](./CLAUDE.md)** for complete technical documentation, API details, and trigger word mappings.

## Requirements

- Node.js 18+
- npm or yarn
- Internet connection for API access

## Data Sources

### Working APIs
- California Statewide Parcels (boundaries)
- Microsoft Buildings MSBFP2 (footprints)
- OpenStreetMap (urban buildings)

### Currently Unavailable
- Zoneomics API (using defaults)
- County building services (404 errors)

## API Status

Run `node test-apis.js` to check current API availability.

---

*Last Updated: December 22, 2024 - Expanded to include subdivision and multi-unit development*