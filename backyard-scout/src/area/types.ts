export type ResolvedArea = {
  name: string;
  slug: string;
  source: 'local' | 'osm' | 'arcgis' | 'wikidata';
  url?: string;
  retrieved_at: string;
  geojson: any; // Feature or FeatureCollection (Polygon/MultiPolygon)
};
