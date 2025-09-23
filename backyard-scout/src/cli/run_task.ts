import { runUtterance } from '../workflows/router.js';
const utterance = process.argv.slice(2).join(' ').trim();
if (!utterance) {
  console.error('Usage: tsx src/cli/run_task.ts "<request>"');
  process.exit(1);
}
runUtterance(utterance)
  .then((ctx) => {
    console.log('\n✅ Done.');
    if (ctx.export_path) console.log('CSV:', ctx.export_path);
  })
  .catch((e) => {
    console.error('✖', e.message);
    process.exit(1);
  });
