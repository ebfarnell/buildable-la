import * as turf from "@turf/turf";
import { queryFeatureLayer, exportImage } from "./src/arcgis.js";
import { inwardSetbackEnvelope, subtractFootprints, toSqft } from "./src/geo.js";
import { ENDPOINTS } from "./src/config.js";

async function validateProperty() {
  const targetAPN = "2048-001-033";
  const targetAddress = "5869 CARELL AVE AGOURA HILLS CA 91301";

  console.log("=== VALIDATION FOR 5869 CARELL AVE ===\n");
  console.log("Expected values from database:");
  console.log("- Buildable area: 3,994 sqft");
  console.log("- Lot area: 10,562 sqft\n");

  // Step 1: Get parcel geometry from County
  console.log("Step 1: Fetching parcel geometry...");
  const parcelUrl = "https://public.gis.lacounty.gov/public/rest/services/Assessor/Assessor_Parcel_Public/MapServer/0";
  const parcelResponse = await queryFeatureLayer(parcelUrl, {
    where: `APN='${targetAPN}'`,
    outFields: "APN,SitusFullAddress",
    returnGeometry: true,
    outSR: 4326
  });

  if (!parcelResponse.features || parcelResponse.features.length === 0) {
    console.error("Parcel not found!");
    return;
  }

  const parcelFeature = parcelResponse.features[0];
  const parcelArea = turf.area(parcelFeature);
  const parcelAreaSqft = toSqft(parcelArea);

  console.log(`✓ Parcel found: ${parcelFeature.properties.SitusFullAddress || targetAddress}`);
  console.log(`✓ Lot area: ${parcelAreaSqft.toFixed(0)} sqft (${(parcelArea).toFixed(0)} m²)\n`);

  // Step 2: Get building footprints
  console.log("Step 2: Fetching existing building footprints...");
  const footprintsResponse = await queryFeatureLayer(ENDPOINTS.footprints, {
    geometry: JSON.stringify({
      rings: parcelFeature.geometry.coordinates,
      spatialReference: { wkid: 4326 }
    }),
    geometryType: "esriGeometryPolygon",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,HEIGHT,AREA",
    inSR: 4326
  });

  console.log(`✓ Found ${footprintsResponse.features.length} building footprint(s)`);
  let totalFootprintArea = 0;
  footprintsResponse.features.forEach((f: any, i: number) => {
    const area = toSqft(turf.area(f));
    totalFootprintArea += area;
    console.log(`  Building ${i+1}: ${area.toFixed(0)} sqft`);
  });
  console.log(`  Total existing footprints: ${totalFootprintArea.toFixed(0)} sqft\n`);

  // Step 3: Apply setbacks
  console.log("Step 3: Applying setbacks...");
  const setbacks = { frontFt: 10, sideFt: 4, rearFt: 4 };
  console.log(`  Front: ${setbacks.frontFt} ft, Sides: ${setbacks.sideFt} ft, Rear: ${setbacks.rearFt} ft`);
  console.log("  Using maximum setback (10 ft) for uniform inward buffer");

  const envelope = inwardSetbackEnvelope(parcelFeature, setbacks);
  const envelopeArea = envelope ? toSqft(turf.area(envelope)) : 0;
  console.log(`✓ Buildable envelope after setbacks: ${envelopeArea.toFixed(0)} sqft\n`);

  // Step 4: Subtract footprints
  console.log("Step 4: Subtracting existing structures...");
  const buildable = subtractFootprints(envelope as any, footprintsResponse);
  const buildableArea = toSqft(turf.area(buildable as any));
  console.log(`✓ Final buildable area: ${buildableArea.toFixed(0)} sqft\n`);

  // Step 5: Compare results
  console.log("=== VALIDATION RESULTS ===");
  console.log(`Lot area:      ${parcelAreaSqft.toFixed(0)} sqft (expected: 10,562)`);
  console.log(`Buildable area: ${buildableArea.toFixed(0)} sqft (expected: 3,994)`);

  const lotDiff = Math.abs(parcelAreaSqft - 10562);
  const buildDiff = Math.abs(buildableArea - 3994);

  console.log(`\nDifference in lot area: ${lotDiff.toFixed(0)} sqft (${(lotDiff/10562*100).toFixed(1)}%)`);
  console.log(`Difference in buildable: ${buildDiff.toFixed(0)} sqft (${(buildDiff/3994*100).toFixed(1)}%)`);

  if (lotDiff < 100 && buildDiff < 100) {
    console.log("\n✅ VALIDATION PASSED - Values match within reasonable tolerance!");
  } else {
    console.log("\n⚠️  Some discrepancies found - may be due to data updates or rounding");
  }

  // Generate a visual representation
  console.log("\n=== CALCULATION BREAKDOWN ===");
  console.log(`Starting lot size:           ${parcelAreaSqft.toFixed(0)} sqft`);
  console.log(`After 10ft setback inward:   ${envelopeArea.toFixed(0)} sqft`);
  console.log(`Existing structures:         -${totalFootprintArea.toFixed(0)} sqft`);
  console.log(`Final buildable area:        ${buildableArea.toFixed(0)} sqft`);
  console.log(`\nCan fit 1000 sqft ADU?      ${buildableArea >= 1000 ? "✅ YES" : "❌ NO"}`);
  console.log(`Can fit 1200 sqft ADU?      ${buildableArea >= 1200 ? "✅ YES" : "❌ NO"}`);
}

validateProperty().catch(console.error);