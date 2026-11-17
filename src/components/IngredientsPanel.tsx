import { useMemo, useState } from 'react';
import type { Ingredient } from '../lib/types';
import { formatAmount } from '../lib/format';
import { band } from '../lib/scoring';

interface Props {
  ingredients: Ingredient[];
  baseServings: number;
  /** per-ingredient flag from the ingredient check (lowest flagged score), or null */
  flags?: Array<{ score: number; name: string } | null>;
}

/**
 * Ingredients with a servings scaler and checkable rows.
 * Checkbox state is intentionally in-memory only (React state) — it resets on
 * reload and is never written to localStorage, per the brief.
 */
export default function IngredientsPanel({ ingredients, baseServings, flags = [] }: Props) {
  const [servings, setServings] = useState(baseServings);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());

  const factor = servings / baseServings;

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const scaled = useMemo(
    () =>
      ingredients.map((ing) => ({
        ...ing,
        display: ing.amount != null ? formatAmount(ing.amount * factor) : null,
      })),
    [ingredients, factor]
  );

  const clamp = (n: number) => Math.min(99, Math.max(1, n));

  return (
    <div className="ingredients">
      <div className="ingredients__head">
        <h2 className="section-title" id="ingredients">Ingredients</h2>
        <div className="scaler" role="group" aria-label="Adjust servings">
          <button
            type="button"
            className="scaler__btn"
            onClick={() => setServings((s) => clamp(s - 1))}
            aria-label="Decrease servings"
            disabled={servings <= 1}
          >−</button>
          <span className="scaler__value">
            <strong>{servings}</strong>
            <span className="scaler__unit">{servings === 1 ? 'serving' : 'servings'}</span>
          </span>
          <button
            type="button"
            className="scaler__btn"
            onClick={() => setServings((s) => clamp(s + 1))}
            aria-label="Increase servings"
            disabled={servings >= 99}
          >+</button>
        </div>
      </div>

      {factor !== 1 && (
        <button className="scaler__reset" onClick={() => setServings(baseServings)}>
          Reset to {baseServings}
        </button>
      )}

      <ul className="ingredients__list">
        {scaled.map((ing, i) => {
          const id = `ing-${i}`;
          const isChecked = checked.has(i);
          return (
            <li key={i} className={`ing-row${isChecked ? ' ing-row--done' : ''}`}>
              <input
                type="checkbox"
                id={id}
                className="ing-row__check"
                checked={isChecked}
                onChange={() => toggle(i)}
              />
              <label htmlFor={id} className="ing-row__label">
                {ing.display && (
                  <span className="ing-row__amount">
                    {ing.display}
                    {ing.unit ? ` ${ing.unit}` : ''}
                  </span>
                )}
                <span className="ing-row__item">
                  {ing.item}
                  {ing.note && <span className="ing-row__note"> · {ing.note}</span>}
                </span>
                {flags[i] && (
                  <span
                    className={`ing-flag band-dot band-dot--${band(flags[i]!.score)}`}
                    title={`${flags[i]!.name}: ${flags[i]!.score}/100`}
                    aria-label={`Flagged: ${flags[i]!.name}, score ${flags[i]!.score}`}
                    role="img"
                  />
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
