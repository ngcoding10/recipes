import { useEffect, useMemo, useState } from 'react';
import { generateRecipe } from '../lib/ai';
import { DIETS, MEALS, type GeneratedRecipe, type Meal, type RecipeRequest, type Usage } from '../lib/ai-shared';
import { usePantry } from '../lib/usePantry';
import { deleteSaved, listSaved, saveRecipe, SAVED_EVENT, type SavedRecipe } from '../lib/store';
import { matchIngredient, lookupDataset, buildDataset, type Dataset } from '../lib/label';
import type { Ingredient } from '../lib/types';
import PantryInput from './PantryInput';
import IngredientsPanel from './IngredientsPanel';
import AiAccess from './AiAccess';

const MEAL_INFO: Record<Meal, { label: string; emoji: string; hint: string }> = {
  breakfast: { label: 'Breakfast', emoji: '🍳', hint: 'Eggs, oats, toast, bowls' },
  lunch: { label: 'Lunch', emoji: '🥗', hint: 'Salads, wraps, bowls' },
  dinner: { label: 'Dinner', emoji: '🍲', hint: 'Mains and one-pan meals' },
  snack: { label: 'Snack', emoji: '🥨', hint: 'Bites, dips, small plates' },
  dessert: { label: 'Dessert', emoji: '🍰', hint: 'Something sweet' },
};
const TIMES = [0, 15, 30, 45, 60];

function defaultMeal(): Meal {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : 'dinner';
}

interface Flag { name: string; score: number; carc: string; why: string; items: string[] }

/** Score each ingredient with the same database as the Scan page; list the ones under 75. */
function healthCheck(ings: GeneratedRecipe['ingredients'], ds: Dataset | null): Flag[] {
  const out = new Map<string, Flag>();
  for (const ing of ings) {
    const text = ing.item.split(',')[0];
    const m = matchIngredient(text, 'food');
    let f: Omit<Flag, 'items'> | null = m ? { name: m.name, score: m.score, carc: m.carc?.level ?? '', why: m.carc?.why ?? m.why } : null;
    if (!f && ds) { const r = lookupDataset(text, ds); if (r?.specific) f = { name: r.name, score: r.score, carc: r.carc?.level ?? '', why: r.carc?.why ?? r.note }; }
    if (!f || f.score >= 75) continue;
    const cur = out.get(f.name);
    if (cur) cur.items.push(ing.item); else out.set(f.name, { ...f, items: [ing.item] });
  }
  return [...out.values()].sort((a, b) => a.score - b.score);
}

const risk = (f: Flag) => (f.carc || f.score === 0 ? 'c' : f.score < 25 ? '3' : f.score < 50 ? '2' : f.score < 75 ? '1' : '0');

function toPanel(ings: GeneratedRecipe['ingredients']): Ingredient[] {
  return ings.map((i) => ({
    amount: i.amount > 0 ? i.amount : undefined,
    unit: i.amount > 0 ? i.unit : '',
    us: i.us || undefined,
    item: i.item,
    note: [i.amount > 0 ? '' : i.unit, i.note].filter(Boolean).join(', ') || undefined,
  }));
}

function asText(g: GeneratedRecipe): string {
  return [
    g.title, g.description, '', `Serves ${g.servings} · ${g.totalTimeMin} min · ${g.difficulty}`, '', 'Ingredients:',
    ...g.ingredients.map((i) => `- ${[i.amount > 0 ? i.amount : '', i.amount > 0 ? i.unit : '', i.item].filter(Boolean).join(' ')}${i.amount > 0 ? '' : ` (${i.unit})`}${i.note ? `, ${i.note}` : ''}`),
    '', 'Method:', ...g.steps.map((s, n) => `${n + 1}. ${s}`),
    ...(g.tips.length ? ['', 'Tips:', ...g.tips.map((t) => `- ${t}`)] : []),
    '', `Per serving (estimate): ${g.nutrition.calories} kcal, ${g.nutrition.protein_g} g protein, ${g.nutrition.carbs_g} g carbs, ${g.nutrition.fat_g} g fat`,
  ].join('\n');
}

export default function NewRecipe({ base }: { base: string }) {
  const { items, setItems, account, enabled } = usePantry();
  const [meal, setMeal] = useState<Meal>('dinner');
  const [servings, setServings] = useState(2);
  const [maxMinutes, setMaxMinutes] = useState(0);
  const [diets, setDiets] = useState<string[]>([]);
  const [strict, setStrict] = useState(false);
  const [avoidZero, setAvoidZero] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ recipe: GeneratedRecipe; request: RecipeRequest } | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [saved, setSaved] = useState<SavedRecipe[]>([]);
  const [savedId, setSavedId] = useState('');
  const [copied, setCopied] = useState(false);
  const [ds, setDs] = useState<Dataset | null>(null);

  useEffect(() => {
    setMeal(defaultMeal());
    const q = new URLSearchParams(window.location.search);
    const m = q.get('meal'); if (m && (MEALS as readonly string[]).includes(m)) setMeal(m as Meal);
  }, []);
  // ?have=a,b from the Cook page adds to the pantry once
  useEffect(() => {
    const have = new URLSearchParams(window.location.search).get('have');
    if (have) {
      const add = have.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (add.some((a) => !items.includes(a))) setItems([...items, ...add.filter((a) => !items.includes(a))]);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [items.length === 0]);

  const uid = account?.uid ?? null;
  const refreshSaved = () => listSaved(uid).then(setSaved).catch(() => setSaved([]));
  useEffect(() => {
    refreshSaved();
    window.addEventListener(SAVED_EVENT, refreshSaved);
    return () => window.removeEventListener(SAVED_EVENT, refreshSaved);
  }, [uid]);

  // The extended ingredient list loads only once a recipe is on screen.
  useEffect(() => {
    if (!result || ds) return;
    fetch(`${base}/data/ingredients.json`).then((r) => r.json()).then((j) => setDs(buildDataset(j))).catch(() => {});
  }, [result, ds, base]);

  // The AI runs only for signed-in people.
  const canRun = !!account;

  const run = async () => {
    setBusy(true); setError(''); setSavedId(''); setCopied(false);
    const request: RecipeRequest = { ingredients: items, meal, servings, maxMinutes, diets, strict, avoidZero, note: note.trim() };
    try {
      const { recipe, usage: u } = await generateRecipe(request, !!account);
      setResult({ recipe, request });
      setUsage(u);
      setTimeout(() => document.getElementById('new-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const flags = useMemo(() => (result ? healthCheck(result.recipe.ingredients, ds) : []), [result, ds]);
  const open = (s: SavedRecipe) => { setResult({ recipe: s.recipe, request: s.request ?? { ingredients: [], meal: s.recipe.meal, servings: s.recipe.servings, maxMinutes: 0, diets: [], strict: false, avoidZero: true, note: '' } }); setSavedId(s.id); setTimeout(() => document.getElementById('new-result')?.scrollIntoView({ behavior: 'smooth' }), 50); };
  const save = async () => { if (!result) return; try { setSavedId(await saveRecipe(result.recipe, result.request, uid)); } catch (e: any) { setError(e?.message ?? 'Could not save.'); } };
  const copy = async () => { if (!result) return; try { await navigator.clipboard.writeText(asText(result.recipe)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ } };
  const toggleDiet = (d: string) => setDiets((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));

  const g = result?.recipe;
  return (
    <div className="newr">
      <section className="card-surface tools__card" aria-labelledby="newr-have">
        <h2 className="section-title" id="newr-have">1 · What do you have?</h2>
        <PantryInput items={items} onChange={setItems} />
        <p className="tools__hint">{account ? 'Saved to your account, so it is here on your other devices too.' : 'Saved on this device. The Cook page uses the same list.'}</p>
      </section>

      <section className="card-surface tools__card" aria-labelledby="newr-meal">
        <h2 className="section-title" id="newr-meal">2 · Which meal?</h2>
        <div className="meal-pick" role="radiogroup" aria-labelledby="newr-meal">
          {MEALS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={meal === m} className={`meal-pick__opt${meal === m ? ' meal-pick__opt--on' : ''}`} onClick={() => setMeal(m)}>
              <span className="meal-pick__emoji" aria-hidden="true">{MEAL_INFO[m].emoji}</span>
              <span className="meal-pick__label">{MEAL_INFO[m].label}</span>
              <span className="meal-pick__hint">{MEAL_INFO[m].hint}</span>
            </button>
          ))}
        </div>

        <div className="newr__opts">
          <div className="field">
            <span className="field__label" id="newr-serv">Servings</span>
            <div className="stepper" role="group" aria-labelledby="newr-serv">
              <button type="button" className="stepper__btn" onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Fewer servings" disabled={servings <= 1}>−</button>
              <span className="stepper__val" aria-live="polite">{servings}</span>
              <button type="button" className="stepper__btn" onClick={() => setServings((s) => Math.min(12, s + 1))} aria-label="More servings" disabled={servings >= 12}>+</button>
            </div>
          </div>
          <label className="field">
            <span className="field__label">Time</span>
            <select className="input" value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value))}>
              {TIMES.map((t) => <option key={t} value={t}>{t ? `${t} min or less` : 'Any time'}</option>)}
            </select>
          </label>
        </div>

        <div className="field" style={{ marginTop: '0.9rem' }}>
          <span className="field__label">Diet (optional)</span>
          <div className="newr__chips">
            {DIETS.map((d) => (
              <button key={d} type="button" className={`choice${diets.includes(d) ? ' choice--on' : ''}`} aria-pressed={diets.includes(d)} onClick={() => toggleDiet(d)}>{d}</button>
            ))}
          </div>
        </div>

        <label className="field" style={{ marginTop: '0.9rem' }}>
          <span className="field__label">Anything else? (optional)</span>
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="spicy, one pan, kid-friendly, use up the spinach…" />
        </label>

        <div className="newr__toggles">
          <label className="switch"><input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} /><span>Only use what I listed (plus salt, oil, spices and basic staples)</span></label>
          <label className="switch"><input type="checkbox" checked={avoidZero} onChange={(e) => setAvoidZero(e.target.checked)} /><span>Avoid ingredients this site scores 0 (cancer link)</span></label>
        </div>
      </section>

      <section className="card-surface tools__card newr__go" aria-labelledby="newr-go">
        <h2 className="section-title" id="newr-go">3 · Make it</h2>
        {canRun ? (
          <>
            <button className="btn btn--primary btn--lg" onClick={run} disabled={busy}>
              {busy ? <><span className="spinner" /> Writing your {MEAL_INFO[meal].label.toLowerCase()}…</> : `Create a ${MEAL_INFO[meal].label.toLowerCase()} recipe`}
            </button>
            <p className="tools__hint">
              {`Free with your Google sign-in${usage ? ` · ${usage.used} of ${usage.limit} used today` : ''}.`}
              {' '}{items.length ? `Built from ${items.length} ingredient${items.length > 1 ? 's' : ''}.` : 'No ingredients listed: it will suggest something from basic staples.'}
            </p>
          </>
        ) : (
          <AiAccess />
        )}
        {error && <p className="notice notice--red" style={{ marginTop: '0.75rem' }} role="alert">{error}</p>}
      </section>

      {g && (
        <article id="new-result" key={g.title} className="card-surface tools__card gen rise-in" aria-live="polite">
          <div className="gen__head">
            <span className="pill pill--green" style={{ alignSelf: 'flex-start' }}>New {MEAL_INFO[g.meal]?.label.toLowerCase() ?? 'recipe'} · written by AI</span>
            <h2 className="gen__title display">{g.title}</h2>
            {g.description && <p className="gen__desc">{g.description}</p>}
            <dl className="facts" style={{ margin: '0.25rem 0 0' }}>
              <div className="facts__item"><dt>Total</dt><dd>{g.totalTimeMin} min</dd></div>
              <div className="facts__item"><dt>Serves</dt><dd>{g.servings}</dd></div>
              <div className="facts__item"><dt>Difficulty</dt><dd>{g.difficulty}</dd></div>
              <div className="facts__item"><dt>Calories</dt><dd>~{Math.round(g.nutrition.calories)}</dd></div>
              <div className="facts__item"><dt>Protein</dt><dd>{Math.round(g.nutrition.protein_g)} g</dd></div>
            </dl>
          </div>
          <div className="gen__cols">
            <IngredientsPanel ingredients={toPanel(g.ingredients)} baseServings={g.servings || 2} />
            <div>
              <h2 className="section-title">Method</h2>
              <ol className="steps">{g.steps.map((s, i) => <li className="step" key={i}><div className="step__text">{s}</div></li>)}</ol>
              {g.needsToBuy.length > 0 && <p className="gen__why"><strong>You would need to buy:</strong> {g.needsToBuy.join(', ')}.</p>}
              {g.tips.length > 0 && <div className="gen__tips"><strong>Tips</strong><ul>{g.tips.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
            </div>
          </div>

          <section className="rcheck" aria-labelledby="newr-check">
            <h2 className="section-title" id="newr-check">Ingredient check</h2>
            {flags.length ? (
              <ul className="ingr">
                {flags.map((f) => (
                  <li key={f.name} className={`ingr__row ingr__row--${risk(f)}`}>
                    <span className={`ingr__dot risk--${risk(f)}`} aria-hidden="true" />
                    <div>
                      <div className="ingr__name">{f.name} <span className="ingr__raw">{f.items.map((i) => `“${i}”`).join(', ')}</span></div>
                      {f.carc && <span className={`pill ingr__carc ingr__carc--${f.carc}`}>{f.carc === 'classified' ? 'Classified carcinogen' : 'Cancer link (weaker evidence)'}</span>}
                      <div className="ingr__why">{f.why}</div>
                    </div>
                    <span className="ingr__score">{f.score}/100</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notice notice--green">Every ingredient scores 75 or more in the ingredient database.</p>
            )}
          </section>

          <div className="tools__actions">
            <button className="btn btn--primary" onClick={save} disabled={!!savedId}>{savedId ? 'Saved' : account ? 'Save to my recipes' : 'Save on this device'}</button>
            <button className="btn btn--outline" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
            <button className="btn btn--outline" onClick={() => window.print()}>Print</button>
            {canRun && <button className="btn btn--ghost" onClick={run} disabled={busy}>Try another</button>}
          </div>
          <p className="tools__hint">Written by AI from your ingredient list, not one of the library recipes. Quantities, times and nutrition are estimates; check doneness and food-safety temperatures yourself.</p>
        </article>
      )}

      <section className="newr__saved" aria-labelledby="newr-saved">
        <div className="pantry__results-head">
          <h2 className="section-title" id="newr-saved">My recipes</h2>
          <span className="tools__muted" style={{ margin: 0 }}>{saved.length ? `${saved.length} saved${account ? ' to your account' : ' on this device'}` : 'Recipes you save appear here'}</span>
        </div>
        {saved.length > 0 && (
          <ul className="saved-list">
            {saved.map((s) => (
              <li key={s.id} className="saved-list__item">
                <button type="button" className="saved-list__open" onClick={() => open(s)}>
                  <span className="saved-list__emoji" aria-hidden="true">{MEAL_INFO[s.recipe.meal]?.emoji ?? '🍽️'}</span>
                  <span><span className="saved-list__title">{s.recipe.title}</span><span className="saved-list__meta">{s.recipe.totalTimeMin} min · serves {s.recipe.servings} · {new Date(s.createdAt).toLocaleDateString()}</span></span>
                </button>
                <button type="button" className="saved-list__del" aria-label={`Delete ${s.recipe.title}`} onClick={() => { if (confirm(`Delete “${s.recipe.title}”?`)) deleteSaved(s.id, uid); }}>×</button>
              </li>
            ))}
          </ul>
        )}
        {!account && enabled && saved.length > 0 && <p className="tools__hint">Sign in with Google on the Account page to keep these on every device.</p>}
      </section>
    </div>
  );
}
