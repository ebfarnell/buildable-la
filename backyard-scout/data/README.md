# Data Directory

This directory contains parcel data files for batch processing.

## File Format

Parcel data files should be named `parcels_{ZIP}.json` and contain an array of parcel objects:

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
          "geometry": {
            "type": "Polygon",
            "coordinates": [/* polygon coordinates */]
          },
          "properties": {
            "APN": "1234-567-890",
            "ZIP": "91361"
          }
        }
      ]
    }
  }
]
```

## Usage

To process parcels for a specific ZIP code:

```bash
npm run run:zip 91361 --limit=50
```

## Sample Data

- `parcels_91361_sample.json` - Sample parcel data for testing