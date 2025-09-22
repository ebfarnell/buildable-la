#!/bin/bash

echo "Testing California Building Footprint Endpoints"
echo "=============================================="

# Test location: 1618 Burning Tree Dr coordinates
LAT=34.212931
LON=-118.848476
BBOX="-118.85,34.21,-118.84,34.22"

echo -e "\n1. Testing Microsoft Building Footprints (Esri Hub):"
curl -s "https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Microsoft_Building_Footprints/FeatureServer/0/query?geometry=${BBOX}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=*&returnCountOnly=true&f=json" | jq -r '.count // "Failed"'

echo -e "\n2. Testing LA County Buildings:"
curl -s "https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Buildings/MapServer/0/query?geometry=${BBOX}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json" | jq -r '.count // "Failed"'

echo -e "\n3. Testing San Francisco Buildings:"
curl -s "https://sfplanninggis.org/arcgis/rest/services/BuildingFootprints/MapServer/0/query?geometry=-122.42,37.77,-122.41,37.78&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json" 2>/dev/null | jq -r '.count // "Failed"'

echo -e "\n4. Testing Orange County (if available):"
curl -s "https://services1.arcgis.com/vY6WuhLW0HkFe6Fl/ArcGIS/rest/services/Building_Footprints/FeatureServer/0/query?geometry=-117.83,33.71,-117.82,33.72&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json" 2>/dev/null | jq -r '.count // .error.message // "Failed"'

echo -e "\n5. Testing OSM Buildings via Overpass:"
curl -s "https://overpass-api.de/api/interpreter" --data "data=[out:json];way[\"building\"](34.21,-118.85,34.22,-118.84);out count;" | jq -r '.elements | length // "Failed"'
