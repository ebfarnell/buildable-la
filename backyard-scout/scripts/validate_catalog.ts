#!/usr/bin/env tsx
import { loadCatalog } from '../src/lib/catalog/index.js';

async function main() {
  try {
    const catalog = await loadCatalog();

    console.log('✅ Catalog validation successful');
    console.log(`Version: ${catalog.version}`);
    console.log(`Jurisdictions: ${catalog.jurisdictions.length}`);

    const layerCount = catalog.jurisdictions.reduce((sum, j) => sum + j.layers.length, 0);
    console.log(`Total layers: ${layerCount}`);

    const placeholders = JSON.stringify(catalog).match(/<REPLACE_ME_[^>]+>/g);
    if (placeholders && placeholders.length > 0) {
      console.warn('⚠️  Placeholders found:', Array.from(new Set(placeholders)));
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Catalog validation failed:', error);
    process.exit(1);
  }
}

main();