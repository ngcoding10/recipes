import { ADDITIVES, BY_CODE, type Additive } from '../data/additives';

export interface GradedIngredient {
  raw: string;               // text as it appeared on the label
  match?: Additive;          // database hit, if any
  risk: 0 | 1 | 2 | 3 | null; // null = not in database
  score: number | null;      // per-ingredient /100
  position: number;          // 0 = first on the list
}

export interface LabelAnalysis {
  ingredients: GradedIngredient[];
  flagged: GradedIngredient[];   // risk >= 1, worst first
  score: number;                 // 0..100
  grade: 'excellent' | 'good' | 'poor' | 'bad';
  gradeLabel: string;
  notes: string[];               // explanations of the score
  unknownCount: number;
}

const RISK_SCORE: Record<number, number> = { 0: 100, 1: 75, 2: 45, 3: 15 };
const SUGAR = ADDITIVES.find((a) => a.name === 'Sugar')!;
const HFCS = ADDITIVES.find((a) => a.name === 'High-fructose corn syrup')!;
const DEXTROSE = ADDITIVES.find((a) => a.name === 'Dextrose / glucose syrup')!;

/** Normalise OCR noise: curly quotes, odd spaces, common OCR confusions. */
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[|]/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull the ingredient list out of a whole-label OCR dump. */
export function extractIngredientText(text: string): string {
  let t = clean(text);
  const start = t.search(/ingredients?\s*[:\-–]?/i);
  if (start >= 0) t = t.slice(start).replace(/^ingredients?\s*[:\-–]?\s*/i, '');
  const stop = t.search(/\b(contains?\s*[:\-]|allergen|allergy advice|nutrition|nutritional|may contain|storage|store in|manufactured|produced by|best before|net wt|net weight|distributed by|keep refrigerated)\b/i);
  if (stop > 20) t = t.slice(0, stop);
  return t.trim();
}

/** Split the ingredient text into individual ingredient strings, flattening parentheses. */
export function splitIngredients(text: string): string[] {
  const t = text.replace(/\band\/or\b/gi, ',').replace(/\b(and|&)\b/gi, ',');
  const parts = t
    .split(/[,;.:()\[\]{}\n•·*]+/)
    .map((p) => p.replace(/^[\s\-–—%\d.]+|[\s\-–—]+$/g, '').trim())
    .map((p) => p.replace(/\s{2,}/g, ' '))
    .filter((p) => p.length >= 2 && /[a-z]/i.test(p));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= 80) break;
  }
  return out;
}

function hasWord(hay: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(hay);
}

/** Bounded Levenshtein distance (returns max+1 when exceeded). */
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev.splice(0, prev.length, ...cur);
  }
  return prev[b.length];
}

/** Match one ingredient string against the database. */
export function matchIngredient(raw: string): Additive | undefined {
  const s = raw.toLowerCase();

  // E-numbers / INS numbers, incl. OCR forms like "E 102" or "e-102"
  const code = s.match(/\b(?:e|ins)[\s\-]?(\d{3,4}[a-z]?)\b/);
  if (code && BY_CODE[code[1]]) return BY_CODE[code[1]];
  const bare = s.match(/^(\d{3,4}[a-z]?)$/); // some labels list "102" alone
  if (bare && BY_CODE[bare[1]]) return BY_CODE[bare[1]];

  // Longest alias first so "sodium nitrite" beats "nitrite", "sodium benzoate" beats "benzoate".
  let best: { a: Additive; len: number } | undefined;
  for (const a of ADDITIVES) {
    for (const al of a.aliases) {
      if (/^(?:e|ins )?\d/.test(al)) continue;
      if (al.length < 3) continue;
      if (hasWord(s, al) && (!best || al.length > best.len)) best = { a, len: al.length };
    }
  }
  if (best) return best.a;

  // Fuzzy fallback for OCR typos on longer names ("tartrazlne", "carrageenen").
  const word = s.replace(/[^a-z\s]/g, '').trim();
  if (word.length >= 7) {
    for (const a of ADDITIVES) {
      for (const al of a.aliases) {
        if (al.length < 7 || /\d/.test(al)) continue;
        const max = al.length >= 12 ? 2 : 1;
        if (lev(word, al, max) <= max) return a;
      }
    }
  }
  return undefined;
}

const GRADES: Array<[number, LabelAnalysis['grade'], string]> = [
  [75, 'excellent', 'Excellent'], [50, 'good', 'Good'], [25, 'poor', 'Poor'], [0, 'bad', 'Bad'],
];

/** Full deterministic analysis of a label text. */
export function analyzeLabel(text: string): LabelAnalysis {
  const body = extractIngredientText(text);
  const parts = splitIngredients(body);
  const ingredients: GradedIngredient[] = parts.map((raw, position) => {
    const match = matchIngredient(raw);
    const risk = match ? match.risk : null;
    return { raw, match, risk, score: risk == null ? null : RISK_SCORE[risk], position };
  });

  // Product-level sweep over the WHOLE text (name on the front, "uncured", etc.)
  const whole = clean(text).toLowerCase();
  const extra: GradedIngredient[] = [];
  for (const a of ADDITIVES.filter((x) => x.cat === 'product type' || x.name.startsWith('Celery'))) {
    if (ingredients.some((i) => i.match === a)) continue;
    if (a.aliases.some((al) => hasWord(whole, al))) extra.push({ raw: a.name, match: a, risk: a.risk, score: RISK_SCORE[a.risk], position: 999 });
  }

  const all = [...ingredients, ...extra];
  const notes: string[] = [];
  let score = 100;

  // Deduplicate by database entry so three phosphates count once (but note it).
  const seen = new Map<Additive, GradedIngredient[]>();
  for (const g of all) if (g.match) seen.set(g.match, [...(seen.get(g.match) ?? []), g]);

  let high = 0, moderate = 0, low = 0;
  for (const [a, hits] of seen) {
    if (a.risk === 3) { high++; score -= 30; notes.push(`${a.name}: high concern (−30)`); }
    else if (a.risk === 2) { moderate++; score -= 12; notes.push(`${a.name}: moderate concern (−12)`); }
    else if (a.risk === 1) { low++; score -= 4; notes.push(`${a.name}: limited concern (−4)`); }
    if (hits.length > 1 && a.risk >= 2) { score -= 3; }
  }

  // Sugar position
  const top3 = ingredients.slice(0, 3);
  const sugarIdx = ingredients.findIndex((g) => g.match === SUGAR || g.match === HFCS || g.match === DEXTROSE);
  if (sugarIdx === 0) { score -= 15; notes.push('Sugar is the first ingredient (−15)'); }
  else if (sugarIdx > 0 && sugarIdx < 3) { score -= 8; notes.push('Sugar is in the top three ingredients (−8)'); }
  const sugarKinds = ingredients.filter((g) => g.match === SUGAR || g.match === HFCS || g.match === DEXTROSE).length;
  if (sugarKinds >= 3) { score -= 6; notes.push(`${sugarKinds} different sugars listed (−6)`); }
  void top3;

  // Ultra-processing proxy: many additives at all
  const additiveCount = [...seen.keys()].filter((a) => a.cat !== 'ingredient' && a.cat !== 'product type' && a.cat !== 'protein').length;
  if (additiveCount > 6) { const pen = Math.min(12, (additiveCount - 6) * 2); score -= pen; notes.push(`${additiveCount} additives in total (−${pen})`); }

  // Caps, Yuka-style: one high-concern additive can never score "good".
  if (high > 0) score = Math.min(score, 30);
  else if (moderate >= 2) score = Math.min(score, 55);
  else if (moderate === 1) score = Math.min(score, 72);

  // Floor at 5 so a terrible-but-readable label is distinguishable from "nothing read".
  score = ingredients.length === 0 ? 0 : Math.max(5, Math.min(100, Math.round(score)));

  const [, grade, gradeLabel] = GRADES.find(([min]) => score >= min)!;
  const flagged = all.filter((g) => (g.risk ?? 0) >= 1).sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0) || a.position - b.position);
  // unique by database entry for display
  const uniq: GradedIngredient[] = [];
  const seenA = new Set<Additive>();
  for (const g of flagged) { if (g.match && seenA.has(g.match)) continue; if (g.match) seenA.add(g.match); uniq.push(g); }

  return {
    ingredients: all,
    flagged: uniq,
    score,
    grade,
    gradeLabel,
    notes,
    unknownCount: ingredients.filter((g) => g.risk == null).length,
  };
}
