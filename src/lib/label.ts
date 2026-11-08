import { ADDITIVES, BY_CODE, type Additive, type Domain, type Yuka } from '../data/additives';

export type ProductKind = 'food' | 'cosmetic' | 'household';
export type ScoringMode = 'evidence' | 'yuka';

export interface GradedIngredient {
  raw: string;                 // text as it appeared on the label
  match?: Additive;            // database hit, if any
  risk: 0 | 1 | 2 | 3 | null;  // effective risk under the chosen mode; null = not in database
  score: number | null;        // per-ingredient /100
  position: number;            // 0 = first on the list
}

export interface LabelAnalysis {
  kind: ProductKind;             // detected or forced product type
  detectedKind: ProductKind;     // what auto-detection thought
  mode: ScoringMode;
  ingredients: GradedIngredient[];
  flagged: GradedIngredient[];   // risk >= 1, worst first, unique by database entry
  score: number;                 // 0..100
  grade: 'excellent' | 'good' | 'poor' | 'bad';
  gradeLabel: string;
  notes: string[];               // explanations of the score
  unknownCount: number;
  negated: string[];             // "paraben-free" style claims we ignored
}

const RISK_SCORE: Record<number, number> = { 0: 100, 1: 75, 2: 45, 3: 15 };
const YUKA_RISK: Record<Yuka, 0 | 1 | 2 | 3> = { green: 0, yellow: 1, orange: 2, red: 3 };

const SUGAR = ADDITIVES.find((a) => a.name === 'Sugar')!;
const HFCS = ADDITIVES.find((a) => a.name === 'High-fructose corn syrup')!;
const DEXTROSE = ADDITIVES.find((a) => a.name === 'Dextrose / glucose syrup')!;
const SUGARS = new Set([SUGAR, HFCS, DEXTROSE]);

/** Normalise OCR noise: curly quotes, odd spaces, common OCR confusions (£102 → E102). */
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[|]/g, 'l')
    .replace(/[£€]\s?(?=\d{3})/g, 'E')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Product-type detection
// ---------------------------------------------------------------------------
const COSMETIC_MARKERS = [
  'aqua', 'parfum', 'fragrance', 'glycerin', 'dimethicone', 'phenoxyethanol', 'cetearyl', 'laureth', 'sodium lauryl',
  'tocopheryl acetate', 'carbomer', 'panthenol', 'niacinamide', 'hyaluron', 'butylene glycol', 'caprylic/capric', 'ci 7', 'ci 1', 'ci 4',
  'paraben', 'cocamidopropyl', 'disodium edta', 'benzyl alcohol', 'linalool', 'limonene', 'may contain', 'apply', 'rinse', 'shampoo', 'spf',
  'octocrylene', 'avobenzone', 'homosalate', 'petrolatum', 'paraffinum', 'squalane', 'ceramide', 'retinol', 'peg-', 'ppg-', 'polysorbate 20',
  'nitrocellulose', 'copolymer', 'isopropyl alcohol', 'ethyl acetate', 'butyl acetate', 'alcohol denat', 'tocopherol', 'cetyl', 'stearate', 'glyceryl', 'sodium hydroxide', 'inci', 'crosspolymer', 'acrylates', 'silica', 'mica', 'talc',
];
const FOOD_MARKERS = [
  'sugar', 'flour', 'salt', 'oil', 'milk', 'wheat', 'eggs', 'egg', 'butter', 'cocoa', 'cheese', 'rice', 'corn', 'soy', 'yeast', 'cream', 'syrup',
  'starch', 'vinegar', 'tomato', 'chicken', 'beef', 'pork', 'fish', 'spices', 'herbs', 'garlic', 'onion', 'calories', 'kcal', 'protein', 'carbohydrate', 'serving',
  'nutrition facts', 'allergen', 'contains:', 'gluten', 'nuts', 'per 100', 'dietary fibre', 'dietary fiber',
];
const HOUSEHOLD_MARKERS = [
  'hazard', 'danger', 'warning', 'keep out of reach', 'flammable', 'corrosive', 'surfactants', 'anionic', 'non-ionic', 'bleach', 'sodium hypochlorite',
  'detergent', 'disinfectant', 'solvent', 'paint', 'adhesive', 'pesticide', 'insecticide', 'caution', 'first aid', 'ventilat', 'sds', 'safety data sheet',
];

function countMarkers(hay: string, list: string[]): number {
  let n = 0;
  for (const m of list) if (hay.includes(m)) n++;
  return n;
}

export function detectKind(text: string): ProductKind {
  const t = clean(text).toLowerCase();
  const c = countMarkers(t, COSMETIC_MARKERS);
  const f = countMarkers(t, FOOD_MARKERS);
  const h = countMarkers(t, HOUSEHOLD_MARKERS);
  // Household needs clear signals; cosmetics beat food when INCI-style words dominate.
  if (h >= 3 && h >= c && h >= f) return 'household';
  if (c >= 2 && c >= f) return 'cosmetic';
  return 'food';
}

function inDomain(a: Additive, kind: ProductKind): boolean {
  const d: Domain = a.domain ?? 'any';
  if (d === 'any') return true;
  return d === kind;
}

// ---------------------------------------------------------------------------
// Text → ingredients
// ---------------------------------------------------------------------------

/** Pull the ingredient list out of a whole-label OCR dump. */
export function extractIngredientText(text: string): string {
  let t = clean(text);
  const start = t.search(/\b(ingredients?|ingr[eé]dients?|composition|inci)\s*[:\-–]?/i);
  if (start >= 0) t = t.slice(start).replace(/^\w+\s*[:\-–]?\s*/i, '');
  const stop = t.search(/\b(contains?\s*[:\-]|allergen|allergy advice|nutrition|nutritional|may contain|storage|store in|manufactured|produced by|best before|net wt|net weight|distributed by|keep refrigerated|directions|how to use|warning|caution)\b/i);
  if (stop > 20) t = t.slice(0, stop);
  return t.trim();
}

const NEGATION = /(^|\W)(no|without|free\s+(of|from)|does\s+not\s+contain|contains\s+no|0\s?%)\s+|[\s-]free\b|\bfree\b/i;

/** Split the ingredient text into individual ingredient strings, flattening parentheses. */
export function splitIngredients(text: string): { parts: string[]; negated: string[] } {
  const t = text.replace(/\band\/or\b/gi, ',').replace(/\b(and|&)\b/gi, ',');
  const raw = t
    .split(/[,;.:()\[\]{}\n•·*]+/)
    .map((p) => p.replace(/^[\s\-–—%\d.]+|[\s\-–—]+$/g, '').trim())
    .map((p) => p.replace(/\s{2,}/g, ' '))
    .filter((p) => p.length >= 2 && /[a-z]/i.test(p));
  const seen = new Set<string>();
  const parts: string[] = [];
  const negated: string[] = [];
  for (const p of raw) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    // "paraben-free", "no added sugar", "free from sulfates" are claims, not ingredients.
    if (NEGATION.test(k)) { negated.push(p); continue; }
    parts.push(p);
    if (parts.length >= 100) break;
  }
  return { parts, negated };
}

function hasWord(hay: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Aliases that end in "-" (peg-, ppg-) are prefixes: allow digits straight after.
  const tail = needle.endsWith('-') ? '' : '([^a-z0-9]|$)';
  return new RegExp(`(^|[^a-z0-9])${esc}${tail}`, 'i').test(hay);
}

/** Bounded Levenshtein distance (returns max+1 when exceeded). */
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Match one ingredient string against the database, honouring the product type. */
export function matchIngredient(raw: string, kind: ProductKind = 'food'): Additive | undefined {
  const s = raw.toLowerCase();
  const pool = ADDITIVES.filter((a) => inDomain(a, kind));

  // E-numbers / INS numbers, incl. OCR forms like "E 102" or "e-102"
  const code = s.match(/\b(?:e|ins)[\s\-]?(\d{3,4}[a-z]?)\b/);
  if (code) {
    const hit = pool.find((a) => a.aliases.some((al) => al === `e${code[1]}` || al === `ins ${code[1]}`) || a.code?.toLowerCase() === `e${code[1]}`) ?? BY_CODE[code[1]];
    if (hit && inDomain(hit, kind)) return hit;
  }
  const bare = s.match(/^(\d{3,4}[a-z]?)$/); // some labels list "102" alone
  if (bare && BY_CODE[bare[1]] && inDomain(BY_CODE[bare[1]], kind)) return BY_CODE[bare[1]];

  // Longest alias first so "sodium nitrite" beats "nitrite", "sodium benzoate" beats "benzoate".
  let best: { a: Additive; len: number } | undefined;
  for (const a of pool) {
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
    for (const a of pool) {
      for (const al of a.aliases) {
        if (al.length < 7 || /\d/.test(al)) continue;
        const max = al.length >= 12 ? 2 : 1;
        if (lev(word, al, max) <= max) return a;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
const GRADES: Array<[number, LabelAnalysis['grade'], string]> = [
  [75, 'excellent', 'Excellent'], [50, 'good', 'Good'], [25, 'poor', 'Poor'], [0, 'bad', 'Bad'],
];

/** Effective risk of an entry under the chosen scoring mode. */
export function effectiveRisk(a: Additive, mode: ScoringMode): 0 | 1 | 2 | 3 {
  if (mode === 'yuka' && a.yuka) return Math.max(a.risk, YUKA_RISK[a.yuka]) as 0 | 1 | 2 | 3;
  return a.risk;
}

export interface AnalyzeOptions {
  kind?: ProductKind | 'auto';
  mode?: ScoringMode;
}

/** Full deterministic analysis of a label text. */
export function analyzeLabel(text: string, opts: AnalyzeOptions = {}): LabelAnalysis {
  const mode: ScoringMode = opts.mode ?? 'evidence';
  const detectedKind = detectKind(text);
  const kind: ProductKind = !opts.kind || opts.kind === 'auto' ? detectedKind : opts.kind;

  const body = extractIngredientText(text);
  const { parts, negated } = splitIngredients(body);
  const grade1 = (a: Additive | undefined): 0 | 1 | 2 | 3 | null => (a ? effectiveRisk(a, mode) : null);

  const ingredients: GradedIngredient[] = parts.map((raw, position) => {
    const match = matchIngredient(raw, kind);
    const risk = grade1(match);
    return { raw, match, risk, score: risk == null ? null : RISK_SCORE[risk], position };
  });

  // Product-level sweep over the WHOLE text (name on the front, "uncured", etc.) — food only.
  const whole = clean(text).toLowerCase();
  const extra: GradedIngredient[] = [];
  if (kind === 'food') {
    for (const a of ADDITIVES.filter((x) => x.cat === 'product type' || x.name.startsWith('Celery'))) {
      if (ingredients.some((i) => i.match === a)) continue;
      if (a.aliases.some((al) => hasWord(whole, al))) {
        const r = grade1(a)!;
        extra.push({ raw: a.name, match: a, risk: r, score: RISK_SCORE[r], position: 999 });
      }
    }
  }

  const all = [...ingredients, ...extra];
  const notes: string[] = [];
  let score = 100;

  // Deduplicate by database entry so three phosphates count once (but note it).
  const seen = new Map<Additive, GradedIngredient[]>();
  for (const g of all) if (g.match) seen.set(g.match, [...(seen.get(g.match) ?? []), g]);

  let high = 0, moderate = 0, low = 0;
  const levelWord = ['', 'limited', 'moderate', 'high'];
  for (const [a, hits] of seen) {
    const r = grade1(a)!;
    const pen = kind === 'cosmetic' ? [0, 6, 15, 30][r] : [0, 4, 12, 30][r];
    if (r === 3) high++; else if (r === 2) moderate++; else if (r === 1) low++;
    if (r > 0) {
      score -= pen;
      const viaYuka = mode === 'yuka' && a.yuka && YUKA_RISK[a.yuka] > a.risk ? ' (Yuka rating)' : '';
      notes.push(`${a.name}: ${levelWord[r]} concern${viaYuka} (−${pen})`);
    }
    if (hits.length > 1 && r >= 2) score -= 3;
  }

  if (kind === 'food') {
    // Sugar position
    const sugarIdx = ingredients.findIndex((g) => g.match && SUGARS.has(g.match));
    if (sugarIdx === 0) { score -= 15; notes.push('Sugar is the first ingredient (−15)'); }
    else if (sugarIdx > 0 && sugarIdx < 3) { score -= 8; notes.push('Sugar is in the top three ingredients (−8)'); }
    const sugarKinds = ingredients.filter((g) => g.match && SUGARS.has(g.match)).length;
    if (sugarKinds >= 3) { score -= 6; notes.push(`${sugarKinds} different sugars listed (−6)`); }

    // Ultra-processing proxy: many additives at all
    const additiveCount = [...seen.keys()].filter((a) => !['ingredient', 'product type', 'protein', 'fat', 'added sugar', 'base ingredient', 'enzyme', 'packaging gas'].includes(a.cat)).length;
    if (additiveCount > 6) { const pen = Math.min(12, (additiveCount - 6) * 2); score -= pen; notes.push(`${additiveCount} additives in total (−${pen})`); }
  }

  // Caps. Food follows Yuka's bands (a high-concern additive can never be "good");
  // cosmetics follow Yuka's rule that the worst ingredient sets the band.
  if (kind === 'cosmetic') {
    if (high > 0) score = Math.min(score, 24);
    else if (moderate > 0) score = Math.min(score, 49);
  } else {
    if (high > 0) score = Math.min(score, mode === 'yuka' ? 49 : 30);
    else if (moderate >= 2) score = Math.min(score, 55);
    else if (moderate === 1) score = Math.min(score, 72);
  }
  if (mode === 'yuka' && kind !== 'cosmetic' && [...seen.keys()].some((a) => a.yuka === 'red')) score = Math.min(score, 49);

  // Floor at 5 so a terrible-but-readable label is distinguishable from "nothing read".
  score = ingredients.length === 0 ? 0 : Math.max(5, Math.min(100, Math.round(score)));

  const [, grade, gradeLabel] = GRADES.find(([min]) => score >= min)!;
  const flagged = all.filter((g) => (g.risk ?? 0) >= 1).sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0) || a.position - b.position);
  const uniq: GradedIngredient[] = [];
  const seenA = new Set<Additive>();
  for (const g of flagged) { if (g.match && seenA.has(g.match)) continue; if (g.match) seenA.add(g.match); uniq.push(g); }

  return {
    kind,
    detectedKind,
    mode,
    ingredients: all,
    flagged: uniq,
    score,
    grade,
    gradeLabel,
    notes,
    unknownCount: ingredients.filter((g) => g.risk == null).length,
    negated,
  };
}
