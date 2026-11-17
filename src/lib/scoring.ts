/**
 * INGREDIENT SCORER
 * -----------------
 * Turns a raw ingredient label (or a single recipe ingredient) into scored
 * ingredients, using the same rules as the database build. The patterns live
 * in src/data/scoring.json, exported from the Python pipeline, so the site and
 * the database always agree.
 *
 * Scores run 0 to 100, higher is better. 0 means a carcinogen classification
 * or removal on cancer grounds. Anything at 86 or above is "no specific concern".
 */

export interface ScoringRule {
  name: string;
  cls: string;
  score: number;
  rx: string;
  subs: [string, string][];
  selfSub: boolean;
}
export interface ScoringData {
  parse: Record<'PRE' | 'ALLERG' | 'LEAD' | 'TRAIL' | 'FUNC' | 'KEEPAND', string>;
  rules: ScoringRule[];
  neg: string;
  functxt: string;
  clean: string;
  off: Record<string, string>;
  eexp: Record<string, string>;
}
/** [id, name, score, class] */
export type LiteIngredient = [string, string, number, string];

export interface Hit {
  id: string;
  name: string;
  score: number;
  cls: string;
}
export type TokenKind = 'flagged' | 'no-concern' | 'negated' | 'plain' | 'unknown';
export interface TokenResult {
  text: string;
  depth: number;
  kind: TokenKind;
  hits: Hit[];
}
export interface LabelResult {
  tokens: TokenResult[];
  /** unique ingredients found, lowest score first */
  ingredients: Hit[];
  /** ingredients scoring 85 or less */
  flagged: Hit[];
  score: number;
}

export const FLAG_MAX = 85;

export function slugify(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Python-style str.strip(chars) */
function strip(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

export function norm(t: string): string {
  let s = t.toUpperCase().replace(/&/g, ' AND ').replace(/-/g, ' ');
  s = s.replace(/[^A-Z0-9'%/. ]/g, ' ').replace(/\s+/g, ' ');
  return strip(s, " .'/");
}

/** Combine ingredient scores into one score, the same way products are scored. */
export function combinedScore(scores: number[]): number {
  const flagged = scores.filter((s) => s <= FLAG_MAX);
  if (!flagged.length) return 100;
  const worst = Math.min(...flagged);
  if (worst === 0) return 0;
  const n50 = flagged.filter((s) => s <= 50).length;
  return Math.max(1, worst - Math.min(15, 3 * Math.max(0, n50 - 1)));
}

export type Band = 'zero' | 'high' | 'moderate' | 'limited' | 'clear';
export function band(score: number): Band {
  if (score === 0) return 'zero';
  if (score <= 25) return 'high';
  if (score <= 50) return 'moderate';
  if (score <= 85) return 'limited';
  return 'clear';
}
export const BAND_LABEL: Record<Band, string> = {
  zero: 'Suspected carcinogen',
  high: 'High concern',
  moderate: 'Moderate concern',
  limited: 'Limited concern',
  clear: 'No specific concern',
};

const OPEN = /[(\[{]/;

export function createScorer(data: ScoringData, lite: LiteIngredient[]) {
  const byId = new Map<string, LiteIngredient>(lite.map((l) => [l[0], l]));
  const rules = data.rules.map((r) => ({
    ...r,
    re: new RegExp(r.rx),
    reG: new RegExp(r.rx, 'g'),
    subRe: r.subs.map(([n, rx]) => [n, new RegExp(rx)] as const),
  }));
  const NEG = new RegExp(data.neg);
  const FUNCTXT = new RegExp(data.functxt);
  const CLEAN = new RegExp(data.clean);
  const P = {
    PRE: new RegExp(data.parse.PRE),
    ALLERG: new RegExp(data.parse.ALLERG),
    LEAD: new RegExp(data.parse.LEAD),
    TRAIL: new RegExp(data.parse.TRAIL),
    FUNC: new RegExp(data.parse.FUNC),
    KEEPAND: new RegExp(data.parse.KEEPAND),
  };

  function hitFor(ruleIdx: number, sub: string): Hit {
    const r = rules[ruleIdx];
    const name = sub || (r.subs.length && !r.selfSub ? `${r.name} (other)` : r.name);
    const id = slugify(name);
    const l = byId.get(id);
    return { id, name: l ? l[1] : name, score: r.score, cls: r.cls };
  }

  /** Classify one ingredient (a parsed label token or a recipe line). */
  function classify(tok: string): { hits: Hit[]; neg: boolean } {
    let t = norm(tok);
    if (NEG.test(t)) return { hits: [], neg: true };
    t = t.replace(/THIAMINE? (MONO ?)?NITRATE/g, 'THIAMINE');
    t = t.replace(/\b((RED|YELLOW|BLUE|GREEN|ORANGE) \d+) (ALUMINUM )?LAKES?\b/g, '$1');
    if (/^E ?\d{3,4}[A-Z]?$/.test(t)) {
      const code = t.replace(/ /g, '');
      const exp = data.eexp[code];
      if (exp) t = `${exp} ${code}`;
    }
    const hits: Hit[] = [];
    const t0 = t;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (hits.length && r.name.startsWith('Color (type not stated)')) continue;
      if (r.re.test(t)) {
        let sub = '';
        for (const [sn, srx] of r.subRe) {
          if (srx.test(t0)) {
            sub = sn;
            break;
          }
        }
        hits.push(hitFor(i, sub));
        t = t.replace(r.reG, ' ').replace(/\s+/g, ' ').trim();
        if (!/[A-Z]{3}/.test(t)) break;
      }
    }
    return { hits, neg: false };
  }

  function offAdditive(tok: string): Hit | null {
    const t = norm(tok);
    const id = data.off[t] ?? data.off[t.replace(/^E (\d)/, 'E$1')];
    if (!id) return null;
    const l = byId.get(id);
    return l ? { id, name: l[1], score: l[2], cls: l[3] } : null;
  }

  // ---------------- label parser (port of parse.py) ----------------
  const STRIP_CHARS = " \t\r\n,;:.-*_/\\'\"#";
  function clean(t: string): string {
    t = strip(t, STRIP_CHARS);
    for (let k = 0; k < 3; k++) {
      let t2 = t.replace(P.LEAD, '');
      t2 = strip(t2.replace(P.TRAIL, ''), " ,;:.-*_/\\'\"#");
      if (t2 === t) break;
      t = t2;
    }
    return t.replace(/\s+/g, ' ');
  }
  function splitTop(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if ('([{'.includes(ch)) {
        depth++;
        cur += ch;
      } else if (')]}'.includes(ch)) {
        depth = Math.max(0, depth - 1);
        cur += ch;
      } else if ((ch === ',' || ch === ';') && depth === 0) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function toks(s: string, depth = 0, acc: [string, number][] = []): [string, number][] {
    for (let piece of splitTop(s)) {
      piece = piece.trim();
      if (!piece) continue;
      const m = OPEN.exec(piece);
      if (m) {
        const start = m.index;
        const head = piece.slice(0, start);
        let d = 0;
        let end = piece.length;
        for (let i = start; i < piece.length; i++) {
          if ('([{'.includes(piece[i])) d++;
          else if (')]}'.includes(piece[i])) {
            d--;
            if (d === 0) {
              end = i;
              break;
            }
          }
        }
        const inner = piece.slice(start + 1, end);
        const tail = piece.slice(end + 1);
        const h = clean(head + ' ' + (OPEN.test(tail) ? '' : tail));
        if (h) acc.push([h, depth]);
        if (depth < 4) toks(inner, depth + 1, acc);
        if (OPEN.test(tail) && depth < 4) toks(tail, depth, acc);
      } else {
        const h = clean(piece.replace(/[)\]}]/g, ''));
        if (h) acc.push([h, depth]);
      }
    }
    return acc;
  }
  function parse(text: string): [string, number][] {
    let t = text.toUpperCase().replace(/®/g, '').replace(/™/g, '').replace(/&AMP;/g, '&');
    t = t.replace(/[‘’`]/g, "'").replace(/\s+/g, ' ');
    t = t.replace(/\b(FD ?(&|AND) ?C|D ?& ?C|FDC|F\.D\. ?(&|AND) ?C\.?)\s*/g, '');
    t = t.replace(/\b(RED|YELLOW|BLUE|GREEN|ORANGE|VIOLET)\s*(?:NO\.?|NUMBER|#)?\s*(\d{1,2})\b/g, '$1 $2');
    t = t.trim().replace(P.PRE, '');
    const sents = t.split(/(?<=[A-Z0-9\)\]\*])\.\s+(?=[A-Z\*])/);
    const keep: string[] = [];
    sents.forEach((s, si) => {
      let s2 = s.trim().replace(P.PRE, '');
      if (si > 0 && P.ALLERG.test(s2)) return;
      if (si === 0) s2 = s2.replace(/^CONTAINS?:?\s+/, '');
      keep.push(s2);
    });
    const res: [string, number][] = [];
    const seen = new Set<string>();
    for (const s of keep) {
      for (const [raw, d] of toks(s)) {
        const name0 = raw.replace(/\s*&\s*/g, ' AND ');
        const parts = name0.includes(' AND ') && !P.KEEPAND.test(name0) ? name0.split(' AND ').map(clean) : [name0];
        for (const name of parts) {
          if (d > 0 && /^(NATURAL )?(COLOU?R(S|ING|ANT)?|FLAVOU?R ENHANCER|SWEETENER)$/.test(name)) continue;
          if (name.length < 2 || name.length > 160 || P.FUNC.test(name) || !/[A-Z]/.test(name)) continue;
          if (!seen.has(name)) {
            seen.add(name);
            res.push([name, d]);
          }
        }
      }
    }
    return res;
  }

  /** Classify one token fully: rules, then claims, then plain food, then known additives. */
  function classifyToken(text: string, depth = 0): TokenResult {
    const { hits, neg } = classify(text);
    if (hits.length) {
      const kind: TokenKind = hits.some((h) => h.score <= FLAG_MAX) ? 'flagged' : 'no-concern';
      return { text, depth, kind, hits };
    }
    if (neg) return { text, depth, kind: 'negated', hits: [] };
    const n = norm(text);
    if (FUNCTXT.test(n) || CLEAN.test(n)) return { text, depth, kind: 'plain', hits: [] };
    const a = offAdditive(text);
    if (a) return { text, depth, kind: a.score <= FLAG_MAX ? 'flagged' : 'no-concern', hits: [a] };
    return { text, depth, kind: 'unknown', hits: [] };
  }

  function summarize(tokens: TokenResult[]): LabelResult {
    const uniq = new Map<string, Hit>();
    for (const tk of tokens) for (const h of tk.hits) if (!uniq.has(h.id)) uniq.set(h.id, h);
    const ingredients = [...uniq.values()].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    const flagged = ingredients.filter((h) => h.score <= FLAG_MAX);
    return { tokens, ingredients, flagged, score: combinedScore(ingredients.map((h) => h.score)) };
  }

  /** Score a full printed ingredient label. */
  function scoreLabel(text: string): LabelResult {
    return summarize(parse(text).map(([t, d]) => classifyToken(t, d)));
  }

  /** Score a list of single ingredients (a recipe's ingredient lines). */
  function scoreItems(items: string[]): LabelResult {
    return summarize(items.map((t) => classifyToken(t, 0)));
  }

  return { parse, classify, classifyToken, scoreLabel, scoreItems };
}
