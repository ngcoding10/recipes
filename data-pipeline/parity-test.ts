// Dev-only: checks the TypeScript scorer against the Python pipeline's results.
// Usage: node --experimental-strip-types scripts/parity-test.ts <sample.json>
import { readFileSync } from 'node:fs';
import { createScorer } from '../src/lib/scoring.ts';
const data = JSON.parse(readFileSync(new URL('../src/data/scoring.json', import.meta.url), 'utf8'));
const lite = JSON.parse(readFileSync(new URL('../src/data/ingredients-lite.json', import.meta.url), 'utf8'));
const sample: [string, string[]][] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const S = createScorer(data, lite);
let same = 0, diff = 0, missed = 0, extra = 0;
const ex: string[] = [];
const t0 = Date.now();
for (const [text, ids] of sample) {
  const got = S.scoreLabel(text).flagged.map((h) => h.id);
  const a = new Set(ids), b = new Set(got);
  const m = [...a].filter((x) => !b.has(x)), e = [...b].filter((x) => !a.has(x));
  if (!m.length && !e.length) same++;
  else {
    diff++; missed += m.length; extra += e.length;
    if (ex.length < 12) ex.push(`MISSING ${m.join(',')} EXTRA ${e.join(',')} :: ${text.slice(0, 200)}`);
  }
}
console.log(`labels ${sample.length} identical ${same} different ${diff} (${((100 * same) / sample.length).toFixed(3)}%) missedIds ${missed} extraIds ${extra} in ${Date.now() - t0}ms`);
console.log(ex.join('\n'));
