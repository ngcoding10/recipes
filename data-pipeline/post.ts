// Post-process scored shards for the live site:
//  - flag dictionary (each distinct flagged ingredient once) + product shards that reference it
//  - scanner score for every ingredient-database entry, and a scanner-name -> ingredient-page map
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { matchIngredient, lookupDataset, buildDataset } from './label_memo';

const LIVE = '/home/claude/live';
const SRC = '/home/claude/recipes';
const ds = buildDataset(JSON.parse(readFileSync(`${LIVE}/public/data/ingredients.json`, 'utf8')));
const ING: any[] = JSON.parse(readFileSync(`${SRC}/src/data/ingredients.json`, 'utf8'));

// ---- scanner view of each ingredient-database entry ----
function scannerFor(names: string[]) {
  for (const n of names) {
    const clean = n.replace(/\s*\((?:other|unspecified|class not stated|type not stated)\)\s*/gi, ' ').trim();
    const m = matchIngredient(clean, 'food');
    if (m) return { name: m.name, score: m.score, carc: m.carc?.level ?? '', carcWhy: m.carc?.why ?? '', why: m.why, evidence: m.evidence ?? '', yuka: m.yuka ?? '', source: 'curated' };
    const r = lookupDataset(clean, ds);
    if (r && r.specific) return { name: r.name, score: r.score, carc: r.carc?.level ?? '', carcWhy: r.carc?.why ?? '', why: r.note, evidence: '', yuka: '', source: 'extended' };
  }
  return null;
}
const nameToId = new Map<string, { id: string; products: number }>();
let matched = 0;
for (const d of ING) {
  const s = scannerFor([d.name, ...(d.aliases ?? []).slice(0, 6)]);
  d.scanner = s;
  if (s) {
    matched++;
    const cur = nameToId.get(s.name);
    if (!cur || d.products > cur.products) nameToId.set(s.name, { id: d.id, products: d.products });
  }
}
mkdirSync(`${LIVE}/src/data`, { recursive: true });
writeFileSync(`${LIVE}/src/data/ingredient-db.json`, JSON.stringify(ING));

// ---- products ----
const IN = '/home/claude/scoring/out';
const OUT = `${LIVE}/public/data`;
rmSync(`${OUT}/p`, { recursive: true, force: true });
rmSync(`${OUT}/upc`, { recursive: true, force: true });
mkdirSync(`${OUT}/p`, { recursive: true });
cpSync(`${SRC}/public/data/upc`, `${OUT}/upc`, { recursive: true });
const flagIdx = new Map<string, number>();
const flags: any[] = [];
const brandStats = new Map<string, { n: number; sum: number }>();
const files = readdirSync(IN).filter((f) => f.endsWith('.json'));
let products = 0;
const bands = [0, 0, 0, 0, 0];
for (const f of files) {
  const sh = JSON.parse(readFileSync(`${IN}/${f}`, 'utf8'));
  const P = sh.p.map((p: any[]) => {
    const fl = (p[6] as any[]).map((x) => {
      const key = JSON.stringify(x);
      let i = flagIdx.get(key);
      if (i == null) {
        i = flags.length;
        flagIdx.set(key, i);
        flags.push([x[0], x[1], x[2], x[3], x[4], nameToId.get(x[0])?.id ?? '']);
      }
      return i;
    });
    const key = sh.b[p[0]];
    const st = brandStats.get(key) ?? { n: 0, sum: 0 };
    if (p[5] >= 0) { st.n++; st.sum += p[5]; } brandStats.set(key, st);
    products++;
    if (p[5] >= 0) bands[p[5] >= 75 ? 4 : p[5] >= 50 ? 3 : p[5] >= 25 ? 2 : p[5] > 0 ? 1 : 0]++;
    return [p[0], p[1], p[2], p[3], p[4], p[5], fl, p[7], p[8]];
  });
  writeFileSync(`${OUT}/p/${f}`, JSON.stringify({ b: sh.b, p: P }));
}
writeFileSync(`${OUT}/flags.json`, JSON.stringify(flags));
const brands: any[] = JSON.parse(readFileSync(`${SRC}/public/data/brands.json`, 'utf8'));
for (const b of brands) {
  const st = brandStats.get(b[1]);
  if (st) b[4] = st.n ? Math.round(st.sum / st.n) : -1;
}
writeFileSync(`${OUT}/brands.json`, JSON.stringify(brands));
writeFileSync(`${LIVE}/src/data/product-stats.json`, JSON.stringify({ products, brands: brands.length, shards: files.length, ingredients: ING.length, scannerMatched: matched, gradeCounts: { bad: bands[0] + bands[1], poor: bands[2], good: bands[3], excellent: bands[4] } }));
console.log({ products, shards: files.length, flags: flags.length, ingredients: ING.length, scannerMatched: matched, bands });
