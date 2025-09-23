import { resolveBoundary } from '../area/resolve_boundary.js';
const name = process.argv[2];
const city = process.argv[3];
if (!name) {
  console.error('Usage: tsx src/cli/resolve_area.ts "<neighborhood>" ["<city>"]');
  process.exit(1);
}
resolveBoundary(name, city).then((r) => {
  if (!r) {
    console.error('No boundary found');
    process.exit(2);
  }
  console.log(
    JSON.stringify(
      {
        name: r.name,
        slug: r.slug,
        source: r.source,
        url: r.url,
        saved: `data/boundaries/${r.slug}.geojson`,
      },
      null,
      2,
    ),
  );
});
