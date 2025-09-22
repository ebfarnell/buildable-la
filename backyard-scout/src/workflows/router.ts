import fs from 'node:fs';
import slugify from 'slugify';
import * as ops from '../operators/index.js';

type Step = { op: keyof typeof ops; [k: string]: any };
type Flow = { id: string; patterns: string[]; params: Record<string, any>; pipeline: Step[] };

function loadRegistry(): Flow[] {
  const arr = JSON.parse(fs.readFileSync('src/registry/workflows.json', 'utf8'));
  return arr;
}

function matchFlow(
  utterance: string,
  flows: Flow[],
): { flow: Flow; slotMap: Record<string, string> } | null {
  const u = utterance.toLowerCase();
  for (const f of flows) {
    for (const p of f.patterns) {
      // very simple wildcard match: "find * properties near * college"
      const re = new RegExp('^' + p.replace(/\*/g, '(.+?)').replace(/\s+/g, '\\s+'), 'i');
      const m = u.match(re);
      if (m) {
        // crude slots: $1, $2, etc.
        const slots: Record<string, string> = {};
        for (let i = 1; i < m.length; i++) slots['$' + i] = m[i].trim();

        // Try to extract more specific slots
        if (
          utterance.toLowerCase().includes('college') ||
          utterance.toLowerCase().includes('university')
        ) {
          // Extract college name and city if present
          const collegeMatch = utterance.match(
            /near\s+(?:a\s+)?(?:college|university)\s+in\s+(.+)/i,
          );
          if (collegeMatch) {
            slots['city'] = collegeMatch[1].trim();
            slots['poi_name'] = 'california lutheran'; // default for Thousand Oaks area
          }
          // Handle pattern "find * properties near college in *"
          if (p.includes('properties near college in')) {
            slots['city'] = slots['$2'] || 'Thousand Oaks';
            slots['poi_name'] = 'california lutheran';
            slots['limit'] = slots['$1'] || '10';
          }
        }

        // Extract ZIP codes
        const zipMatch = utterance.match(/\b(\d{5})\b/);
        if (zipMatch) slots['zip'] = zipMatch[1];

        // Extract area names
        const areaMatch = utterance.match(/in\s+([^,]+?)(?:\s*,|\s*$)/i);
        if (areaMatch && !zipMatch) {
          slots['area_name'] = areaMatch[1].trim();
        }

        return { flow: f, slotMap: slots };
      }
    }
  }
  return null;
}

function fill(template: any, ctx: any): any {
  if (typeof template === 'string') {
    // Check if it's a simple variable reference
    if (template.startsWith('${') && template.endsWith('}')) {
      const key = template.slice(2, -1);
      return ctx[key]; // Return the actual value, not stringified
    }
    return template
      .replace(/\$\{([^}]+)\}/g, (_, k) => {
        const val = ctx[k];
        // Don't stringify objects
        if (typeof val === 'object') return val;
        return val ?? '';
      })
      .replace(/\$([0-9]+)/g, (_, i) => ctx[i] ?? '');
  }
  if (Array.isArray(template)) return template.map((v) => fill(v, ctx));
  if (typeof template === 'object' && template) {
    const out: any = {};
    for (const [k, v] of Object.entries(template)) out[k] = fill(v, ctx);
    return out;
  }
  return template;
}

export async function runUtterance(utterance: string) {
  const flows = loadRegistry();
  const hit = matchFlow(utterance, flows);
  if (!hit) throw new Error('No workflow matched. Update src/registry/workflows.json');
  const { flow, slotMap } = hit;

  // seed context
  const ctx: any = { ...flow.params, ...slotMap };
  ctx.task_slug = slugify(utterance, { lower: true, strict: true }).slice(0, 64);

  for (const step of flow.pipeline) {
    const args = fill({ ...step }, ctx);
    const { op, ...params } = args;
    const fn = (ops as any)[op];
    if (!fn) throw new Error('Unknown op ' + op);
    console.log(`→ ${op}`, params);
    await fn(ctx, params);
  }
  return ctx;
}
