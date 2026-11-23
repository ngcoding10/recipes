import { useEffect, useMemo, useState } from 'react';
import type { RecipeData } from '../lib/types';
import { keywordMatches } from '../lib/filters';
import { recipeFuzzy } from '../lib/search';
import { usePantry } from '../lib/usePantry';
import RecipeCard from './RecipeCard';
import PantryInput from './PantryInput';

interface Props {
  recipes: RecipeData[];
  base: string;
}

const MEALS = [
  { v: 'any', l: 'Any meal' }, { v: 'breakfast', l: 'Breakfast' }, { v: 'lunch', l: 'Lunch' }, { v: 'dinner', l: 'Dinner' }, { v: 'snack', l: 'Snack / dessert' },
];

function ingredientWords(r: RecipeData): string[] {
  const out: string[] = [];
  for (const i of r.ingredients) for (const w of i.item.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.push(w);
  for (const w of r.title.toLowerCase().split(/[^a-z0-9]+/)) if (w) out.push(w);
  return out;
}

export default function Pantry({ recipes, base }: Props) {
  const { items, setItems, account } = usePantry();
  const [meal, setMeal] = useState('any');

  // A shared link (?have=a,b) adds those ingredients to the list once.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('have');
    if (!p) return;
    const add = p.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    setItems([...new Set([...items, ...add])]);
    window.history.replaceState(null, '', window.location.pathname);
  }, [items.length === 0]);

  const wordIndex = useMemo(() => new Map(recipes.map((r) => [r.slug, ingredientWords(r)])), [recipes]);

  const matches = useMemo(() => {
    if (!items.length) return [];
    const out: Array<{ r: RecipeData; hits: string[] }> = [];
    // An item that matches no recipe as typed ("brocolli", "chedar") is matched by its closest spelling instead.
    const loose = new Map<string, Set<RecipeData>>();
    for (const it of items) {
      if (!recipes.some((r) => keywordMatches(wordIndex.get(r.slug) ?? [], it))) loose.set(it, new Set(recipeFuzzy(recipes).search(it, { limit: 40 })));
    }
    for (const r of recipes) {
      if (meal !== 'any' && !r.mealTags.some((m) => (meal === 'snack' ? ['snack', 'dessert', 'side'].includes(m) : m === meal))) continue;
      const words = wordIndex.get(r.slug) ?? [];
      const hits = items.filter((it) => loose.get(it)?.has(r) ?? keywordMatches(words, it));
      if (hits.length) out.push({ r, hits });
    }
    out.sort((a, b) => b.hits.length - a.hits.length || a.r.ingredients.length - b.r.ingredients.length || a.r.id.localeCompare(b.r.id));
    return out.slice(0, 30);
  }, [items, meal, recipes, wordIndex]);

  return (
    <div className="pantry">
      <div className="card-surface tools__card">
        <PantryInput items={items} onChange={setItems} />
        <p className="tools__hint">{account ? 'Synced to your account.' : 'Saved on this device.'} The New recipe page uses the same list.</p>

        <div className="field" style={{ marginTop: '1rem' }}>
          <span className="field__label" id="cook-meal">Meal</span>
          <div className="newr__chips" role="radiogroup" aria-labelledby="cook-meal">
            {MEALS.map((m) => (
              <button key={m.v} type="button" role="radio" aria-checked={meal === m.v} className={`choice${meal === m.v ? ' choice--on' : ''}`} onClick={() => setMeal(m.v)}>{m.l}</button>
            ))}
          </div>
        </div>
      </div>

      {items.length === 0 && (
        <p className="pantry__empty">Add a few things from your fridge or cupboard and your matching recipes appear here, best match first.</p>
      )}

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

      {/* ------------ Hand-off to New recipe ------------ */}
      <section className="card-surface tools__card pantry__cta">
        <div>
          <h2 className="section-title">Want something new?</h2>
          <p className="tools__muted" style={{ margin: 0 }}>Turn {items.length ? 'these ingredients' : 'what you have'} into a brand-new breakfast, lunch or dinner recipe.</p>
        </div>
        <a className="btn btn--primary" href={`${base}/new/${meal !== 'any' && meal !== 'snack' ? `?meal=${meal}` : ''}`}>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><use href="#i-spark" /></svg>
          Create a new recipe
        </a>
      </section>
    </div>
  );
}
