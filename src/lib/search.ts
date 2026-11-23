/**
 * Typo-tolerant search helpers, used by every search box on the site.
 *
 * The rule everywhere: the page's normal matching runs first; when it finds nothing or very
 * little, close misspellings are added after it ("xantham gum" → Xanthan gum, "chiken" →
 * chicken). fuzzy.js is the shared module from the backend repository, copied unchanged.
 */
import { createFuzzyIndex, editDistance, foldText, wordScore, type FuzzyIndex } from './fuzzy.js';
import type { RecipeData } from './types';

/** The normal search "found very little" below this many results. */
export const FEW = 3;
/** Fuzzy results under this score are guesses and are not shown. */
const MIN_SCORE = 0.55;

/** "E 621", "e-621" and "INS 621" are the same thing as "E621". */
export function normalizeQuery(q: string): string {
  return q.replace(/\b(?:e|ins)[\s-]?(\d{3,4}[a-z]?)\b/gi, 'e$1').replace(/\s+/g, ' ').trim();
}

/** Numbers must be typed exactly: "E612" must never find E621, nor "7up" find "8up". */
const hasNumber = (q: string) => /\d/.test(q);

export interface Fuzzy<T> { search(q: string, o?: { limit?: number; filter?: (item: T) => boolean }): T[] }

/**
 * A fuzzy index over `items`. Nothing is built until the first search.
 * @param textsOf  every name an item can be found by
 * @param weight   tie-breaker: higher first (how common it is)
 * @param primary  the item's main name: an item whose main name matches what was typed comes
 *                 before one that only matches through another name it is known by
 */
export function fuzzyOver<T>(items: T[], textsOf: (item: T) => string | string[], weight?: (item: T) => number, primary?: (item: T) => string): Fuzzy<T> {
  let index: FuzzyIndex<T> | null = null;
  return {
    search(q, { limit = 20, filter } = {}) {
      const query = normalizeQuery(q);
      const typed = foldText(query).split(' ').filter(Boolean);
      if (typed.join('').length < 3 || hasNumber(query)) return [];
      index ??= createFuzzyIndex(items, textsOf, weight ? { weight } : {});
      const found = index.search(query, { limit: primary ? limit * 3 : limit, filter: filter ?? null, minScore: MIN_SCORE }).map((r) => r.item);
      if (!primary) return found;
      return byCloseness(found, query, primary).slice(0, limit);
    },
  };
}

/** How closely a name matches what was typed, in six steps (5 = every word, give or take a typo). */
function closeness(typed: string[], name: string): number {
  const words = foldText(name).split(' ');
  const total = typed.reduce((sum, t) => sum + Math.max(0, ...words.map((w) => wordScore(t, w))), 0);
  return Math.round((total / typed.length) * 5);
}
/** Stable sort: closest main name first; equally close items keep the order they came in. */
function byCloseness<T>(list: T[], query: string, primary: (item: T) => string): T[] {
  const typed = foldText(normalizeQuery(query)).split(' ').filter(Boolean);
  const c = new Map(list.map((item) => [item, closeness(typed, primary(item))] as const));
  return [...list].sort((a, b) => c.get(b)! - c.get(a)!);
}

/**
 * `found` (the normal search's results) plus, when that is nothing or very little, the close
 * misspellings from `fuzzy`, without repeats. Normal results stay first, unless `primary` is
 * given: then whatever's main name is closest to what was typed leads, because the normal
 * search can also hit on an odd spelling stored under a different entry ("potasium sorbate"
 * is a label spelling filed under "Sorbates (other)", but the person wants Potassium sorbate).
 */
export function withFuzzy<T>(found: T[], q: string, fuzzy: Fuzzy<T>, o: { limit?: number; filter?: (item: T) => boolean; primary?: (item: T) => string } = {}): T[] {
  if (found.length >= FEW || !q.trim()) return found;
  const extra = fuzzy.search(q, o);
  if (!extra.length) return found;
  const seen = new Set(found);
  const all = [...found, ...extra.filter((x) => !seen.has(x))];
  return o.primary ? byCloseness(all, q, o.primary) : all;
}

// ---------------------------------------------------------------------------------------------
// Recipes: titles and ingredient names
// ---------------------------------------------------------------------------------------------
const RECIPE_INDEX = new WeakMap<RecipeData[], Fuzzy<RecipeData>>();
export function recipeFuzzy(recipes: RecipeData[]): Fuzzy<RecipeData> {
  let f = RECIPE_INDEX.get(recipes);
  if (!f) {
    f = fuzzyOver(recipes, (r) => [r.title, r.cuisine ?? '', r.protein ?? '', ...(r.keywords ?? []), ...(r.ingredients ?? []).map((i) => i.item.split(',')[0])]);
    RECIPE_INDEX.set(recipes, f);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// Pantry: suggestions while typing, and corrections for misspelled items
// ---------------------------------------------------------------------------------------------
export interface FoodHelper {
  /** Foods to offer while someone types (what they typed so far, typos forgiven). */
  suggest(draft: string, have: string[], limit?: number): string[];
  /** The corrected spelling of a pantry item ("brocoli" → "broccoli"), or null when it looks fine. */
  correct(item: string): string | null;
}

export function foodHelper(foods: string[]): FoodHelper {
  const names = new Set(foods.map((f) => foldText(f)));
  const words: string[] = [];
  const known = new Set<string>();
  for (const f of names) for (const w of f.split(' ')) if (!known.has(w)) { known.add(w); words.push(w); }
  const index = createFuzzyIndex(foods, (f) => f);
  const isKnown = (w: string) => known.has(w) || known.has(w + 's') || known.has(w + 'es') || (w.endsWith('s') && known.has(w.slice(0, -1))) || (w.endsWith('es') && known.has(w.slice(0, -2)));

  /** The closest real food word to a misspelled one, when exactly one is closest. */
  function closest(word: string): string | null {
    if (word.length < 4 || /\d/.test(word)) return null;
    const max = word.length <= 5 ? 1 : 2;
    let best: string | null = null, bestD = max + 1, tie = false;
    for (const w of words) {
      if (Math.abs(w.length - word.length) > max) continue;
      let d = editDistance(word, w, max);
      if (d > max) continue;
      if (w[0] !== word[0]) d += 0.5; // people rarely get the first letter wrong
      if (d < bestD) { best = w; bestD = d; tie = false; } else if (d === bestD) tie = true;
    }
    return best && !tie && bestD <= max ? best : null;
  }

  return {
    suggest(draft, have, limit = 6) {
      const q = foldText(draft);
      if (q.length < 2) return [];
      const taken = new Set(have.map((h) => foldText(h)));
      const ok = (f: string) => !taken.has(foldText(f)) && foldText(f) !== q;
      const starts = foods.filter((f) => ok(f) && (foldText(f).startsWith(q) || foldText(f).split(' ').some((w) => w.startsWith(q))));
      if (starts.length >= limit || q.length < 3) return starts.slice(0, limit);
      const seen = new Set(starts);
      const near = index.search(q, { limit: limit * 2, filter: ok, minScore: MIN_SCORE }).map((r) => r.item).filter((f) => !seen.has(f));
      return [...starts, ...near].slice(0, limit);
    },
    correct(item) {
      const folded = foldText(item);
      if (!folded || names.has(folded)) return null;
      let changed = false;
      const out = folded.split(' ').map((w) => {
        if (isKnown(w)) return w;
        const c = closest(w);
        if (c) { changed = true; return c; }
        return w;
      });
      return changed ? out.join(' ') : null;
    },
  };
}
