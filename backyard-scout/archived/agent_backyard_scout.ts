#!/usr/bin/env tsx
/**
 * Backyard Scout Agent - ADU buildability analysis for LA County parcels
 *
 * Usage:
 *   npx tsx agent_backyard_scout.ts --zip 90024 [--limit 100]
 *   npx tsx agent_backyard_scout.ts --address "123 Main St, Los Angeles, CA"
 *   npx tsx agent_backyard_scout.ts --city "Beverly Hills"
 */

import { program } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { extractParcels } from './src/extract_parcels.js';
import { processParcels } from './src/batch_all.js';
import { dbInit } from './src/storage.js';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

interface AgentOptions {
  zip?: string[];
  address?: string;
  city?: string;
  limit?: number;
  output?: string;
  format?: 'csv' | 'json' | 'html';
}

class BackyardScoutAgent {
  private workDir: string;

  constructor() {
    this.workDir = path.dirname(new URL(import.meta.url).pathname);
  }

  async run(options: AgentOptions) {
    console.log('🏠 Backyard Scout Agent starting...');

    // 1. Determine what to process
    let zipcodes: string[] = [];

    if (options.zip && options.zip.length > 0) {
      zipcodes = options.zip;
      console.log(`📍 Processing ZIP codes: ${zipcodes.join(', ')}`);
    } else if (options.address) {
      console.log(`📍 Geocoding address: ${options.address}`);
      zipcodes = [await this.geocodeAddress(options.address)];
    } else if (options.city) {
      console.log(`📍 Finding ZIP codes for city: ${options.city}`);
      zipcodes = await this.getZipcodesForCity(options.city);
    } else {
      throw new Error('Must specify --zip, --address, or --city');
    }

    // 2. Extract parcels from geodatabase
    console.log(`📦 Extracting parcels from geodatabase...`);
    const extractedFile = await extractParcels({
      zipcodes,
      outputFormat: 'ndjson',
      limit: options.limit,
    });
    console.log(`✓ Extracted to: ${extractedFile}`);

    // 3. Process parcels
    console.log(`🔄 Processing parcels (this may take a while)...`);
    const startTime = Date.now();

    await processParcels({
      inputFile: extractedFile,
      maxParcels: options.limit || Infinity,
      zipcodes,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ Processing complete in ${elapsed}s`);

    // 4. Generate report
    const outputFile =
      options.output ||
      `backyard_scout_${zipcodes.join('-')}_${Date.now()}.${options.format || 'csv'}`;
    await this.generateReport(outputFile, options.format || 'csv');

    // 5. Show statistics
    await this.showStats();

    console.log(`\n✅ Analysis complete! Results saved to: ${outputFile}`);
    return outputFile;
  }

  private async geocodeAddress(address: string): Promise<string> {
    // Use LA County geocoder to get ZIP from address
    const baseUrl =
      'https://geocode.gis.lacounty.gov/geocode/rest/services/CAMS_Locator/GeocodeServer/findAddressCandidates';
    const params = new URLSearchParams({
      SingleLine: address,
      f: 'json',
      outFields: 'Postal',
    });

    const response = await fetch(`${baseUrl}?${params}`);
    const data = (await response.json()) as any;

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error(`Could not geocode address: ${address}`);
    }

    const zip = data.candidates[0].attributes?.Postal;
    if (!zip) {
      throw new Error(`No ZIP code found for address: ${address}`);
    }

    console.log(`  Found ZIP: ${zip}`);
    return zip.substring(0, 5);
  }

  private async getZipcodesForCity(city: string): Promise<string[]> {
    // This would need a lookup table or API for city -> ZIP mapping
    // For now, return common LA city ZIPs as example
    const cityZips: Record<string, string[]> = {
      'Los Angeles': ['90001', '90002', '90003', '90004', '90005'],
      'Beverly Hills': ['90210', '90211', '90212'],
      'Santa Monica': ['90401', '90402', '90403', '90404', '90405'],
      Westwood: ['90024', '90025', '90095'],
      Venice: ['90291', '90292', '90294'],
      'Culver City': ['90230', '90231', '90232'],
    };

    const zips = cityZips[city];
    if (!zips) {
      throw new Error(
        `City not found: ${city}. Available cities: ${Object.keys(cityZips).join(', ')}`,
      );
    }

    return zips;
  }

  private async generateReport(outputFile: string, format: 'csv' | 'json' | 'html') {
    const db = dbInit();

    switch (format) {
      case 'csv':
        await this.exportCSV(outputFile);
        break;

      case 'json':
        await this.exportJSON(outputFile);
        break;

      case 'html':
        await this.exportHTML(outputFile);
        break;
    }
  }

  private async exportCSV(outputFile: string) {
    // Use existing CSV export
    const { stdout } = await execAsync(
      `cd "${this.workDir}" && npx tsx src/csv_export.ts "${outputFile}"`,
    );
    console.log(stdout);
  }

  private async exportJSON(outputFile: string) {
    const db = dbInit();
    const results = db
      .prepare(
        `
      SELECT apn, zip, zone, buildable_footprint_sqft, score, static_thumb_url
      FROM candidates
      ORDER BY buildable_footprint_sqft DESC
    `,
      )
      .all();

    await fs.writeFile(outputFile, JSON.stringify(results, null, 2));
  }

  private async exportHTML(outputFile: string) {
    const db = dbInit();
    const results = db
      .prepare(
        `
      SELECT apn, zip, zone, buildable_footprint_sqft, score, static_thumb_url
      FROM candidates
      ORDER BY buildable_footprint_sqft DESC
      LIMIT 100
    `,
      )
      .all() as any[];

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Backyard Scout Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    .viable { color: green; font-weight: bold; }
    .not-viable { color: orange; }
    img { max-width: 100px; }
  </style>
</head>
<body>
  <h1>🏠 Backyard Scout ADU Analysis Report</h1>
  <p>Generated: ${new Date().toLocaleString()}</p>
  <p>Total parcels analyzed: ${results.length}</p>

  <table>
    <tr>
      <th>APN</th>
      <th>ZIP</th>
      <th>Zone</th>
      <th>Buildable Area (sqft)</th>
      <th>ADU Viability</th>
      <th>Aerial View</th>
    </tr>
    ${results
      .map(
        (r) => `
    <tr>
      <td>${r.apn}</td>
      <td>${r.zip}</td>
      <td>${r.zone}</td>
      <td>${r.buildable_footprint_sqft.toFixed(0)}</td>
      <td class="${r.buildable_footprint_sqft >= 770 ? 'viable' : 'not-viable'}">
        ${r.buildable_footprint_sqft >= 770 ? '✓ Viable' : '⚠ Limited'}
      </td>
      <td><a href="${r.static_thumb_url}" target="_blank">View</a></td>
    </tr>
    `,
      )
      .join('')}
  </table>
</body>
</html>`;

    await fs.writeFile(outputFile, html);
  }

  private async showStats() {
    const db = dbInit();
    const stats = db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN buildable_footprint_sqft >= 770 THEN 1 END) as viable,
        ROUND(AVG(buildable_footprint_sqft), 0) as avg_sqft,
        ROUND(MIN(buildable_footprint_sqft), 0) as min_sqft,
        ROUND(MAX(buildable_footprint_sqft), 0) as max_sqft
      FROM candidates
    `,
      )
      .get() as any;

    const zones = db
      .prepare(
        `
      SELECT zone, COUNT(*) as count
      FROM candidates
      GROUP BY zone
      ORDER BY count DESC
      LIMIT 5
    `,
      )
      .all() as any[];

    console.log('\n📊 Analysis Statistics:');
    console.log(`  Total parcels: ${stats.total}`);
    console.log(
      `  Viable for ADU (≥770 sqft): ${stats.viable} (${((stats.viable / stats.total) * 100).toFixed(1)}%)`,
    );
    console.log(`  Average buildable area: ${stats.avg_sqft} sqft`);
    console.log(`  Range: ${stats.min_sqft} - ${stats.max_sqft} sqft`);
    console.log(`  Top zones: ${zones.map((z) => `${z.zone}(${z.count})`).join(', ')}`);
  }
}

// CLI setup
program
  .name('backyard-scout')
  .description('ADU buildability analysis for LA County parcels')
  .version('1.0.0');

program
  .option('-z, --zip <codes...>', 'ZIP code(s) to analyze')
  .option('-a, --address <address>', 'Address to analyze')
  .option('-c, --city <city>', 'City name to analyze')
  .option('-l, --limit <number>', 'Max parcels to process', parseInt)
  .option('-o, --output <file>', 'Output file name')
  .option('-f, --format <type>', 'Output format (csv|json|html)', 'csv')
  .action(async (options) => {
    try {
      const agent = new BackyardScoutAgent();
      await agent.run(options);
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();

// Export for use as module
export { BackyardScoutAgent };
