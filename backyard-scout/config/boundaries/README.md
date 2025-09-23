# Boundary Files

This directory contains GeoJSON files defining jurisdiction boundaries for automatic detection.

## Usage

- Files must be named `{jurisdiction_key}.geojson` matching the key in `data_catalog.json`
- Coordinates must be in WGS84 (EPSG:4326)
- Feature properties must include a `key` field matching the jurisdiction key
- Use simplified/generalized shapes to reduce file size and improve performance

## File Format

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "key": "city_of_los_angeles"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[...]]
      }
    }
  ]
}
```

## Seed Files

The initial seed files contain simple bounding boxes. Replace with official boundaries:

1. **city_of_los_angeles.geojson** - LA City boundary
2. **la_county_unincorporated.geojson** - Unincorporated LA County areas only
3. **ventura_county_unincorporated.geojson** - Unincorporated Ventura County areas
4. **city_of_san_diego.geojson** - San Diego City boundary
5. **orange_county_unincorporated.geojson** - Unincorporated Orange County areas

## Sources for Official Boundaries

- LA City: https://data.lacity.org/
- LA County: https://data.lacounty.gov/
- Ventura County: https://gis.ventura.org/
- San Diego: https://data.sandiego.gov/
- Orange County: https://data-ocpw.opendata.arcgis.com/