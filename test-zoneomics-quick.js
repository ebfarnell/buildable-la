#!/usr/bin/env node

const https = require('https');

async function testZoneomics() {
  const apiKey = 'ed8066dd45cef9ed3bb531483c0e3bb3f0f70519';

  // Test with Bedford property coordinates
  const lat = 34.044389;
  const lng = -118.382915;

  // Test the zoneDetail endpoint
  const url = `https://api.zoneomics.com/v2/zoneDetail?lat=${lat}&lng=${lng}&apikey=${apiKey}&output_fields=zoning,controls,parcels&f=json`;

  console.log('Testing Zoneomics API...');
  console.log(`URL: ${url}`);

  return new Promise((resolve) => {
    https.get(url, (res) => {
      console.log(`Status: ${res.statusCode}`);

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            console.log('\n✅ ZONEOMICS IS WORKING!');
            console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
          } catch (e) {
            console.log('❌ Not JSON response');
          }
        } else {
          console.log('❌ API not working - Status:', res.statusCode);
        }
      });
    }).on('error', (err) => {
      console.log('❌ Error:', err.message);
    });
  });
}

testZoneomics();