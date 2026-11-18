import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { analyzeLabel, buildDataset } from './label_memo';
const dataset = buildDataset(JSON.parse(readFileSync('/home/claude/live/public/data/ingredients.json', 'utf8')));
let fixed = 0, unreadable = 0;
for (const f of readdirSync('out')) {
  const sh = JSON.parse(readFileSync(`out/${f}`, 'utf8'));
  let changed = false;
  for (const p of sh.p) {
    if (p[5] !== 0 || p[6].length) continue;
    const a = analyzeLabel(p[7].replace(/\bingredients?\b:?/gi, ' '), { kind: 'food', mode: 'evidence', dataset });
    changed = true;
    if (a.ingredients.length === 0) { p[5] = -1; unreadable++; continue; }
    p[5] = a.score;
    p[6] = a.flagged.map((g) => { const e: any = g.match ?? g.ds; return [e?.name ?? g.raw, g.score ?? 0, g.carc?.level === 'classified' ? 'C' : g.carc ? 'L' : '', e?.cat ?? '', g.carc?.why ?? e?.why ?? e?.note ?? '']; });
    fixed++;
  }
  if (changed) writeFileSync(`out/${f}`, JSON.stringify(sh));
}
console.log({ fixed, unreadable });
