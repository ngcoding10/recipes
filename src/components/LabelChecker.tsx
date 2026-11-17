import { useEffect, useMemo, useState } from 'react';
import ScoreBadge from './ScoreBadge';
import { scorer } from '../lib/scorer';
import { band, BAND_LABEL } from '../lib/scoring';

interface Props {
  base: string;
}

const EXAMPLES: Array<[string, string]> = [
  ['Gummy candy', 'Corn Syrup, Sugar, Hydrogenated Palm Kernel Oil, Citric Acid, Less than 2% of: Tapioca Dextrin, Modified Corn Starch, Natural and Artificial Flavors, Colors (Red 40 Lake, Titanium Dioxide, Yellow 5 Lake, Yellow 6 Lake, Blue 1 Lake, Yellow 6, Red 40, Yellow 5, Blue 1), Sodium Citrate, Carnauba Wax.'],
  ['Diet soda', 'Carbonated Water, Caramel Color, Aspartame, Phosphoric Acid, Potassium Benzoate (to Protect Taste), Natural Flavors, Citric Acid, Caffeine.'],
  ['Protein shake', 'Ultra-Filtered Skim Milk, Cocoa Powder (Processed with Alkali), Natural Flavors, Salt, Cellulose Gel, Cellulose Gum, Carrageenan, Sucralose, Acesulfame Potassium, Vitamin A Palmitate, Vitamin D3.'],
  ['Simple bar', 'Dates, Egg Whites, Cashews, Almonds, Chocolate, Cocoa, Natural Flavors, Sea Salt.'],
];

export default function LabelChecker({ base }: Props) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const res = useMemo(() => (debounced.trim() ? scorer.scoreLabel(debounced) : null), [debounced]);
  const noConcern = res ? res.ingredients.filter((h) => h.score > 85) : [];
  const unknown = res ? res.tokens.filter((t) => t.kind === 'unknown') : [];
  const plain = res ? res.tokens.filter((t) => t.kind === 'plain' || t.kind === 'negated') : [];

  return (
    <div className="checker">
      <div>
        <label htmlFor="label-input" className="prod__section-title" style={{ display: 'block', marginTop: 0 }}>
          Ingredient list
        </label>
        <textarea
          id="label-input"
          className="checker__input"
          placeholder="Paste or type the ingredients exactly as printed, e.g. Sugar, Corn Syrup, Red 40, Natural Flavor…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <div className="suggest checker__examples">
          <span className="suggest__label">Examples</span>
          {EXAMPLES.map(([label, t]) => (
            <button key={label} type="button" className="choice" onClick={() => setText(t)}>{label}</button>
          ))}
          {text && <button type="button" className="link-btn" onClick={() => setText('')}>Clear</button>}
        </div>
      </div>

      <div className="panel-card" aria-live="polite">
        {!res ? (
          <p className="disclaimer" style={{ margin: 0 }}>
            Paste a label and the score appears here. It uses the same rules as the product database, so any ingredient
            scoring 0 makes the whole label 0.
          </p>
        ) : (
          <>
            <div className="result-head">
              <ScoreBadge score={res.score} size="lg" />
              <div>
                <h2 style={{ margin: 0 }}>{BAND_LABEL[band(res.score)]}</h2>
                <p>
                  {res.flagged.length
                    ? `${res.flagged.length} flagged ${res.flagged.length === 1 ? 'ingredient' : 'ingredients'} out of ${res.tokens.length} read from the label.`
                    : `Nothing flagged in ${res.tokens.length} ingredients read from the label.`}
                </p>
              </div>
            </div>

            {res.flagged.length > 0 && (
              <>
                <p className="prod__section-title">Flagged</p>
                <ul className="flag-list">
                  {res.flagged.map((h) => (
                    <li key={h.id}>
                      <a href={`${base}/ingredients/${h.id}/`}>
                        <ScoreBadge score={h.score} size="xs" />
                        <span className="flag-list__name">{h.name}</span>
                        <span className="flag-list__cls">{h.cls}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {noConcern.length > 0 && (
              <details className="fold">
                <summary>{noConcern.length} recognized with no specific concern</summary>
                <div className="token-list">{noConcern.map((h) => <span key={h.id} className="token">{h.name}</span>)}</div>
              </details>
            )}
            {plain.length > 0 && (
              <details className="fold">
                <summary>{plain.length} plain foods or label notes, not scored</summary>
                <div className="token-list">{plain.map((t, i) => <span key={i} className="token">{t.text.toLowerCase()}</span>)}</div>
              </details>
            )}
            {unknown.length > 0 && (
              <details className="fold" open>
                <summary>{unknown.length} not in the database</summary>
                <p className="disclaimer" style={{ marginTop: 0 }}>These were not recognized and are not scored. Check the spelling, or look them up yourself.</p>
                <div className="token-list">{unknown.map((t, i) => <span key={i} className="token token--unknown">{t.text.toLowerCase()}</span>)}</div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
