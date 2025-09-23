// Layer configuration per county
type LayerBlock = {
  parcels?: { url: string };
  zoning?: { url: string };
  buildings?: { url: string };
};

const layerConfig: Record<string, LayerBlock> = {
  los_angeles: {
    parcels: {
      url: 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0',
    },
    buildings: {
      url: 'https://arcgis-server.gis.lacounty.gov/arcgis/rest/services/LACounty_Buildings/MapServer/0',
    },
  },
  ventura: {
    // Using CA Statewide parcels filtered for Ventura County
    parcels: {
      url: 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0',
    },
    // Add more Ventura layers as needed
  },
};

export function getLayerBlock(countyKey: 'los_angeles' | 'ventura'): LayerBlock | null {
  return layerConfig[countyKey] || null;
}
