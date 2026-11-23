import { useEffect, useMemo, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import type { FoodHelper } from '../lib/search';

const QUICK = ['chicken', 'eggs', 'rice', 'pasta', 'salmon', 'tofu', 'potatoes', 'spinach', 'tomatoes', 'cheese', 'yogurt', 'oats', 'bananas', 'avocado', 'beans', 'onion'];

// The food list and its typo-tolerant index load once, the first time the box is used.
let helper: Promise<FoodHelper> | null = null;
const loadHelper = () => (helper ??= Promise.all([import('../data/foods'), import('../lib/search')]).then(([d, s]) => s.foodHelper(d.FOODS)));

/** Keep the text box focused (and what is typed in it uncommitted) when a suggestion is pressed. */
const keepFocus = (e: SyntheticEvent) => e.preventDefault();

/**
 * Chip input for "what I have". Enter or comma adds; backspace on empty removes the last one.
 * Suggestions appear while typing, typos forgiven; a misspelled item is kept exactly as typed
 * and the corrected spelling is offered next to it.
 */
export default function PantryInput({ items, onChange, quick = true }: { items: string[]; onChange: (next: string[]) => void; quick?: boolean }) {
  const [draft, setDraft] = useState('');
  const [foods, setFoods] = useState<FoodHelper | null>(null);
  const [kept, setKept] = useState<string[]>([]); // misspelling suggestions the person dismissed
  const wanted = draft.length > 0 || items.length > 0;
  useEffect(() => {
    if (!wanted || foods) return;
    let live = true;
    loadHelper().then((h) => { if (live) setFoods(h); }).catch(() => {});
    return () => { live = false; };
  }, [wanted, foods]);

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length) onChange([...items, ...parts.filter((p) => !items.includes(p))]);
  };
  const commit = () => { add(draft); setDraft(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && items.length) onChange(items.slice(0, -1));
  };

  const typing = draft.trim();
  const suggestions = useMemo(() => (foods && typing.length >= 2 ? foods.suggest(typing, items) : []), [foods, typing, items]);
  const fixes = useMemo(() => {
    if (!foods) return [];
    const out: Array<{ from: string; to: string }> = [];
    for (const it of items) {
      if (kept.includes(it)) continue;
      const to = foods.correct(it);
      if (to && to !== it) out.push({ from: it, to });
    }
    return out.slice(0, 4);
  }, [foods, items, kept]);
  const fix = (from: string, to: string) => onChange([...new Set(items.map((it) => (it === from ? to : it)))]);
  const pick = (food: string) => { add(food); setDraft(''); };

  return (
    <>
      <div className="tokenbox" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
        <svg className="tokenbox__icon" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><use href="#i-basket" /></svg>
        <div className="tokenbox__tokens">
          {items.map((it) => (
            <span className="ktoken ktoken--green" key={it}>
              {it}
              <button type="button" className="ktoken__x" onClick={(e) => { e.stopPropagation(); onChange(items.filter((p) => p !== it)); }} aria-label={`Remove ${it}`}>×</button>
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
        {items.length > 0 && <button type="button" className="tokenbox__clear" onClick={(e) => { e.stopPropagation(); onChange([]); }} aria-label="Clear ingredients">×</button>}
      </div>
      {(quick || suggestions.length > 0 || fixes.length > 0) && (
        <div className="pantry__quick" aria-label={suggestions.length ? 'Suggestions' : 'Quick add'}>
          {fixes.map(({ from, to }) => (
            <span key={from} className="choice choice--fix">
              <button type="button" className="choice__main" onMouseDown={keepFocus} onClick={() => fix(from, to)} aria-label={`Change ${from} to ${to}`}><s>{from}</s> → {to}</button>
              <button type="button" className="choice__x" onMouseDown={keepFocus} onClick={() => setKept((k) => [...k, from])} aria-label={`Keep ${from} as typed`}>×</button>
            </span>
          ))}
          {suggestions.length > 0
            ? suggestions.map((s) => <button key={s} type="button" className="choice" onMouseDown={keepFocus} onClick={() => pick(s)}>+ {s}</button>)
            : quick && QUICK.filter((q) => !items.includes(q)).slice(0, 10).map((q) => (
              <button key={q} type="button" className="choice" onClick={() => add(q)}>+ {q}</button>
            ))}
        </div>
      )}
    </>
  );
}
