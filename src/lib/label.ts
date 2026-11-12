import { ADDITIVES, BY_CODE, type Additive, type Carc, type Domain, type Yuka } from '../data/additives';

export type ProductKind = 'food' | 'cosmetic' | 'household';
export type ScoringMode = 'evidence' | 'yuka';

/** One row of the extended dataset (public/data/ingredients.json, built from data/flagged_ingredients_rated.csv). */
export interface DatasetRow {
  name: string;
  score: number;        // 0..100 as rated in the dataset
  tier: string;         // 'suspected carcinogen' | 'high concern' | 'moderate concern' | 'limited concern' | 'low concern'
  cat: string;
  note: string;
  specific: boolean;    // false = category default rating, informational only
  e: string;
  spell: string[];
  carc?: Carc;          // present when score is 0
}
export interface Dataset {
  rows: DatasetRow[];
  byKey: Map<string, DatasetRow>;
  byFirstWord: Map<string, Array<[string, DatasetRow]>>;
}

export interface GradedIngredient {
  raw: string;                 // text as it appeared on the label
  match?: Additive;            // curated database hit, if any
  ds?: DatasetRow;             // extended-dataset hit, if any (used when no curated hit)
  risk: 0 | 1 | 2 | 3 | null;  // band of the score: <25 high, <50 moderate, <75 limited, else low; null = unknown
  score: number | null;        // per-ingredient /100 (0 = cancer link)
  carc?: Carc;                 // why it scored 0
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
  datasetUsed: boolean;
}

// In Yuka-style mode an ingredient's score is capped by Yuka's own tier.
const YUKA_CAP: Record<Yuka, number> = { green: 100, yellow: 70, orange: 45, red: 15 };
export function bandOf(score: number): 0 | 1 | 2 | 3 { return score < 25 ? 3 : score < 50 ? 2 : score < 75 ? 1 : 0; }

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
  const t = text
    // keep multi-word names that contain "and" together before splitting on it
    .replace(/mono-?\s*(?:and|&)\s*di-?glycerides/gi, 'mono-diglycerides')
    .replace(/natural\s*(?:and|&)\s*artificial\s+(flavou?r(?:ing)?s?)/gi, 'artificial $1')
    .replace(/artificial\s*(?:and|&)\s*natural\s+(flavou?r(?:ing)?s?)/gi, 'artificial $1')
    .replace(/\band\/or\b/gi, ',').replace(/\b(and|&)\b/gi, ',');
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

// ---------------------------------------------------------------------------
// Extended dataset (27k rated label ingredients), lazy-loaded by the page
// ---------------------------------------------------------------------------
export function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9&/\-\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^-+|-+$/g, '');
}

export function buildDataset(json: any): Dataset {
  const rows: DatasetRow[] = (json.rows as any[]).map((r) => ({
    name: r[0], score: r[1], tier: json.tiers[r[2]], cat: json.cats[r[3]], note: json.notes[r[4]], specific: r[5] === 1, e: r[6] || '', spell: r[7] || [],
    carc: r[8] ? { level: r[8] === 1 ? 'classified' : 'linked', why: json.notes[r[4]] } : undefined,
  }));
  const byKey = new Map<string, DatasetRow>();
  const byFirstWord = new Map<string, Array<[string, DatasetRow]>>();
  const add = (k: string, row: DatasetRow) => {
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, row);
    const fw = k.split(' ')[0];
    const arr = byFirstWord.get(fw) ?? [];
    arr.push([k, row]);
    byFirstWord.set(fw, arr);
  };
  for (const row of rows) { add(normKey(row.name), row); for (const sp of row.spell) add(sp, row); if (row.e) add(row.e.toLowerCase(), row); }
  return { rows, byKey, byFirstWord };
}

/** Look one label segment up in the extended dataset: exact, then contained phrase, then fuzzy. */
export function lookupDataset(raw: string, ds: Dataset): DatasetRow | undefined {
  const n = normKey(raw);
  if (!n) return undefined;
  const exact = ds.byKey.get(n);
  if (exact) return exact;
  // Longest dataset key contained in the segment as whole words ("organic cane sugar" → "cane sugar").
  const words = n.split(' ');
  let best: { row: DatasetRow; len: number } | undefined;
  for (let i = 0; i < words.length; i++) {
    const cands = ds.byFirstWord.get(words[i]);
    if (!cands) continue;
    for (const [k, row] of cands) {
      if (k.length < 4 || k.length > n.length) continue;
      if ((n === k || n.startsWith(k + ' ') || n.endsWith(' ' + k) || n.includes(' ' + k + ' ')) && (!best || k.length > best.len)) best = { row, len: k.length };
    }
  }
  if (best) return best.row;
  // Fuzzy: one typo on words of 7+ letters, candidates sharing the first two letters.
  if (n.length >= 7 && !/\d/.test(n)) {
    const pre = n.slice(0, 2);
    for (const [k, row] of ds.byKey) {
      if (!k.startsWith(pre) || Math.abs(k.length - n.length) > 2) continue;
      if (lev(n, k, n.length >= 12 ? 2 : 1) <= (n.length >= 12 ? 2 : 1)) return row;
    }
  }
  return undefined;
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

/** Score of a curated entry under the chosen scoring mode. */
export function effectiveScore(a: Additive, mode: ScoringMode): number {
  return mode === 'yuka' && a.yuka ? Math.min(a.score, YUKA_CAP[a.yuka]) : a.score;
}

export interface AnalyzeOptions {
  kind?: ProductKind | 'auto';
  mode?: ScoringMode;
  dataset?: Dataset | null;    // extended list; applied to food labels only
}

/** Full deterministic analysis of a label text. */
export function analyzeLabel(text: string, opts: AnalyzeOptions = {}): LabelAnalysis {
  const mode: ScoringMode = opts.mode ?? 'evidence';
  const detectedKind = detectKind(text);
  const kind: ProductKind = !opts.kind || opts.kind === 'auto' ? detectedKind : opts.kind;

  const body = extractIngredientText(text);
  const { parts, negated } = splitIngredients(body);
  const fromEntry = (raw: string, match: Additive, position: number): GradedIngredient => {
    const score = effectiveScore(match, mode);
    return { raw, match, risk: bandOf(score), score, carc: match.carc, position };
  };

  const ds = kind === 'food' && opts.dataset ? opts.dataset : null;
  const ingredients: GradedIngredient[] = parts.map((raw, position) => {
    const match = matchIngredient(raw, kind);
    if (match) return fromEntry(raw, match, position);
    const row = ds ? lookupDataset(raw, ds) : undefined;
    // Category-default ratings are informational: shown, but they do not move the product score.
    if (row) return { raw, ds: row, risk: row.specific ? bandOf(row.score) : 0, score: row.score, carc: row.carc, position };
    return { raw, risk: null, score: null, position };
  });

  // Product-level sweep over the WHOLE text (name on the front, "uncured", etc.) — food only.
  const whole = clean(text).toLowerCase();
  const extra: GradedIngredient[] = [];
  if (kind === 'food') {
    for (const a of ADDITIVES.filter((x) => x.cat === 'product type' || x.name.startsWith('Celery'))) {
      if (ingredients.some((i) => i.match === a)) continue;
      if (a.aliases.some((al) => hasWord(whole, al))) extra.push(fromEntry(a.name, a, 999));
    }
  }

  const all = [...ingredients, ...extra];
  const notes: string[] = [];
  let score = 100;

  // One penalty per distinct database entry, so three phosphates count once.
  const seen = new Map<Additive | DatasetRow, GradedIngredient>();
  for (const g of all) {
    const key = g.match ?? (g.ds && g.ds.specific ? g.ds : undefined);
    if (key && !seen.has(key)) seen.set(key, g);
  }

  let classified = 0, linked = 0, high = 0, moderate = 0;
  const cosmetic = kind === 'cosmetic';
  for (const [key, g] of seen) {
    const name = key.name;
    const viaYuka = g.match && mode === 'yuka' && g.match.yuka && YUKA_CAP[g.match.yuka] < g.match.score ? ' (Yuka rating)' : '';
    if (g.carc?.level === 'classified') { classified++; score -= 40; notes.push(`${name}: classified carcinogen, scores 0 (−40)`); }
    else if (g.carc) { linked++; score -= 25; notes.push(`${name}: cancer link, scores 0 (−25)`); }
    else if (g.risk === 3) { high++; score -= 30; notes.push(`${name}: ${g.score}/100, high concern${viaYuka} (−30)`); }
    else if (g.risk === 2) { moderate++; const pen = cosmetic ? 15 : 12; score -= pen; notes.push(`${name}: ${g.score}/100, moderate concern${viaYuka} (−${pen})`); }
    else if (g.risk === 1) { const pen = cosmetic ? 6 : 4; score -= pen; notes.push(`${name}: ${g.score}/100, limited concern${viaYuka} (−${pen})`); }
  }

  if (kind === 'food') {
    const isSugar = (g: GradedIngredient) => (g.match && SUGARS.has(g.match)) || (g.ds && g.ds.cat === 'added sugar / syrup');
    const sugarIdx = ingredients.findIndex(isSugar);
    if (sugarIdx === 0) { score -= 15; notes.push('Sugar is the first ingredient (−15)'); }
    else if (sugarIdx > 0 && sugarIdx < 3) { score -= 8; notes.push('Sugar is in the top three ingredients (−8)'); }
    const sugarKinds = ingredients.filter(isSugar).length;
    if (sugarKinds >= 3) { score -= 6; notes.push(`${sugarKinds} different sugars listed (−6)`); }

    // Ultra-processing proxy: many additives at all
    const NOT_ADDITIVE = ['ingredient', 'product type', 'protein', 'fat', 'added sugar', 'base ingredient', 'enzyme', 'packaging gas',
      'added sugar / syrup', 'oil / fat', 'protein ingredient / dairy derivative', 'processed meat', 'extract / concentrate',
      'refined / treated grain or cocoa', 'starch / carbohydrate filler', 'vitamin / mineral fortificant'];
    const additiveCount = [...seen.keys()].filter((k) => !NOT_ADDITIVE.includes(k.cat)).length;
    if (additiveCount > 6) { const pen = Math.min(12, (additiveCount - 6) * 2); score -= pen; notes.push(`${additiveCount} additives in total (−${pen})`); }
  }

  // Caps: the worst ingredient sets the ceiling.
  if (classified > 0) { score = Math.min(score, 20); notes.push('Contains a classified carcinogen: product capped at 20'); }
  else if (linked > 0) { score = Math.min(score, 45); notes.push('Contains a cancer-linked ingredient: product capped at 45'); }
  else if (cosmetic) {
    if (high > 0) score = Math.min(score, 24);
    else if (moderate > 0) score = Math.min(score, 49);
  } else {
    if (high > 0) score = Math.min(score, mode === 'yuka' ? 49 : 30);
    else if (moderate >= 2) score = Math.min(score, 55);
    else if (moderate === 1) score = Math.min(score, 72);
  }

  // Floor at 5 so a terrible-but-readable label is distinguishable from "nothing read".
  score = ingredients.length === 0 ? 0 : Math.max(5, Math.min(100, Math.round(score)));

  const [, grade, gradeLabel] = GRADES.find(([min]) => score >= min)!;
  const flagged = all.filter((g) => (g.risk ?? 0) >= 1).sort((a, b) => (a.score ?? 100) - (b.score ?? 100) || (a.carc?.level === 'classified' ? 0 : 1) - (b.carc?.level === 'classified' ? 0 : 1) || a.position - b.position);
  const uniq: GradedIngredient[] = [];
  const seenA = new Set<Additive | DatasetRow>();
  for (const g of flagged) { const key = g.match ?? g.ds; if (key && seenA.has(key)) continue; if (key) seenA.add(key); uniq.push(g); }

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
    datasetUsed: !!ds,
  };
}
