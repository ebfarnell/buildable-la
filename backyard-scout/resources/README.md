# Backyard Scout Resources Directory

This directory contains essential data sources, configurations, and references for the ADU analysis system.

## Directory Structure

```
resources/
├── README.md                    # This file
├── services/                    # GIS Service Endpoints
│   ├── california_parcels.json  # Statewide parcel services
│   ├── building_footprints.json # Building data sources
│   └── zoning_services.json     # Zoning data endpoints
├── zoning/                      # Zoning Requirements by City
│   ├── thousand_oaks.json       # Thousand Oaks zoning data
│   ├── los_angeles.json         # LA zoning data
│   └── default.json             # Default conservative values
├── municipal_codes/             # Links to Municipal Codes
│   └── codes_directory.json     # Directory of code URLs
└── data_quality/                # Data Quality References
    ├── deterministic_rules.md   # Rules for consistent calculations
    └── fallback_strategies.md   # What to do when data unavailable
```

## Quick Reference

### California Parcels Service (All 58 Counties)

- **Endpoint**: `https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0`
- **Coverage**: Complete statewide
- **Key Fields**: COUNTYNAME, SITE_CITY, PARCEL_APN, SITE_ADDR, SITE_ZIP

### Building Footprints Priority

1. County-specific services (when available)
2. OpenStreetMap via Overpass API
3. Microsoft Building Footprints
4. ESTIMATED: 30% residential, 40% commercial

### Zoning Data Sources

1. City/County GIS services (often restricted)
2. Municipal codes (text-based, hard to parse)
3. Regional standards (conservative estimates)
4. Default fallbacks (25ft front, 5ft side, 15ft rear)

## Data Quality Standards

### Deterministic Requirements

- Same input MUST produce same output
- Round all areas to nearest square foot
- Use fixed precision (6 decimal places for coordinates)
- Sort features by ID before processing
- Document all data sources

### When Data is Unavailable

- **Parcels**: Required - cannot proceed without
- **Zoning**: Use conservative defaults, flag as estimated
- **Buildings**: Use 30% coverage estimate, flag as estimated
- **Overlays**: Continue without, note in report

## Common Issues & Solutions

### Issue: Zoning service not accessible

**Solution**: Use zoning/[city].json fallback data

### Issue: Building footprints missing

**Solution**: Apply deterministic coverage estimates

### Issue: Service returns 404/503

**Solution**: Retry with exponential backoff, then use fallback

## Contacts for Data Verification

### Thousand Oaks

- Planning Department: (805) 449-2300
- GIS: https://city-of-thousand-oaks-arcgis-hub-toaks.hub.arcgis.com/
- Zoning: https://www.toaks.org/departments/community-development

### Los Angeles County

- GIS: https://public.gis.lacounty.gov/
- Planning: (213) 974-6411

### Ventura County

- GIS Hub: https://venturacountydatadownloads-vcitsgis.hub.arcgis.com/
- Planning: (805) 654-2481

## Update Log

- 2025-09-19: Created initial resources directory
- 2025-09-19: Added Thousand Oaks zoning fallbacks
- 2025-09-19: Documented deterministic calculation rules
