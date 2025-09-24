import { jurisdictionByParcel, zoningIntersect } from './src/sources.js';
import * as fs from 'fs';
import * as readline from 'readline';

async function getFirstParcel() {
  const fileStream = fs.createReadStream('data/parcels_90024.jsonl');
  const rl = readline.createInterface({ input: fileStream });

  for await (const line of rl) {
    const feature = JSON.parse(line);
    rl.close();
    return { type: 'FeatureCollection', features: [feature] };
  }
}

async function test() {
  const parcel = await getFirstParcel();
  console.log('Testing real parcel from 90024...');
  console.log('Geometry type:', parcel.features[0].geometry.type);
  console.log('APN:', parcel.features[0].properties.APN);

  try {
    const jurisdiction = await jurisdictionByParcel(parcel);
    console.log('Jurisdiction:', jurisdiction);

    const zoning = await zoningIntersect(parcel);
    console.log('Zoning features found:', zoning.features?.length || 0);
    if (zoning.features?.[0]) {
      console.log('Zone properties:', zoning.features[0].properties);
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

test();
