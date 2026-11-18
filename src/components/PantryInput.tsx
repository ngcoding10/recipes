import { useState, type KeyboardEvent } from 'react';

const QUICK = ['chicken', 'eggs', 'rice', 'pasta', 'salmon', 'tofu', 'potatoes', 'spinach', 'tomatoes', 'cheese', 'yogurt', 'oats', 'bananas', 'avocado', 'beans', 'onion'];

/** Chip input for "what I have". Enter or comma adds; backspace on empty removes the last one. */
export default function PantryInput({ items, onChange, quick = true }: { items: string[]; onChange: (next: string[]) => void; quick?: boolean }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length) onChange([...items, ...parts.filter((p) => !items.includes(p))]);
  };
  const commit = () => { add(draft); setDraft(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && items.length) onChange(items.slice(0, -1));
  };
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
      {quick && (
        <div className="pantry__quick" aria-label="Quick add">
          {QUICK.filter((q) => !items.includes(q)).slice(0, 10).map((q) => (
            <button key={q} type="button" className="choice" onClick={() => add(q)}>+ {q}</button>
          ))}
        </div>
      )}
    </>
  );
}
