import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Ingredient, RecipeData } from '../lib/types';
import { keywordMatches } from '../lib/filters';
import { askClaude, extractJson, getKey, AiError, KEY_EVENT } from '../lib/ai';
import RecipeCard from './RecipeCard';
import IngredientsPanel from './IngredientsPanel';
import ApiKeyBox from './ApiKeyBox';

interface Props {
  recipes: RecipeData[];
  base: string;
}

interface GenRecipe {
  title: string;
  description: string;
  servings: number;
  totalTimeMin: number;
  ingredients: Ingredient[];
  steps: string[];
  tips?: string[];
  nutrition?: { calories?: string; protein?: string; carbs?: string; fat?: string };
  usesFromPantry?: string[];
  needsToBuy?: string[];
}

const QUICK = ['chicken', 'eggs', 'rice', 'pasta', 'salmon', 'beef', 'tofu', 'potatoes', 'spinach', 'tomatoes', 'cheese', 'yogurt', 'oats', 'bananas', 'avocado'];
const MEALS = [
  { v: 'any', l: 'Any meal' }, { v: 'breakfast', l: 'Breakfast' }, { v: 'lunch', l: 'Lunch' }, { v: 'dinner', l: 'Dinner' }, { v: 'snack', l: 'Snack / dessert' },
];
const STAPLES = 'salt, pepper, oil, butter, garlic, onion, common dried herbs and spices, vinegar, soy sauce, flour, sugar';

function ingredientWords(r: RecipeData): string[] {
  const out: string[] = [];
  for (const i of r.ingredients) for (const w of i.item.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.push(w);
  for (const w of r.title.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.push(w);
  return out;
}

export default function Pantry({ recipes, base }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [meal, setMeal] = useState('any');
  const [strict, setStrict] = useState(false);
  const [note, setNote] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [gen, setGen] = useState<GenRecipe | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHasKey(!!getKey());
    const sync = () => setHasKey(!!getKey());
    window.addEventListener(KEY_EVENT, sync);
    return () => window.removeEventListener(KEY_EVENT, sync);
  }, []);

  // restore pantry from URL (?have=a,b) so a list is shareable
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('have');
    if (p) setItems(p.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  }, []);
  useEffect(() => {
    const url = items.length ? `${window.location.pathname}?have=${encodeURIComponent(items.join(','))}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [items]);

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    setItems((prev) => [...prev, ...parts.filter((p) => !prev.includes(p))]);
  };
  const remove = (x: string) => setItems((prev) => prev.filter((p) => p !== x));
  const commit = () => { add(draft); setDraft(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && items.length) setItems((p) => p.slice(0, -1));
  };

  const wordIndex = useMemo(() => new Map(recipes.map((r) => [r.slug, ingredientWords(r)])), [recipes]);

  const matches = useMemo(() => {
    if (!items.length) return [];
    const out: Array<{ r: RecipeData; hits: string[] }> = [];
    for (const r of recipes) {
      if (meal !== 'any' && !r.mealTags.some((m) => (meal === 'snack' ? ['snack', 'dessert', 'side'].includes(m) : m === meal))) continue;
      const words = wordIndex.get(r.slug) ?? [];
      const hits = items.filter((it) => keywordMatches(words, it));
      if (hits.length) out.push({ r, hits });
    }
    out.sort((a, b) => b.hits.length - a.hits.length || a.r.ingredients.length - b.r.ingredients.length || a.r.id.localeCompare(b.r.id));
    return out.slice(0, 30);
  }, [items, meal, recipes, wordIndex]);

  const generate = async () => {
    setBusy(true); setError(''); setGen(null); setCopied(false);
    try {
      const system = `You are a careful home-cooking recipe developer. Write one realistic, cookable recipe using the ingredients the user has.
Rules: metric amounts with a US equivalent; precise temperatures in °F and °C; clear doneness cues; sensible 2-4 servings; no invented brand names.
${strict ? 'Use ONLY the listed ingredients plus basic staples (' + STAPLES + '). Do not add anything else.' : 'Prefer the listed ingredients; you may add a few common extras, and list them under needsToBuy.'}
Reply with JSON only, matching exactly:
{"title":"","description":"one sentence","servings":2,"totalTimeMin":25,
 "ingredients":[{"amount":200,"unit":"g","us":"7 oz","item":"chicken breast, diced","note":""}],
 "steps":["..."],"tips":["..."],
 "nutrition":{"calories":"~450","protein":"35 g","carbs":"40 g","fat":"15 g"},
 "usesFromPantry":["..."],"needsToBuy":["..."]}
Amounts must be numbers (use 0.5 for ½). Nutrition is an estimate per serving.`;
      const user = `I have: ${items.join(', ')}.
Meal: ${meal === 'any' ? 'anything' : meal}.${note ? `\nNotes/preferences: ${note}` : ''}`;
      const text = await askClaude({ system, content: user, maxTokens: 1800, temperature: 0.6 });
      const data = extractJson<GenRecipe>(text);
      if (!data.title || !Array.isArray(data.ingredients) || !Array.isArray(data.steps)) throw new AiError('The recipe came back incomplete. Try again.');
      data.ingredients = data.ingredients.map((i) => ({ ...i, amount: typeof i.amount === 'number' && i.amount > 0 ? i.amount : undefined }));
      setGen(data);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const asText = (g: GenRecipe) => [
    g.title, g.description, '', `Serves ${g.servings} · ${g.totalTimeMin} min`, '', 'Ingredients:',
    ...g.ingredients.map((i) => `- ${[i.amount, i.unit, i.item].filter(Boolean).join(' ')}${i.note ? ` (${i.note})` : ''}`),
    '', 'Method:', ...g.steps.map((s, n) => `${n + 1}. ${s}`),
    ...(g.tips?.length ? ['', 'Tips:', ...g.tips.map((t) => `- ${t}`)] : []),
    ...(g.nutrition?.calories ? ['', `Nutrition (estimate, per serving): ${g.nutrition.calories} kcal, ${g.nutrition.protein ?? ''} protein`] : []),
  ].join('\n');

  const copy = async (g: GenRecipe) => {
    try { await navigator.clipboard.writeText(asText(g)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  return (
    <div className="pantry">
      <div className="card-surface tools__card">
        <div className="tokenbox" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
          <svg className="tokenbox__icon" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><use href="#i-basket" /></svg>
          <div className="tokenbox__tokens">
            {items.map((it) => (
              <span className="ktoken ktoken--green" key={it}>
                {it}
                <button type="button" className="ktoken__x" onClick={(e) => { e.stopPropagation(); remove(it); }} aria-label={`Remove ${it}`}>×</button>
              </span>
            ))}
            <input
              className="tokenbox__input"
              placeholder={items.length ? 'Add another…' : 'Type an ingredient, press Enter'}
              aria-label="Add an ingredient you have"
              value={draft}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={commit}
            />
          </div>
          {items.length > 0 && <button className="tokenbox__clear" onClick={(e) => { e.stopPropagation(); setItems([]); setGen(null); }} aria-label="Clear ingredients">×</button>}
        </div>

        <div className="pantry__quick" aria-label="Quick add">
          {QUICK.filter((q) => !items.includes(q)).slice(0, 10).map((q) => (
            <button key={q} type="button" className="choice" onClick={() => add(q)}>+ {q}</button>
          ))}
        </div>

        <div className="pantry__options">
          <label className="field">
            <span className="field__label">Meal</span>
            <select className="input" value={meal} onChange={(e) => setMeal(e.target.value)}>
              {MEALS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Preferences for the AI recipe (optional)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="high protein, no dairy, 20 minutes…" />
          </label>
        </div>
        <label className="tools__row" style={{ marginTop: '0.8rem', gap: '0.5rem' }}>
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
          <span style={{ color: 'var(--ink-soft)', fontSize: '0.92rem' }}>Only use what I listed (plus salt, oil, spices and basic staples)</span>
        </label>
      </div>

      {/* ------------ From the library ------------ */}
      {items.length > 0 && (
        <section className="pantry__results">
          <div className="pantry__results-head">
            <h2 className="section-title">From your library</h2>
            <span className="tools__muted" style={{ margin: 0 }}>{matches.length ? `${matches.length} recipes use what you have` : 'No library recipe uses these yet'}</span>
          </div>
          {matches.length > 0 && (
            <div className="grid">
              {matches.map(({ r, hits }) => (
                <RecipeCard key={r.slug} recipe={r} href={`${base}/${r.slug}/`} note={`Uses ${hits.length} of your ${items.length}: ${hits.join(', ')}`} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ------------ AI recipe ------------ */}
      <section className="pantry__results">
        <div className="pantry__results-head">
          <h2 className="section-title">Make me a new recipe</h2>
        </div>
        {!hasKey ? (
          <ApiKeyBox compact onChange={setHasKey} />
        ) : (
          <div className="tools__row">
            <button className="btn btn--primary" onClick={generate} disabled={busy || items.length === 0}>
              {busy ? <><span className="spinner" /> Cooking something up…</> : items.length ? 'Generate a recipe from these' : 'Add ingredients first'}
            </button>
            {gen && !busy && <button className="btn btn--ghost" onClick={generate}>Try another</button>}
          </div>
        )}
        {error && <p className="notice notice--red" style={{ marginTop: '0.75rem' }}>{error}</p>}

        {gen && (
          <article className="card-surface tools__card gen">
            <div className="gen__head">
              <span className="pill pill--green" style={{ alignSelf: 'flex-start' }}>AI recipe · estimate</span>
              <h3 className="gen__title">{gen.title}</h3>
              {gen.description && <p className="gen__desc">{gen.description}</p>}
              <dl className="facts" style={{ margin: '0.25rem 0 0' }}>
                {gen.totalTimeMin ? <div className="facts__item"><dt>Total</dt><dd>{gen.totalTimeMin} min</dd></div> : null}
                {gen.servings ? <div className="facts__item"><dt>Serves</dt><dd>{gen.servings}</dd></div> : null}
                {gen.nutrition?.calories ? <div className="facts__item"><dt>Calories</dt><dd>{gen.nutrition.calories.replace(/^~?/, '~')}</dd></div> : null}
                {gen.nutrition?.protein ? <div className="facts__item"><dt>Protein</dt><dd>{gen.nutrition.protein}</dd></div> : null}
              </dl>
            </div>
            <div className="gen__cols">
              <IngredientsPanel ingredients={gen.ingredients} baseServings={gen.servings || 2} />
              <div>
                <h2 className="section-title">Method</h2>
                <ol className="steps">{gen.steps.map((s, i) => <li className="step" key={i}><div className="step__text">{s}</div></li>)}</ol>
                {gen.needsToBuy && gen.needsToBuy.length > 0 && (
                  <p className="gen__why"><strong>You would need to buy:</strong> {gen.needsToBuy.join(', ')}.</p>
                )}
                {gen.tips && gen.tips.length > 0 && (
                  <div className="gen__tips"><strong>Tips</strong><ul>{gen.tips.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
                )}
                <div className="tools__actions">
                  <button className="btn btn--outline btn--sm" onClick={() => copy(gen)}>{copied ? 'Copied!' : 'Copy recipe'}</button>
                </div>
                <p className="tools__hint">Generated by AI from your ingredient list. Quantities, times and nutrition are estimates. Check doneness and food-safety temperatures yourself.</p>
              </div>
            </div>
          </article>
        )}
      </section>
    </div>
  );
}
