// Tests for the typo-tolerant search helpers (src/lib/search.ts) and the label matcher's
// handling of misspellings: run with `npm test`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'search-'));
writeFileSync(join(tmp, 'entry.ts'), `
export * from '${ROOT}/src/lib/search.ts';
export * as L from '${ROOT}/src/lib/label.ts';
export { keywordMatches, recipeWords } from '${ROOT}/src/lib/filters.ts';
export { FOODS } from '${ROOT}/src/data/foods.ts';
export { ADDITIVES } from '${ROOT}/src/data/additives.ts';
`);
execFileSync('npx', ['esbuild', join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${tmp}/s.mjs`, '--log-level=error'], { cwd: ROOT });
const S = await import(pathToFileURL(join(tmp, 's.mjs')).href);
if (!process.env.KEEP) rmSync(tmp, { recursive: true, force: true }); else console.log(tmp);
const { L } = S;
const json = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };

// ── Ingredient database search (the same rows and matching as the Ingredients page) ──
const rows = json('src/data/ingredient-db.json').map((d) => ({
  name: d.name, products: d.products,
  search: [d.name, d.group, d.class, ...d.e_numbers, ...d.aliases.slice(0, 12), d.scanner?.name ?? ''].join(' ').toLowerCase(),
  names: [d.name, d.scanner?.name ?? '', ...d.e_numbers, ...d.aliases].filter(Boolean),
}));
const ingFuzzy = S.fuzzyOver(rows, (r) => r.names, (r) => r.products, (r) => r.name);
const findIngredient = (q) => {
  const query = S.normalizeQuery(q).toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  const exact = rows.filter((r) => words.every((w) => r.search.includes(w)));
  return S.withFuzzy(exact, query, ingFuzzy, { limit: 12, primary: (r) => r.name }).map((r) => r.name);
};
test('misspelled ingredient names find the right entry', () => {
  const cases = {
    'xantham gum': 'Xanthan gum', 'monosodium glutamte': 'Monosodium glutamate (MSG)', tumeric: 'Turmeric / curcumin',
    caragenan: 'Carrageenan', 'sodum benzoate': 'Sodium benzoate', aspartam: 'Aspartame', 'potasium sorbate': 'Potassium sorbate',
    'titanium dioxde': 'Titanium dioxide', sucralos: 'Sucralose',
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(findIngredient(q)[0], want, `${q} → ${findIngredient(q).slice(0, 3).join(' | ')}`);
});
test('E-numbers: any way of writing one finds it, a different number never does', () => {
  for (const q of ['E407', 'e407', 'E 407', 'e-407', 'INS 407']) assert.ok(findIngredient(q).includes('Carrageenan'), q);
  assert.ok(findIngredient('E415').includes('Xanthan gum'));
  assert.ok(!findIngredient('E470').includes('Carrageenan'));
  assert.deepEqual(S.fuzzyOver(rows, (r) => r.names).search('e471 gum'), [], 'numbers are never matched loosely');
});
test('correct spellings are untouched and nonsense finds nothing', () => {
  const plain = (q) => rows.filter((r) => q.split(' ').every((w) => r.search.includes(w))).map((r) => r.name);
  for (const q of ['sugar', 'red 40', 'gum', 'sodium']) assert.deepEqual(findIngredient(q), plain(q), q);
  assert.deepEqual(findIngredient('zzqqxxyy'), []);
  assert.deepEqual(findIngredient(''), rows.map((r) => r.name));
});

// ── Recipes: titles and ingredient names ──
const recipes = readdirSync(join(ROOT, 'recipes')).filter((f) => f.endsWith('.md')).map((f) => {
  const t = readFileSync(join(ROOT, 'recipes', f), 'utf8');
  const get = (k) => { const m = t.match(new RegExp(`^${k}: (.*)$`, 'm')); return m ? JSON.parse(m[1]) : undefined; };
  return { slug: f.replace(/\.md$/, ''), id: get('id'), title: get('title'), ingredients: get('ingredients') ?? [], keywords: get('keywords') ?? [], mealTags: [], proteinTags: [], dietaryTags: [], tags: [] };
});
recipes.push({ slug: 'test', id: 'T1', title: 'Broccoli Cheddar Soup', ingredients: [{ item: 'broccoli florets' }, { item: 'sharp cheddar, grated' }], keywords: [], mealTags: [], proteinTags: [], dietaryTags: [], tags: [] });
const libraryStrict = (kw) => recipes.filter((r) => S.keywordMatches(S.recipeWords(r), kw));
const library = (kw) => S.withFuzzy(libraryStrict(kw), kw, S.recipeFuzzy(recipes), { limit: 40 });
const mentions = (r, word) => new RegExp(word, 'i').test(r.title + ' ' + r.ingredients.map((i) => i.item).join(' '));
test('misspelled recipe searches find recipes with that food', () => {
  for (const [q, word] of [['chiken', 'chicken'], ['brocoli', 'broccoli'], ['spagetti', 'spaghetti'], ['brocolli', 'broccoli'], ['samon', 'salmon'], ['parmasan', 'parmesan'], ['avacado', 'avocado'], ['mozarela', 'mozzarella'], ['tomatoe', 'tomato']]) {
    const found = library(q);
    assert.ok(found.length > 0, `${q}: nothing found`);
    assert.ok(mentions(found[0], word), `${q} → ${found[0].title}`);
    assert.ok(found.filter((r) => mentions(r, word)).length >= found.length * 0.8, `${q}: too many unrelated recipes (${found.map((r) => r.title).slice(0, 5).join(' | ')})`);
  }
  assert.deepEqual(library('chicken'), libraryStrict('chicken'), 'a correct word is answered by the normal search alone');
  assert.deepEqual(library('zzqqxxyy'), []);
});

// ── Pantry box ──
const foods = S.foodHelper(S.FOODS);
test('pantry: a misspelled item gets a corrected suggestion, a correct one does not', () => {
  const cases = { brocoli: 'broccoli', 'chedar cheese': 'cheddar cheese', tumeric: 'turmeric', chiken: 'chicken', 'chiken brest': 'chicken breast', spagetti: 'spaghetti', avacado: 'avocado', 'greek yoghurt': null, zuchini: 'zucchini', potatos: 'potatoes', parmasan: 'parmesan' };
  for (const [typed, want] of Object.entries(cases)) if (want) assert.equal(foods.correct(typed), want, typed);
  for (const fine of ['broccoli', 'cheddar cheese', 'egg', 'eggs', 'tomato', 'rice', 'oat', 'leftover chicken', 'ham', 'kale', 'beans', 'bean', 'frozen peas', 'xyzzy thing', 'oil', 'r0012']) assert.equal(foods.correct(fine), null, fine);
});
test('pantry: suggestions while typing forgive typos', () => {
  assert.ok(foods.suggest('broc', []).includes('broccoli'));
  assert.ok(foods.suggest('brocoli', []).includes('broccoli'));
  assert.ok(foods.suggest('chedar', []).includes('cheddar cheese'));
  assert.ok(foods.suggest('chiken', [])[0].startsWith('chicken'));
  assert.ok(!foods.suggest('chick', ['chicken']).includes('chicken'), 'never suggests what is already in the pantry');
  assert.deepEqual(foods.suggest('c', []), []);
});

// ── Products: brand names ──
const brands = json('public/data/brands.json');
const brandFuzzy = S.fuzzyOver(brands, (b) => b[0], (b) => b[2]);
test('misspelled brands', () => {
  for (const [q, want] of [['dorritos', 'DORITOS'], ['gatoraid', 'GATORADE'], ['cheerois', 'CHEERIOS'], ['hagen daz', 'HAAGENDAZS'], ['kelogs', 'KELLOGGS'], ['oero', 'OREO']]) {
    const found = brandFuzzy.search(q, { limit: 18 }).map((b) => b[1]);
    assert.ok(found.slice(0, 5).some((k) => k.startsWith(want)), `${q} → ${found.slice(0, 5).join(' | ')}`);
  }
});
test('fast enough for every keystroke on the biggest list (35,000 brands)', () => {
  brandFuzzy.search('warm up');
  const t = performance.now();
  for (const q of ['dorritos', 'gatoraid', 'traider joes', 'kelogs', 'cheerois']) brandFuzzy.search(q);
  const each = (performance.now() - t) / 5;
  assert.ok(each < 60, `${each.toFixed(0)} ms per search`);
});

// ── Labels: a misspelling may be read as the real name, but never loosely ──
const ds = L.buildDataset(json('public/data/ingredients.json'), json('public/data/synonyms.json'));
const read = (text, o = {}) => L.analyzeLabel(`Ingredients: ${text}`, { dataset: ds, kind: 'food', ...o }).ingredients[0];
const nameOf = (g) => (g.match ?? g.ds)?.name;
test('label: close misspellings of long names are read as the real ingredient, and marked', () => {
  for (const [typed, want] of [['xantham gum', /xanth/i], ['monosodium glutamte', /glutam/i], ['sodum benzoate', /sodium benzoate/i], ['carrageenen', /carrageenan/i], ['tartrazlne', /tartrazine/i]]) {
    // curated database alone: read as the real name, marked, and the text as typed is kept
    const g = read(typed, { dataset: null });
    assert.match(nameOf(g) ?? 'nothing', want, typed);
    assert.equal(g.fuzzy, true, `${typed} must be marked as a closest-spelling match`);
    assert.equal(g.raw, typed);
    // with the extended list loaded it is still found (some common misspellings are entries of their own there)
    assert.match(nameOf(read(typed)) ?? 'nothing', want, `${typed} with the extended list`);
  }
  // a typo of a 0-scored name must not fall through to a harmless shorter name inside it
  assert.equal(read('potassium bromte').score, 0);
  assert.equal(read('potassium bromte').fuzzy, true);
  // equally close to two different entries (nitrite / nitrate): not guessed
  assert.equal(L.matchIngredient('sodium nitrlte', 'food', 'fuzzy'), undefined);
  for (const exact of ['xanthan gum', 'monosodium glutamate', 'sodium benzoate', 'carrageenan', 'sugar']) assert.equal(read(exact).fuzzy, undefined, exact);
});
test('label: a harmless ingredient is NOT flagged by a loose match', () => {
  // each of these is one or two letters away from something that scores 0
  const zero = (g) => g.score === 0;
  assert.ok(zero(read('sodium nitrite')) && !read('sodium nitrite').fuzzy, 'sodium nitrite itself scores 0');
  for (const harmless of ['sodium citrate', 'potassium citrate', 'talcum', 'safflower', 'bromelain', 'ethyl vanillin', 'red cabbage', 'carob', 'saffron', 'malt', 'citric acid', 'niacin', 'aloe', 'sucrose', 'styrian pumpkin seed oil', 'benzoin', 'caramel']) {
    const g = read(harmless);
    assert.ok(!(g.fuzzy && zero(g)), `${harmless} was read as ${nameOf(g)} (score 0) by a loose match`);
  }
  // short words are never matched loosely at all, with or without the extended list
  for (const short of ['nitrat', 'talk', 'bha t', 'red3x', 'aspic', 'ham x']) for (const dataset of [ds, null]) assert.ok(!read(short, { dataset }).fuzzy, short);
  // two edits on a medium-length name is too loose for a label (search boxes do allow it)
  assert.equal(read('caragenan', { dataset: null }).score, null);
});
test('label: what is written always wins over a guess', () => {
  // exact names in the extended list are used before any closest-spelling guess from the curated list
  for (const a of S.ADDITIVES) for (const al of a.aliases) {
    if (al.length < 7 || /\d/.test(al) || !L.matchIngredient(al, 'food', 'exact')) continue;
    const g = read(al);
    if (!g) continue; // not a single ingredient once the label is split
    assert.ok(!g.fuzzy, `${al} is in the database as written but was matched loosely`);
  }
});

console.log(`search tests: ${n} passed`);
