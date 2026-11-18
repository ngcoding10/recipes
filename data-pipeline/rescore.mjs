// Re-score every product, flag and ingredient page with the CURRENT scanner (src/lib/label.ts).
// Run after any change to scores or the matcher, so Products, Ingredients and Scan always agree:
//
//   npm run build:products            (or: node data-pipeline/rescore.mjs)
//
// Works entirely from files in this repo: each product shard in public/data/p keeps its label
// text, so no raw USDA download is needed. Rewrites public/data/p/*.json, public/data/flags.json,
// public/data/brands.json (average scores), src/data/ingredient-db.json (scanner view of each
// ingredient) and src/data/product-stats.json.
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'rescore-'));
execFileSync('npx', ['esbuild', 'src/lib/label.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${tmp}/label.mjs`, '--log-level=error'], { cwd: ROOT });
const { analyzeLabel, buildDataset, matchIngredient, lookupDataset } = await import(`${tmp}/label.mjs`);

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const write = (p, v) => writeFileSync(join(ROOT, p), JSON.stringify(v));
const ds = buildDataset(read('public/data/ingredients.json'), read('public/data/synonyms.json'));

// ---- scanner view of each ingredient-database entry ----
const ING = read('src/data/ingredient-db.json');
function scannerFor(names) {
  for (const n of names) {
    const clean = n.replace(/\s*\((?:other|unspecified|class not stated|type not stated)\)\s*/gi, ' ').trim();
    const m = matchIngredient(clean, 'food');
    if (m) return { name: m.name, score: m.score, carc: m.carc?.level ?? '', carcWhy: m.carc?.why ?? '', why: m.why, evidence: m.evidence ?? '', yuka: m.yuka ?? '', source: 'curated' };
    const r = lookupDataset(clean, ds);
    if (r && r.specific) return { name: r.name, score: r.score, carc: r.carc?.level ?? '', carcWhy: r.carc?.why ?? '', why: r.note, evidence: '', yuka: '', source: 'extended' };
  }
  return null;
}
// A flag links to an ingredient page only when that page's own name reads as the same entry
// (not just one of its aliases), and the page with the most products wins.
const nameToId = new Map();
let matched = 0;
for (const d of ING) {
  d.scanner = scannerFor([d.name, ...(d.aliases ?? []).slice(0, 6)]);
  if (!d.scanner) continue;
  matched++;
  const own = scannerFor([d.name]);
  if (own && own.name === d.scanner.name) {
    const cur = nameToId.get(own.name);
    if (!cur || d.products > cur.products) nameToId.set(own.name, { id: d.id, products: d.products });
  }
}
write('src/data/ingredient-db.json', ING);

// ---- products ----
const flagIdx = new Map();
const flags = [];
const brandStats = new Map();
const bands = [0, 0, 0, 0, 0];
let products = 0, unreadable = 0, changedScore = 0;
const t0 = Date.now();
const files = readdirSync(join(ROOT, 'public/data/p')).filter((f) => f.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b));
const oldFlags = read('public/data/flags.json');
for (const f of files) {
  const sh = read(`public/data/p/${f}`);
  sh.p = sh.p.map((p) => {
    const text = p[7] ?? '';
    // Product texts are bare ingredient lists; the heading makes sure an "ingredients:" inside the
    // list (a sub-ingredient group) is not mistaken for the start.
    let a = analyzeLabel(`Ingredients: ${text}`, { kind: 'food', mode: 'evidence', dataset: ds });
    let score = a.ingredients.length ? a.score : -1;
    if (score < 0) unreadable++;
    if (score !== p[5]) changedScore++;
    const fl = score < 0 ? [] : a.flagged.map((g) => {
      const e = g.match ?? g.ds;
      const x = [e?.name ?? g.raw, g.score ?? 0, g.carc?.level === 'classified' ? 'C' : g.carc ? 'L' : '', e?.cat ?? '', g.carc?.why ?? e?.why ?? e?.note ?? ''];
      const key = JSON.stringify(x);
      let i = flagIdx.get(key);
      if (i == null) { i = flags.length; flagIdx.set(key, i); flags.push([...x, nameToId.get(x[0])?.id ?? '']); }
      return i;
    });
    const bk = sh.b[p[0]];
    const st = brandStats.get(bk) ?? { n: 0, sum: 0 };
    if (score >= 0) { st.n++; st.sum += score; bands[score >= 75 ? 4 : score >= 50 ? 3 : score >= 25 ? 2 : score > 0 ? 1 : 0]++; }
    brandStats.set(bk, st);
    products++;
    return [p[0], p[1], p[2], p[3], p[4], score, fl, p[7], p[8]];
  });
  write(`public/data/p/${f}`, sh);
  if (products % 50000 < sh.p.length) console.log(`  ${products} products, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
write('public/data/flags.json', flags);
const brands = read('public/data/brands.json');
for (const b of brands) { const st = brandStats.get(b[1]); if (st) b[4] = st.n ? Math.round(st.sum / st.n) : -1; }
write('public/data/brands.json', brands);
const stats = read('src/data/product-stats.json');
Object.assign(stats, { products, brands: brands.length, shards: files.length, ingredients: ING.length, scannerMatched: matched, gradeCounts: { bad: bands[0] + bands[1], poor: bands[2], good: bands[3], excellent: bands[4] } });
write('src/data/product-stats.json', stats);
console.log({ products, changedScore, unreadable, flags: flags.length, previousFlags: oldFlags.length, ingredientPagesMatched: matched, bands, seconds: Math.round((Date.now() - t0) / 1000) });
