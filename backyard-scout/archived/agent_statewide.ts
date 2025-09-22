#!/usr/bin/env tsx
/**
 * California Statewide Backyard Scout Agent - ADU buildability analysis for any California address
 *
 * Usage:
 *   npx tsx agent_statewide.ts --addresses "address1" "address2" "address3"
 */

import * as turf from "@turf/turf";
import fetch from "node-fetch";

interface AddressAnalysis {
  address: string;
  apn?: string;
  parcelSize?: number;
  buildableArea?: number;
  zoning?: string;
  setbacks?: { front: number; side: number; rear: number };
  maxAduSize?: number;
  constraints?: string[];
  viability: "High" | "Medium" | "Low";
  notes?: string[];
}

class CaliforniaADUAnalyzer {
  async analyzeAddress(address: string): Promise<AddressAnalysis> {
    console.log(`\n📍 Analyzing: ${address}`);

    try {
      // 1. Geocode the address to get coordinates and county
      const geocoded = await this.geocodeAddress(address);
      if (!geocoded) {
        return {
          address,
          viability: "Low",
          notes: ["Could not geocode address"]
        };
      }

      // 2. Get parcel information from California Statewide Service
      const parcel = await this.fetchParcel(geocoded);
      if (!parcel) {
        return {
          address,
          viability: "Low",
          notes: ["Could not find parcel data"]
        };
      }

      // 3. Calculate buildable area with conservative setbacks
      const analysis = this.calculateBuildability(parcel);

      // 4. Determine ADU viability
      const viability = this.assessViability(analysis);

      return {
        address,
        apn: parcel.apn,
        parcelSize: analysis.parcelSize,
        buildableArea: analysis.buildableArea,
        zoning: analysis.zoning || "Unknown",
        setbacks: analysis.setbacks,
        maxAduSize: analysis.maxAduSize,
        constraints: analysis.constraints,
        viability,
        notes: analysis.notes
      };

    } catch (error) {
      console.error(`❌ Error analyzing ${address}:`, error);
      return {
        address,
        viability: "Low",
        notes: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  private async geocodeAddress(address: string): Promise<any> {
    // Use OpenStreetMap Nominatim for geocoding (works statewide)
    const url = `https://nominatim.openstreetmap.org/search?` + new URLSearchParams({
      q: address + ', California, USA', // Include state in the query string
      format: 'json',
      limit: '1'
    });

    console.log(`  Geocoding address...`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BackyardScout/1.0'
      }
    });

    const results = await response.json() as any[];

    if (!Array.isArray(results)) {
      console.warn(`  ⚠️ Unexpected response format:`, results);
      return null;
    }

    if (results.length === 0) {
      console.warn(`  ⚠️ Could not geocode address`);
      return null;
    }

    const result = results[0];
    if (!result || !result.lat || !result.lon) {
      console.warn(`  ⚠️ Invalid geocoding result:`, result);
      return null;
    }

    console.log(`  ✓ Geocoded to: ${result.lat}, ${result.lon}`);

    return {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      displayName: result.display_name
    };
  }

  private async fetchParcel(geocoded: any): Promise<any> {
    // Query California Statewide Parcels Service directly
    const url = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0/query';

    // Use point geometry for the query
    const point = {
      x: geocoded.lon,
      y: geocoded.lat,
      spatialReference: {
        wkid: 4326
      }
    };

    // Try simpler point format
    const pointString = `${geocoded.lon},${geocoded.lat}`;

    const params = new URLSearchParams({
      geometry: pointString,
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      inSR: '4326',
      f: 'json'
    });

    console.log(`  Querying parcel service...`);
    const response = await fetch(url + '?' + params);
    const data = await response.json() as any;

    if (data.error) {
      console.error(`  ❌ Service error:`, data.error);
      return null;
    }

    if (!data.features || data.features.length === 0) {
      // Try with a buffer if point query fails
      console.log(`  Trying with buffered geometry...`);

      const bufferParams = new URLSearchParams({
        geometryType: 'esriGeometryPoint',
        geometry: JSON.stringify(point),
        inSR: '4326',
        outSR: '4326',
        bufferDistance: '50',
        bufferUnits: 'esriSRUnit_Meter',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'PARCEL_APN,SITE_ADDR,SITE_CITY,SITE_ZIP,COUNTYNAME,LOT_SIZE_SQFT',
        returnGeometry: 'true',
        f: 'json'
      });

      const bufferResponse = await fetch(url + '?' + bufferParams);
      const bufferData = await bufferResponse.json() as any;

      if (!bufferData.features || bufferData.features.length === 0) {
        console.warn(`  ⚠️ No parcel found at location`);
        return null;
      }

      const feature = bufferData.features[0];
      const props = feature.attributes;

      console.log(`  ✓ Found parcel: ${props.PARCEL_APN}`);

      return {
        apn: props.PARCEL_APN,
        address: props.SITE_ADDR,
        city: props.SITE_CITY,
        zip: props.SITE_ZIP,
        county: props.COUNTYNAME,
        lotSize: props.LOT_SIZE_SQFT || 0,
        geometry: feature.geometry
      };
    }

    const feature = data.features[0];
    const props = feature.attributes;

    console.log(`  ✓ Found parcel: ${props.PARCEL_APN}`);

    return {
      apn: props.PARCEL_APN,
      address: props.SITE_ADDR,
      city: props.SITE_CITY,
      zip: props.SITE_ZIP,
      county: props.COUNTYNAME,
      lotSize: props.LOT_SIZE_SQFT || 0,
      geometry: feature.geometry
    };
  }

  private calculateBuildability(parcel: any): any {
    // Conservative default setbacks
    const setbacks = {
      front: 20, // feet
      side: 5,   // feet
      rear: 5    // feet
    };

    // Estimate parcel area if not provided
    let parcelSize = parcel.lotSize;
    if (!parcelSize && parcel.geometry) {
      // Convert geometry to GeoJSON and calculate area
      const polygon = this.esriToGeoJSON(parcel.geometry);
      if (polygon) {
        parcelSize = turf.area(polygon) * 10.764; // Convert m² to ft²
      }
    }

    // Estimate buildable area (very conservative)
    // Assume 40% lot coverage for residential zones
    const buildableArea = parcelSize ? parcelSize * 0.4 : 0;

    // Maximum ADU size based on California state law
    let maxAduSize = 1200; // Default max for attached ADUs
    const constraints = [];
    const notes = [];

    if (parcelSize < 3000) {
      constraints.push("Small lot size");
      maxAduSize = Math.min(800, buildableArea);
    }

    if (buildableArea < 400) {
      constraints.push("Limited buildable area");
    }

    // Check county-specific rules
    if (parcel.county === 'LOS ANGELES') {
      notes.push("LA County allows ADUs up to 1200 sq ft");
    } else if (parcel.county === 'SAN DIEGO') {
      notes.push("San Diego allows ADUs up to 1200 sq ft");
    }

    return {
      parcelSize,
      buildableArea: Math.round(buildableArea),
      setbacks,
      maxAduSize,
      zoning: "Residential", // Default assumption
      constraints,
      notes
    };
  }

  private assessViability(analysis: any): "High" | "Medium" | "Low" {
    if (analysis.buildableArea >= 800 && analysis.constraints.length === 0) {
      return "High";
    } else if (analysis.buildableArea >= 500) {
      return "Medium";
    } else {
      return "Low";
    }
  }

  private esriToGeoJSON(esriGeometry: any): any {
    if (!esriGeometry) return null;

    if (esriGeometry.rings) {
      return turf.polygon(esriGeometry.rings);
    } else if (esriGeometry.x && esriGeometry.y) {
      return turf.point([esriGeometry.x, esriGeometry.y]);
    }

    return null;
  }

  async generateReport(analyses: AddressAnalysis[]): Promise<string> {
    const timestamp = new Date().toISOString();

    let report = `# California ADU Buildability Analysis\n\n`;
    report += `Generated: ${timestamp}\n\n`;
    report += `## Summary\n\n`;
    report += `Total properties analyzed: ${analyses.length}\n`;
    report += `- High viability: ${analyses.filter(a => a.viability === "High").length}\n`;
    report += `- Medium viability: ${analyses.filter(a => a.viability === "Medium").length}\n`;
    report += `- Low viability: ${analyses.filter(a => a.viability === "Low").length}\n\n`;

    report += `## Detailed Analysis\n\n`;

    for (const analysis of analyses) {
      report += `### ${analysis.address}\n\n`;
      report += `**Viability:** ${analysis.viability}\n\n`;

      if (analysis.apn) {
        report += `- **APN:** ${analysis.apn}\n`;
      }
      if (analysis.parcelSize) {
        report += `- **Parcel Size:** ${analysis.parcelSize.toLocaleString()} sq ft\n`;
      }
      if (analysis.buildableArea) {
        report += `- **Estimated Buildable Area:** ${analysis.buildableArea.toLocaleString()} sq ft\n`;
      }
      if (analysis.maxAduSize) {
        report += `- **Max ADU Size:** ${analysis.maxAduSize.toLocaleString()} sq ft\n`;
      }
      if (analysis.setbacks) {
        report += `- **Setbacks:** Front: ${analysis.setbacks.front}ft, Side: ${analysis.setbacks.side}ft, Rear: ${analysis.setbacks.rear}ft\n`;
      }
      if (analysis.constraints && analysis.constraints.length > 0) {
        report += `- **Constraints:** ${analysis.constraints.join(", ")}\n`;
      }
      if (analysis.notes && analysis.notes.length > 0) {
        report += `- **Notes:** ${analysis.notes.join("; ")}\n`;
      }

      report += `\n`;
    }

    return report;
  }
}

// Main execution
async function main() {
  const addresses = [
    "20616 Archwood St, Winnetka, CA, 91306",
    "10921 Polaris Dr, San Diego, CA, 92126",
    "1843 S Bedford St, Los Angeles, CA, 90035"
  ];

  const analyzer = new CaliforniaADUAnalyzer();
  const analyses: AddressAnalysis[] = [];

  console.log("🏠 California ADU Buildability Analyzer");
  console.log("========================================\n");

  for (const address of addresses) {
    const analysis = await analyzer.analyzeAddress(address);
    analyses.push(analysis);
  }

  const report = await analyzer.generateReport(analyses);

  // Save report to file
  const fs = await import('fs/promises');
  const outputPath = 'out/california_adu_analysis.md';

  // Ensure output directory exists
  await fs.mkdir('out', { recursive: true });

  await fs.writeFile(outputPath, report);

  console.log("\n========================================");
  console.log("✅ Analysis complete!");
  console.log(`📄 Report saved to: ${outputPath}`);

  // Print summary
  console.log("\n📊 Quick Summary:");
  for (const analysis of analyses) {
    console.log(`  ${analysis.viability.padEnd(6)} - ${analysis.address}`);
  }
}

// Run if called directly
console.log("Script loaded, checking if main should run...");
console.log("import.meta.url:", import.meta.url);
console.log("process.argv[1]:", process.argv[1]);

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("Running main function...");
  main().catch(console.error);
} else {
  // Always run main for now during testing
  console.log("Running main function (fallback)...");
  main().catch(console.error);
}

export { CaliforniaADUAnalyzer };