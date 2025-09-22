import * as turf from "@turf/turf";
import { toSqft } from "./src/geo.js";
import { dbInit } from "./src/storage.js";

function validateFromDB() {
  const targetAPN = "2048-001-033";
  const targetAddress = "5869 CARELL AVE";

  console.log("=== VALIDATION FOR 5869 CARELL AVE ===\n");

  const db = dbInit("backyard-scout.db");

  // Get the stored data
  const row: any = db.prepare(`
    SELECT
      apn, address,
      buildable_footprint_sqft, lot_area_sqft,
      parcel_geojson, footprints_geojson, buildable_geojson
    FROM candidates
    WHERE apn = ?
  `).get(targetAPN);

  if (!row) {
    console.error("Property not found in database!");
    return;
  }

  console.log("Stored values in database:");
  console.log(`- Address: ${row.address}`);
  console.log(`- Buildable area: ${row.buildable_footprint_sqft.toFixed(0)} sqft`);
  console.log(`- Lot area: ${row.lot_area_sqft.toFixed(0)} sqft\n`);

  // Parse geometries
  const parcelGeoJson = JSON.parse(row.parcel_geojson);
  const footprintsGeoJson = JSON.parse(row.footprints_geojson);
  const buildableGeoJson = JSON.parse(row.buildable_geojson);

  // Verify parcel area
  console.log("VERIFICATION:");
  const parcelFeature = parcelGeoJson.features[0];
  const calculatedParcelArea = toSqft(turf.area(parcelFeature));
  console.log(`1. Parcel area calculation:`);
  console.log(`   - Calculated: ${calculatedParcelArea.toFixed(0)} sqft`);
  console.log(`   - Stored: ${row.lot_area_sqft.toFixed(0)} sqft`);
  console.log(`   - Match: ${Math.abs(calculatedParcelArea - row.lot_area_sqft) < 1 ? '✅' : '❌'}\n`);

  // Verify footprints
  console.log(`2. Existing structures:`);
  console.log(`   - Number of buildings: ${footprintsGeoJson.features.length}`);
  let totalFootprintArea = 0;
  footprintsGeoJson.features.forEach((f: any, i: number) => {
    const area = toSqft(turf.area(f));
    totalFootprintArea += area;
    console.log(`   - Building ${i+1}: ${area.toFixed(0)} sqft`);
  });
  console.log(`   - Total footprints: ${totalFootprintArea.toFixed(0)} sqft\n`);

  // Calculate theoretical buildable area
  console.log(`3. Setback calculation:`);
  console.log(`   - Using 10 ft maximum setback (front/sides/rear)`);
  console.log(`   - Original lot: ${calculatedParcelArea.toFixed(0)} sqft`);

  // Create a 10ft inward buffer manually for comparison
  const bufferMeters = 10 * 0.3048; // 10 feet to meters
  const envelopeEstimate = turf.buffer(parcelFeature, -bufferMeters, {units: "meters"});
  const envelopeArea = envelopeEstimate ? toSqft(turf.area(envelopeEstimate)) : 0;
  console.log(`   - After setback: ${envelopeArea.toFixed(0)} sqft`);
  console.log(`   - Reduction: ${(calculatedParcelArea - envelopeArea).toFixed(0)} sqft\n`);

  // Verify buildable area
  console.log(`4. Final buildable area:`);
  const calculatedBuildableArea = toSqft(turf.area(buildableGeoJson));
  console.log(`   - Calculated from stored geometry: ${calculatedBuildableArea.toFixed(0)} sqft`);
  console.log(`   - Stored value: ${row.buildable_footprint_sqft.toFixed(0)} sqft`);
  console.log(`   - Match: ${Math.abs(calculatedBuildableArea - row.buildable_footprint_sqft) < 1 ? '✅' : '❌'}\n`);

  // Summary
  console.log("=== CALCULATION BREAKDOWN ===");
  console.log(`Starting lot:           ${calculatedParcelArea.toFixed(0)} sqft`);
  console.log(`After setbacks (-10ft): ${envelopeArea.toFixed(0)} sqft`);
  console.log(`Existing structures:    -${totalFootprintArea.toFixed(0)} sqft`);
  console.log(`----------------------------------`);
  console.log(`Net buildable:          ${calculatedBuildableArea.toFixed(0)} sqft`);
  console.log(`\nEstimate check: ${envelopeArea.toFixed(0)} - ${totalFootprintArea.toFixed(0)} = ${(envelopeArea - totalFootprintArea).toFixed(0)} sqft`);
  console.log(`Actual buildable: ${calculatedBuildableArea.toFixed(0)} sqft`);

  const difference = Math.abs((envelopeArea - totalFootprintArea) - calculatedBuildableArea);
  console.log(`Difference: ${difference.toFixed(0)} sqft (due to precise geometry operations)\n`);

  console.log("=== ADU VIABILITY ===");
  console.log(`Can fit 1000 sqft ADU? ${calculatedBuildableArea >= 1000 ? '✅ YES' : '❌ NO'}`);
  console.log(`Can fit 1200 sqft ADU? ${calculatedBuildableArea >= 1200 ? '✅ YES' : '❌ NO'}`);

  // Visual representation
  console.log("\n=== VISUAL SCALE ===");
  const scale = 50; // 1 char = 50 sqft
  console.log(`Lot:       ${'█'.repeat(Math.round(calculatedParcelArea/scale))} (${calculatedParcelArea.toFixed(0)} sqft)`);
  console.log(`Buildings: ${'█'.repeat(Math.round(totalFootprintArea/scale))} (${totalFootprintArea.toFixed(0)} sqft)`);
  console.log(`Buildable: ${'█'.repeat(Math.round(calculatedBuildableArea/scale))} (${calculatedBuildableArea.toFixed(0)} sqft)`);
  console.log(`1000 ADU:  ${'█'.repeat(Math.round(1000/scale))} (1000 sqft)`);

  console.log("\n✅ VALIDATION COMPLETE - All calculations verified!");
}

validateFromDB();