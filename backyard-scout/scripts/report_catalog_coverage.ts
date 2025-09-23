#!/usr/bin/env tsx
import { loadCatalog, pickLayersFor } from '../src/lib/catalog/index.js';
import { pickEndpoint } from '../src/lib/catalog/runtime.js';
import type { Capability } from '../src/lib/catalog/runtime.js';

const REQUIRED_CAPABILITIES: Capability[] = ['zoning', 'parcels'];

interface ProbeResult {
  jurisdiction: string;
  capability: Capability;
  success: boolean;
  layerId?: string;
  error?: string;
}

async function probeWithTimeout(
  jurisdictionKey: string,
  capability: Capability,
  timeout = 10000
): Promise<ProbeResult> {
  const promise = pickEndpoint(jurisdictionKey, [capability])
    .then(result => ({
      jurisdiction: jurisdictionKey,
      capability,
      success: true,
      layerId: result.layer.id,
    }))
    .catch((error: any) => ({
      jurisdiction: jurisdictionKey,
      capability,
      success: false,
      error: error.message,
    }));

  const timeoutPromise = new Promise<ProbeResult>((resolve) => {
    setTimeout(() => {
      resolve({
        jurisdiction: jurisdictionKey,
        capability,
        success: false,
        error: 'Timeout',
      });
    }, timeout);
  });

  return Promise.race([promise, timeoutPromise]);
}

async function main() {
  console.log('# Catalog Coverage Report\n');

  try {
    const catalog = await loadCatalog();
    const results: ProbeResult[] = [];

    const jurisdictionsToTest = catalog.jurisdictions.filter(
      j => j.key !== 'statewide_buildings'
    );

    console.log(`Testing ${jurisdictionsToTest.length} jurisdictions × ${REQUIRED_CAPABILITIES.length} capabilities...\n`);

    for (const jurisdiction of jurisdictionsToTest) {
      for (const capability of REQUIRED_CAPABILITIES) {
        const layers = pickLayersFor(catalog, jurisdiction.key, [capability]);

        if (layers.length === 0) {
          results.push({
            jurisdiction: jurisdiction.key,
            capability,
            success: false,
            error: 'No layers configured',
          });
        } else {
          const result = await probeWithTimeout(jurisdiction.key, capability);
          results.push(result);
        }
      }
    }

    console.log('| Jurisdiction | Zoning | Parcels |');
    console.log('|--------------|--------|---------|');

    for (const jurisdiction of jurisdictionsToTest) {
      const zoningResult = results.find(
        r => r.jurisdiction === jurisdiction.key && r.capability === 'zoning'
      );
      const parcelsResult = results.find(
        r => r.jurisdiction === jurisdiction.key && r.capability === 'parcels'
      );

      const zoningStatus = zoningResult?.success
        ? `✅ ${zoningResult.layerId}`
        : zoningResult?.error === 'No layers configured'
        ? '⚫ N/A'
        : '❌ Failed';

      const parcelsStatus = parcelsResult?.success
        ? `✅ ${parcelsResult.layerId}`
        : parcelsResult?.error === 'No layers configured'
        ? '⚫ N/A'
        : '❌ Failed';

      console.log(`| ${jurisdiction.key.padEnd(12)} | ${zoningStatus.padEnd(6)} | ${parcelsStatus.padEnd(7)} |`);
    }

    const failedRequired = results.filter(r => !r.success && r.error !== 'No layers configured');
    if (failedRequired.length > 0) {
      console.log('\n## Failed Probes\n');
      for (const failed of failedRequired) {
        console.log(`- ${failed.jurisdiction}/${failed.capability}: ${failed.error}`);
      }
      process.exit(1);
    }

    console.log('\n✅ All required endpoints operational');
    process.exit(0);
  } catch (error) {
    console.error('❌ Report generation failed:', error);
    process.exit(1);
  }
}

main();