// Consistency audit for every ingredient score on the site.
//   node scripts/audit-scores.mjs            → report only, exit 1 on violations
//   node scripts/audit-scores.mjs --json f   → also write the per-row reconciliation used by the build
//
// Rules checked (see docs/SCORING.md):
//  R1 every curated entry has a score; 0 ⇔ a cancer-link reason
//  R2 an alias may belong to one curated entry only, unless both entries score identically
//  R3 an extended row whose name or spelling IS a curated alias must carry the curated score
//  R4 one spelling → one score across the extended list
//  R5 a combined name ("x and y") scores no higher than its worst recognised part
//  R6 tier labels agree with score bands
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'audit-'));
execFileSync('npx', ['esbuild', 'src/data/additives.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${tmp}/a.mjs`, '--log-level=error'], { cwd: ROOT });
const { ADDITIVES } = await import(`${tmp}/a.mjs`);

export const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9&/\-\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^-+|-+$/g, '');
const problems = [];
const bad = (rule, msg) => problems.push(`${rule}  ${msg}`);

// R1
for (const a of ADDITIVES) {
  if (typeof a.score !== 'number') bad('R1', `${a.name}: no score`);
  else if ((a.score === 0) !== !!a.carc) bad('R1', `${a.name}: score ${a.score} but carc=${!!a.carc}`);
}

// R2 (both the main score and the on-skin score must agree)
const skin = (a) => (a.topical ? a.topical.score : a.score);
const forFood = (a) => { const d = a.domain ?? 'any'; const l = Array.isArray(d) ? d : [d]; return l.includes('any') || l.includes('food'); };
const aliasOwner = new Map();
const allOwner = new Map();
for (const a of ADDITIVES) for (const al of [a.name, ...a.aliases]) {
  const k = norm(al); if (!k) continue;
  const prev = allOwner.get(k);
  if (prev && prev !== a && (prev.score !== a.score || skin(prev) !== skin(a))) bad('R2', `"${k}" → ${prev.name} (${prev.score}/${skin(prev)}) vs ${a.name} (${a.score}/${skin(a)})`);
  if (!prev) allOwner.set(k, a);
  if (forFood(a)) { const p2 = aliasOwner.get(k); if (!p2 || a.score < p2.score) aliasOwner.set(k, a); }
}
// R1b: the route-specific (on-skin) list stays short and explained in docs/SCORING.md
const routeSplit = ADDITIVES.filter((a) => a.topical && a.topical.score !== a.score).map((a) => a.name);

// Extended list
const json = JSON.parse(readFileSync(join(ROOT, 'public/data/ingredients.json'), 'utf8'));
const rows = json.rows;
const band = (s, c) => (c === 1 ? 'classified carcinogen' : c === 2 ? 'cancer link' : s < 25 ? 'high concern' : s < 50 ? 'moderate concern' : s < 75 ? 'limited concern' : 'low concern');
const SPLIT = /\s*(?:,|;|\band\b|&|\bwith\b|\bor\b|\bplus\b|\(|\)|\/)\s*/;
const carcRank = (c) => (c === 1 ? 0 : c === 2 ? 1 : 2); // classified first

const recon = [];   // [index, score, carc, why] for rows the build must change
let r3 = 0, r4 = 0, r5 = 0;
const bySpelling = new Map();
const anchored = new Set(); // rows whose own name is a curated alias: their score is the reference for shared spellings
rows.forEach((r, i) => {
  const [name, score, , , , , , spell, carc] = r;
  const keys = [norm(name), ...spell.map(norm)];
  // R3: exact alias hit on the row's own name
  const hit = aliasOwner.get(norm(name));
  if (hit) anchored.add(i);
  let target = hit ? { score: hit.score, carc: hit.carc ? (hit.carc.level === 'classified' ? 1 : 2) : 0, why: hit.carc ? hit.carc.why : null, src: hit.name } : null;
  // R5: combined names → worst recognised part
  if (!target) {
    const parts = norm(name).split(SPLIT).map((p) => p.trim()).filter((p) => p.length >= 3);
    if (parts.length > 1) {
      let worst = null;
      for (const p of parts) {
        const h = aliasOwner.get(p);
        if (h && (!worst || h.score < worst.score || (h.score === worst.score && (h.carc?.level === 'classified')))) worst = h;
      }
      if (worst && worst.score < score) target = { score: worst.score, carc: worst.carc ? (worst.carc.level === 'classified' ? 1 : 2) : 0, why: worst.carc ? worst.carc.why : null, src: `${worst.name} (worst part)` };
    }
  }
  if (target && (target.score !== score || target.carc !== carc)) {
    if (target.src.endsWith('(worst part)')) r5++; else r3++;
    recon.push([i, target.score, target.carc, target.why, target.src]);
  }
  for (const k of keys) { const arr = bySpelling.get(k) ?? []; arr.push(i); bySpelling.set(k, arr); }
});
// R4 after reconciliation
const finalScore = new Map(rows.map((r, i) => [i, r[1]]));
for (const [i, s] of recon) finalScore.set(i, s);
for (const [k, idxs] of bySpelling) {
  const scores = new Set(idxs.map((i) => finalScore.get(i)));
  if (scores.size > 1) { r4++; if (r4 <= 15) bad('R4', `"${k}" spelled by ${idxs.length} rows with scores ${[...scores].join('/')}: ${idxs.slice(0, 3).map((i) => rows[i][0]).join('; ')}`); }
}
// R6
const band2 = (s, c) => (c === 1 ? 'classified carcinogen' : c === 2 ? 'cancer link' : s < 25 ? 'high concern' : s < 50 ? 'moderate concern' : s < 75 ? 'limited concern' : 'low concern');
let r6 = 0;
rows.forEach((r) => { if (json.tiers[r[2]] !== band2(r[1], r[8])) r6++; });
if (r6) bad('R6', `${r6} extended rows have a tier label that disagrees with their score`);

console.log(`curated entries: ${ADDITIVES.length} | extended rows: ${rows.length} | route-specific on-skin scores: ${routeSplit.length}`);
console.log(`R3 rows to align with curated entries: ${r3} | R5 combined names to lower to worst part: ${r5} | R4 spelling conflicts: ${r4}`);
if (process.argv.includes('--show')) for (const [i, s, c, , src] of recon.slice(0, 400)) console.log(`   ${rows[i][0].slice(0, 50).padEnd(50)} ${String(rows[i][1]).padStart(3)} → ${String(s).padStart(3)}${c ? (c === 1 ? 'C' : 'L') : ' '}  via ${src}`);
if (process.argv.includes('--apply')) {
  const tierIdx = (t) => { let i = json.tiers.indexOf(t); if (i < 0) { json.tiers.push(t); i = json.tiers.length - 1; } return i; };
  const noteIdx = (t) => { let i = json.notes.indexOf(t); if (i < 0) { json.notes.push(t); i = json.notes.length - 1; } return i; };
  for (const [i, sc, c, why, src] of recon) {
    const r = rows[i];
    r[1] = sc; r[8] = c;
    if (c) r[4] = noteIdx(why);
    else if (!src.endsWith('(worst part)')) { const hit = aliasOwner.get(norm(r[0])); if (hit) r[4] = noteIdx(hit.why); }
    else r[4] = noteIdx(`Scored as its worst part: ${src.replace(' (worst part)', '')}`);
    r[5] = 1;
  }
  // misspelling rows and duplicate spellings follow the curated row that shares the spelling,
  // otherwise the lowest score found for that spelling
  for (const [, idxs] of bySpelling) {
    if (idxs.length < 2) continue;
    const anchor = idxs.find((i) => anchored.has(i));
    const best = anchor !== undefined ? anchor : idxs.reduce((m, i) => (rows[i][1] < rows[m][1] || (rows[i][1] === rows[m][1] && carcRank(rows[i][8]) < carcRank(rows[m][8])) ? i : m), idxs[0]);
    for (const i of idxs) if (rows[i][1] !== rows[best][1] || rows[i][8] !== rows[best][8]) { rows[i][1] = rows[best][1]; rows[i][8] = rows[best][8]; rows[i][4] = rows[best][4]; }
  }
  for (const r of rows) r[2] = tierIdx(band(r[1], r[8]));
  writeFileSync(join(ROOT, 'public/data/ingredients.json'), JSON.stringify(json));
  console.log(`applied ${recon.length} curated alignments; spellings unified; tiers recomputed`);
}
const jIdx = process.argv.indexOf('--json');
if (jIdx > 0) writeFileSync(process.argv[jIdx + 1], JSON.stringify(recon));
for (const p of problems) console.log(p);
const blocking = problems.filter((p) => !p.startsWith('R4'));
console.log(blocking.length ? `\n${blocking.length} blocking problems` : '\nno blocking problems');
process.exitCode = blocking.length ? 1 : 0;
