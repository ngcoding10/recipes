// Regression tests for the label analyser: run with `npm test`.
// Bundles src/lib/label.ts with esbuild, then checks known labels against expected matches and scores.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'label-'));
execFileSync('npx', ['esbuild', 'src/lib/label.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${tmp}/label.mjs`, '--log-level=error'], { cwd: ROOT });
const L = await import(`${tmp}/label.mjs`);
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'public/data', f), 'utf8'));
const ds = L.buildDataset(read('ingredients.json'), read('synonyms.json'));

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; } };
const entry = (raw, kind = 'food') => L.matchIngredient(raw, kind)?.name;
const analyse = (t, o = {}) => L.analyzeLabel(t, { dataset: ds, ...o });
const byRaw = (a, raw) => a.ingredients.find((i) => i.raw.toLowerCase() === raw.toLowerCase());

test('longest match wins inside a segment', () => {
  assert.equal(entry('sodium nitrite'), 'Sodium nitrite');
  assert.equal(entry('peanut butter'), 'Nuts and seeds');
  assert.equal(entry('cocoa butter'), 'Cocoa butter and shea butter');
  assert.equal(entry('modified corn starch'), 'Modified starch');
  assert.equal(entry('beef tallow'), 'Animal fats');
});
test('two ingredients in one segment score as the worse one', () => {
  assert.equal(entry('hydrogenated palm kernel oil'), 'Palm oil');
  assert.equal(entry('cinnamon sugar'), 'Sugar');
});
test('fuzzy matching never turns nitrite into citrate', () => {
  assert.notEqual(entry('sodium citrate'), 'Sodium nitrite');
  assert.equal(entry('tartrazlne'), 'Tartrazine (Yellow 5)');
});
test('fatty alcohols are not ethanol', () => {
  for (const f of ['cetyl alcohol', 'cetearyl alcohol', 'behenyl alcohol', 'benzyl alcohol', 'isopropyl alcohol']) assert.notEqual(entry(f, 'cosmetic'), 'Alcohol (ethanol)', f);
  assert.equal(entry('alcohol denat.', 'cosmetic'), 'Alcohol (ethanol)');
});
test('zero rule: strict cases', () => {
  for (const [raw, name] of [['pure vanilla extract', 'Alcohol-based flavour extracts'], ['smoked paprika', 'Smoked foods'], ['kimchi', 'Traditional Asian pickled vegetables'], ['bacon', 'Processed meat'], ['aspartame', 'Aspartame']]) {
    assert.equal(entry(raw), name, raw);
    assert.equal(L.matchIngredient(raw, 'food').score, 0, raw);
  }
});
test('scope boundaries are not zero', () => {
  for (const raw of ['coffee', 'beta-carotene', 'rice', 'paprika', 'basil', 'chicken', 'olive oil']) assert.ok(L.matchIngredient(raw, 'food').score > 0, raw);
});
test('route-specific on-skin scores', () => {
  const a = analyse('Ingredients: aqua, glycerin, sugar, aloe barbadensis leaf juice, retinyl palmitate, parfum', { kind: 'cosmetic' });
  assert.equal(byRaw(a, 'sugar').score, 90);
  assert.equal(byRaw(a, 'aloe barbadensis leaf juice').score, 92);
  assert.equal(byRaw(a, 'retinyl palmitate').score, 0);
});
test('Spanish label', () => {
  const a = analyse('Ingredientes: harina de trigo, azúcar, aceite de palma, sal, emulgente (lecitina de soja). Puede contener leche.');
  assert.equal(a.kind, 'food');
  assert.equal(byRaw(a, 'azúcar').match.name, 'Sugar');
  assert.equal(byRaw(a, 'aceite de palma').match.name, 'Palm oil');
  assert.equal(byRaw(a, 'sal').match.name, 'Salt');
  assert.ok(!a.ingredients.some((i) => /emulgente|leche/i.test(i.raw)));
});
test('French, Italian, German and Portuguese labels', () => {
  assert.equal(byRaw(analyse('Ingrédients : sucre, huile de palme, noisettes'), 'huile de palme').match.name, 'Palm oil');
  const it = analyse('Ingredienti: farina di frumento, zucchero, uova fresche, sale, vitamina E');
  assert.equal(byRaw(it, 'uova fresche').match.name, 'Eggs');
  assert.ok(byRaw(it, 'vitamina E'), '"vitamina E" stays one ingredient');
  assert.equal(byRaw(analyse('Zutaten: Schweinefleisch, Nitritpökelsalz, Gewürze'), 'Nitritpökelsalz').match.name, 'Sodium nitrite');
  assert.equal(byRaw(analyse('Ingredientes: água, açúcar, conservador benzoato de sódio'), 'água').match.name, 'Water');
});
test('accents fold', () => {
  assert.equal(entry('Crème Fraîche'), 'Cream');
  assert.equal(entry('jalapeño'), 'Vegetables');
});
test('claims are not ingredients', () => {
  const a = analyse('Ingredients: water, sugar. Paraben-free. No added nitrites.');
  assert.ok(a.negated.length >= 1);
  assert.ok(!a.ingredients.some((i) => i.match?.name === 'Sodium nitrite'));
});
test('product score caps', () => {
  const clean = analyse('Ingredients: oats, almonds, dates, cinnamon');
  assert.ok(clean.score >= 90, `clean label scored ${clean.score}`);
  const bad = analyse('Ingredients: pork, water, salt, sodium nitrite');
  assert.ok(bad.score <= 20, `nitrite label scored ${bad.score}`);
});

console.log(process.exitCode ? `\nlabel tests: failures above` : `label tests: ${n} passed`);
