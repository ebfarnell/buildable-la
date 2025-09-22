import fs from 'node:fs';
import { fetch } from 'undici';

const config = JSON.parse(fs.readFileSync('src/config/services.json', 'utf8'));

type TestResult = {
  url: string;
  status: 'ok' | 'error' | 'timeout';
  responseTime: number;
  error?: string;
  featureCount?: number;
};

async function testEndpoint(url: string, timeout = 10000): Promise<TestResult> {
  const start = Date.now();
  try {
    // Test with a small query first
    const testUrl = url.includes('?') ?
      `${url}&f=json&where=1=1&returnCountOnly=true` :
      `${url}?f=json&where=1=1&returnCountOnly=true`;

    const res = await fetch(testUrl, {
      // @ts-ignore
      timeout,
      headers: { 'User-Agent': 'backyard-scout/1.0' }
    });

    const responseTime = Date.now() - start;

    if (!res.ok) {
      return { url, status: 'error', responseTime, error: `HTTP ${res.status}` };
    }

    const json = await res.json() as any;
    if (json.error) {
      return { url, status: 'error', responseTime, error: json.error.message };
    }

    return {
      url,
      status: 'ok',
      responseTime,
      featureCount: json.count ?? json.features?.length ?? 0
    };
  } catch (e: any) {
    const responseTime = Date.now() - start;
    if (e.code === 'UND_ERR_CONNECT_TIMEOUT' || responseTime >= timeout) {
      return { url, status: 'timeout', responseTime, error: 'Timeout' };
    }
    return { url, status: 'error', responseTime, error: e.message };
  }
}

async function testRateLimit(url: string, maxRps = 10): Promise<number> {
  console.log(`\n  Testing rate limits for: ${url.substring(0, 60)}...`);

  // Start with 1 RPS and increase
  for (let rps = 1; rps <= maxRps; rps++) {
    const delay = 1000 / rps;
    const testCount = Math.min(rps * 2, 20);
    let failures = 0;

    console.log(`  Testing ${rps} RPS (${testCount} requests)...`);

    const promises: Promise<TestResult>[] = [];
    for (let i = 0; i < testCount; i++) {
      promises.push(testEndpoint(url, 5000));
      await new Promise(r => setTimeout(r, delay));
    }

    const results = await Promise.all(promises);
    failures = results.filter(r => r.status !== 'ok').length;

    if (failures > testCount * 0.1) { // More than 10% failure
      console.log(`  ✗ Failed at ${rps} RPS (${failures}/${testCount} failed)`);
      return Math.max(1, rps - 1);
    }

    console.log(`  ✓ Success at ${rps} RPS`);
  }

  return maxRps;
}

async function testAllServices() {
  console.log('🔍 Testing ArcGIS Service Connectivity...\n');
  console.log('=' . repeat(60));

  const results: Record<string, any> = {};

  // Test counties
  for (const [county, services] of Object.entries(config.counties)) {
    console.log(`\n📍 ${county.toUpperCase()} COUNTY`);
    results[county] = {};

    for (const [service, cfg] of Object.entries(services as any)) {
      const url = (cfg as any).url;
      console.log(`\n  ${service}: Testing primary...`);

      let result = await testEndpoint(url);

      // Try alternates if primary fails
      if (result.status !== 'ok' && (cfg as any).alternates) {
        for (const alt of (cfg as any).alternates) {
          console.log(`  Trying alternate...`);
          result = await testEndpoint(alt);
          if (result.status === 'ok') {
            (cfg as any).url = alt; // Update to working URL
            break;
          }
        }
      }

      results[county][service] = result;

      if (result.status === 'ok') {
        console.log(`  ✅ ${service}: OK (${result.responseTime}ms, ${result.featureCount ?? 'N/A'} features)`);

        // Test rate limit for parcels only
        if (service === 'parcels') {
          const maxRps = await testRateLimit(url, 5);
          results[county][service].maxRps = maxRps;
          config.rate_limits.tested[`${county}_${service}`] = maxRps;
        }
      } else {
        console.log(`  ❌ ${service}: ${result.status} - ${result.error}`);
      }
    }
  }

  // Test OSM
  console.log(`\n📍 OSM NOMINATIM`);
  const osmUrl = config.osm.nominatim.url;
  const osmResult = await testEndpoint(osmUrl + '?q=Thousand+Oaks&format=json', 5000);
  results.osm = osmResult;
  console.log(`  ${osmResult.status === 'ok' ? '✅' : '❌'} Nominatim: ${osmResult.status}`);

  // Test overlays
  console.log(`\n📍 OVERLAYS`);
  results.overlays = {};

  for (const [provider, services] of Object.entries(config.overlays)) {
    for (const [service, cfg] of Object.entries(services as any)) {
      const url = (cfg as any).url;
      const result = await testEndpoint(url);
      results.overlays[`${provider}_${service}`] = result;
      console.log(`  ${result.status === 'ok' ? '✅' : '❌'} ${provider}/${service}: ${result.status}`);
    }
  }

  // Save results
  console.log('\n' + '=' . repeat(60));
  console.log('\n📊 Summary:');

  let working = 0, failed = 0;
  for (const [category, services] of Object.entries(results)) {
    if (typeof services === 'object' && !Array.isArray(services)) {
      for (const result of Object.values(services as any)) {
        if ((result as any).status === 'ok') working++;
        else failed++;
      }
    } else if ((services as any).status === 'ok') {
      working++;
    } else {
      failed++;
    }
  }

  console.log(`  Working: ${working}`);
  console.log(`  Failed: ${failed}`);

  // Update config with tested rate limits
  fs.writeFileSync('src/config/services.json', JSON.stringify(config, null, 2));
  console.log('\n✅ Configuration updated with working URLs and rate limits');

  // Save detailed results
  fs.writeFileSync('out/service_test_results.json', JSON.stringify(results, null, 2));
  console.log('📄 Detailed results saved to out/service_test_results.json');
}

testAllServices().catch(console.error);