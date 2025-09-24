#!/usr/bin/env tsx
import { pickEndpoint } from '../src/lib/catalog/runtime.js';
import type { Capability } from '../src/lib/catalog/runtime.js';

interface Args {
  jurisdiction?: string;
  cap?: string;
  lon?: number;
  lat?: number;
}

function parseArgs(): Args {
  const args: Args = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--jurisdiction' && argv[i + 1]) {
      args.jurisdiction = argv[i + 1];
      i++;
    } else if (argv[i] === '--cap' && argv[i + 1]) {
      args.cap = argv[i + 1];
      i++;
    } else if (argv[i] === '--lon' && argv[i + 1]) {
      args.lon = parseFloat(argv[i + 1]);
      i++;
    } else if (argv[i] === '--lat' && argv[i + 1]) {
      args.lat = parseFloat(argv[i + 1]);
      i++;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs();

  if (!args.jurisdiction || !args.cap) {
    console.error('Usage: probe_catalog.ts --jurisdiction <key> --cap <capability> [--lon <x> --lat <y>]');
    process.exit(1);
  }

  const capability = args.cap as Capability;
  const startTime = Date.now();

  try {
    const result = await pickEndpoint(args.jurisdiction, [capability]);
    const latencyMs = Date.now() - startTime;

    const output = {
      jurisdiction: result.jurisdiction,
      capability,
      layer: {
        id: result.layer.id,
        type: result.layer.type,
        url: result.layer.url,
      },
      ok: true,
      latencyMs,
      note: 'Endpoint healthy',
    };

    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;

    const output = {
      jurisdiction: args.jurisdiction,
      capability,
      layer: null,
      ok: false,
      latencyMs,
      note: error.message || 'Failed to probe endpoint',
    };

    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }
}

main();