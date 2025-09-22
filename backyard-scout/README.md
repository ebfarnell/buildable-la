# Backyard-Scout Starter

A minimal scaffold for analyzing ADU and SB-9 duplex buildable area potential on LA County parcels.

## Features

1. **Store candidate parcels** (by ZIP)
2. **Calculate buildable envelopes** (subtracting footprints + setbacks)
3. **Generate interactive/static links** (NAIP imagery thumbnails)
4. **Run ZIP batch analysis** (process multiple parcels)
5. **Suggest max-fit rectangles** (ADU-sized building pads)
6. **Export results to CSV** (for analysis and reporting)

---

## Project Structure

```
backyard-scout/
├── src/
│   ├── agent_task.ts        # Main analysis function
│   ├── arcgis.ts           # ArcGIS REST API helpers
│   ├── config.ts           # LA County endpoints & settings
│   ├── csv_export.ts       # CSV export functionality
│   ├── geo.ts              # Geometry processing functions
│   ├── rects.ts            # Rectangle fitting algorithm
│   ├── run_zip.ts          # Batch ZIP processing
│   ├── sources.ts          # Data fetchers
│   └── storage.ts          # SQLite persistence
├── agent/
│   └── prompt.md           # Claude Code agent prompt
├── data/
│   ├── README.md           # Data format documentation
│   └── parcels_91361.json  # Sample parcel data
├── package.json
└── tsconfig.json
```

---

## Installation

```bash
# Clone and install dependencies
cd backyard-scout
npm install

# Build TypeScript
npm run build
```

---

## Usage

### 1. Batch Process by ZIP

Process multiple parcels from a ZIP code:

```bash
# Process 50 parcels from ZIP 91361
npm run run:zip -- 91361 --limit=50

# Process all parcels (default limit: 100)
npm run run:zip -- 91361
```

**Data Format:** Expects `data/parcels_{ZIP}.json` containing:

```json
[
  {
    "apn": "1234-567-890",
    "zip": "91361",
    "parcel_geojson": {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "properties": { "apn": "1234-567-890" },
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              /* polygon coordinates */
            ]
          }
        }
      ]
    }
  }
]
```

### 2. Export Results to CSV

```bash
# Export to stdout
npm run export:csv > candidates.csv

# Export to specific file
npm run export:csv -- --file=results.csv
```

**CSV Output:** Contains `apn`, `zip`, `buildable_sqft`, `score`, `static_thumb_url`

### 3. Single Parcel Analysis

Use within Claude Code or Node.js:

```typescript
import { analyzeParcel } from './src/agent_task.js';
import fs from 'node:fs';

// Load sample data
const data = JSON.parse(await fs.promises.readFile('./data/parcels_91361.json', 'utf-8'));

// Analyze single parcel
const result = await analyzeParcel(data[0].apn, data[0].zip, data[0].parcel_geojson);

console.log(result);
// {
//   apn: "1234-567-890",
//   zip: "91361",
//   buildable_footprint_sqft: 1850,
//   score: 0.85,
//   static_thumb_url: "https://imagery.nationalmap.gov/...",
//   rect_suggestions: [
//     {wFt: 22, hFt: 35, areaSqft: 770},
//     {wFt: 24, hFt: 34, areaSqft: 816},
//     {wFt: 20, hFt: 40, areaSqft: 800}
//   ]
// }
```

---

## NPM Scripts

```bash
npm run dev         # Run single analysis (development)
npm run build       # Compile TypeScript
npm run run:zip     # Batch process by ZIP
npm run export:csv  # Export results to CSV
```

---

## Configuration

### Endpoints (src/config.ts)

- **Footprints:** LA County building outlines (2020)
- **Zoning:** County Open Data layer for unincorporated areas
- **Imagery:** NAIP ImageServer for static thumbnails
- **Geocoding:** LA County CAMS locator service

### Settings

- **ADU Setbacks:** 4ft side/rear baseline (customizable per zoning)
- **Max Candidates:** 200 per batch (configurable)
- **Rectangle Sizes:** 22×35ft, 24×34ft, 20×40ft (standard ADU dimensions)

---

## Analysis Workflow

1. **Input:** APN + ZIP + parcel GeoJSON
2. **Fetch:** Building footprints intersecting parcel
3. **Calculate:** Setback envelope (4ft baseline, zoning overrides)
4. **Subtract:** Existing structures from buildable area
5. **Suggest:** Max-fit rectangles for ADU placement
6. **Generate:** NAIP thumbnail URL and scoring
7. **Store:** All artifacts in SQLite database

---

## Database Inspection

```bash
# Top candidates by score
sqlite3 data.db 'select apn, buildable_footprint_sqft, score from candidates order by score desc limit 10;'

# Export specific ZIP
sqlite3 data.db 'select apn, zip, buildable_footprint_sqft from candidates where zip="91361";'

# Count by ZIP
sqlite3 data.db 'select zip, count(*) from candidates group by zip;'
```

---

## Sample Workflow

```bash
# 1. Install dependencies
npm install

# 2. Ensure endpoints in src/config.ts are accessible
# (footprints + NAIP are public; zoning may require auth)

# 3. Batch process a ZIP
npm run run:zip -- 91361 --limit=50

# 4. Export results
npm run export:csv > candidates.csv

# 5. Inspect database
sqlite3 data.db 'select apn, buildable_footprint_sqft, score from candidates where score > 0.5 order by score desc;'
```

---

## Data Sources

- **Building Footprints:** [LA County Building Outlines (2020)](<https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Countywide_Building_Outlines_(2020)/FeatureServer/0>)
- **Zoning:** [LA County Open Data](https://arcgis.gis.lacounty.gov/arcgis/rest/services/DRP/Open_Data/MapServer/3)
- **Imagery:** [USGS NAIP](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer)
- **Parcels:** CA Statewide Parcels FGDB (user-provided subset)

---

## Legal Disclaimer

**This tool provides PRELIMINARY analysis only.** Results are not legal advice and require verification with:

- Local zoning ordinances
- Building code requirements
- Title and easement research
- Professional surveying
- Permit authority approval

Use for feasibility screening only. Always consult qualified professionals for actual development projects.

---

## Next Steps

- **Dynamic Parcel Fetching:** Connect to live county parcel services
- **Zoning Integration:** Add automated lot coverage and FAR checks
- **Web Interface:** Build viewer for interactive parcel exploration
- **Advanced Scoring:** Include transit proximity, utilities, and market factors
