import { fetch } from 'undici';

const CA_PARCELS_URL = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0';

async function searchSanDiegoProperty() {
  console.log('Searching for 10921 Polaris Dr, San Diego...');
  
  // Try different search variations
  const searches = [
    "COUNTYNAME='SAN DIEGO' AND SITE_ADDR LIKE '%10921%POLARIS%'",
    "COUNTYNAME='SAN DIEGO' AND SITE_ADDR LIKE '%10921 POLARIS%'", 
    "COUNTYNAME='SAN DIEGO' AND SITE_CITY='SAN DIEGO' AND SITE_ADDR LIKE '%POLARIS%'",
    "COUNTYNAME='SAN DIEGO' AND SITE_ZIP='92126' AND SITE_ADDR LIKE '%POLARIS%'"
  ];

  for (const where of searches) {
    console.log(`\nTrying query: ${where}`);
    
    const params = new URLSearchParams({
      f: 'json',
      where: where,
      outFields: 'SITE_ADDR,PARCEL_APN,SITE_CITY,SITE_ZIP,COUNTYNAME',
      returnGeometry: 'false',
      resultRecordCount: '10'
    });

    try {
      const response = await fetch(`${CA_PARCELS_URL}/query`, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: params.toString()
      });

      const data = await response.json() as any;
      
      if (data.features && data.features.length > 0) {
        console.log(`✅ Found ${data.features.length} results:`);
        data.features.forEach((f: any) => {
          console.log(`   - ${f.attributes.SITE_ADDR}, APN: ${f.attributes.PARCEL_APN}`);
        });
        return data.features;
      }
    } catch (error) {
      console.error(`Error: ${error}`);
    }
  }
  
  console.log('❌ No results found');
  return null;
}

searchSanDiegoProperty();
