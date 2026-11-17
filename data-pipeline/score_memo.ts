// Scores product labels with the site's own scanner engine (src/lib/label.ts).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { analyzeLabel, buildDataset } from './label_memo';

const [, , inDir, outDir, fromStr, toStr] = process.argv;
const dataset = buildDataset(JSON.parse(readFileSync('/home/claude/live/public/data/ingredients.json', 'utf8')));
const files = readdirSync(inDir).filter((f) => f.endsWith('.json')).map((f) => Number(f.replace('.json', ''))).sort((a, b) => a - b);
const from = Number(fromStr ?? 0), to = Number(toStr ?? files.length);
mkdirSync(outDir, { recursive: true });
const cache = new Map<string, any>();
let n = 0;
const t0 = Date.now();
for (const si of files.filter((i) => i >= from && i < to)) {
  const shard = JSON.parse(readFileSync(`${inDir}/${si}.json`, 'utf8'));
  const out: any[] = [];
  for (const p of shard.p) {
    const text: string = p[7];
    let r = cache.get(text);
    if (!r) {
      const a = analyzeLabel(text, { kind: 'food', mode: 'evidence', dataset });
      r = {
        s: a.score,
        f: a.flagged.map((g) => {
          const e: any = g.match ?? g.ds;
          return [e?.name ?? g.raw, g.score ?? 0, g.carc?.level === 'classified' ? 'C' : g.carc ? 'L' : '', e?.cat ?? '', g.carc?.why ?? e?.why ?? e?.note ?? ''];
        }),
        u: a.unknownCount,
      };
      if (cache.size < 200000) cache.set(text, r);
    }
    out.push([p[0], p[1], p[2], p[3], p[4], r.s, r.f, p[7], p[8]]);
    n++;
  }
  writeFileSync(`${outDir}/${si}.json`, JSON.stringify({ b: shard.b, p: out }));
}
console.log(`scored ${n} products in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
