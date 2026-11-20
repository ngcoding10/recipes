import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import type { FilterState, RecipeData } from '../lib/types';
import {
  EMPTY_FILTERS,
  MULTI_FIELDS,
  MEAL_TABS,
  TIME_RANGES,
  SORTS,
  activeMealTab,
  buildFacets,
  filtersFromParams,
  filtersToParams,
  matchesFacets,
  sortRecipes,
  countActive,
  recipeWords,
  keywordMatches,
  type MultiField,
} from '../lib/filters';
import { labelize } from '../lib/format';
import RecipeCard from './RecipeCard';

interface Props {
  recipes: RecipeData[];
  base: string;
}

/** Human labels for each filter group. */
const FIELD_LABEL: Record<MultiField, string> = {
  meal: 'Meal',
  protein: 'Protein',
  tags: 'Tags',
  difficulty: 'Difficulty',
  cost: 'Cost',
  verification: 'Source level',
};

const VERIFICATION_LABEL: Record<string, string> = {
  A: 'A · cookable',
  B: 'B · mostly there',
  C: 'C · outline',
  D: 'D · needs caption',
};

/** Groups shown inside the "Filters" sheet (meal lives in the tabs instead). */
const PANEL_FIELDS = MULTI_FIELDS.filter((f) => f !== 'meal');

function optionLabel(field: MultiField, value: string): string {
  if (field === 'verification') return VERIFICATION_LABEL[value] ?? value;
  if (field === 'cost') return value;
  return labelize(value);
}

export default function RecipeLibrary({ recipes, base }: Props) {
  const [filters, setFiltersNow] = useState<FilterState>(EMPTY_FILTERS);
  const gridRef = useRef<HTMLDivElement>(null);
  // Filter changes rearrange the grid with a view transition: cards that stay glide to their new
  // place, others fade. Names are added only for the moment of the transition, so page navigation
  // is not slowed by 91 snapshots. Instant when unsupported or with reduced motion.
  const setFilters = (next: SetStateAction<FilterState>) => {
    const grid = gridRef.current;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };
    if (!grid || !doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { setFiltersNow(next); return; }
    grid.classList.add('grid--vt');
    const t = doc.startViewTransition(() => flushSync(() => setFiltersNow(next)));
    t.ready.catch(() => {}); // a quicker second click skips this transition; that is expected
    t.finished.finally(() => grid.classList.remove('grid--vt'));
  };
  const [draft, setDraft] = useState(''); // the keyword currently being typed
  const [panelOpen, setPanelOpen] = useState(false);
  const hydrated = useRef(false);

  // --- Read filter state from the URL on first mount (bookmark/share support) ---
  useEffect(() => {
    const parsed = filtersFromParams(new URLSearchParams(window.location.search));
    setFiltersNow(parsed);
    hydrated.current = true;
  }, []);

  // --- Keep the URL in sync so any view is bookmarkable/shareable ---
  useEffect(() => {
    if (!hydrated.current) return;
    const params = filtersToParams(filters);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [filters]);

  const facets = useMemo(() => buildFacets(recipes), [recipes]);

  // Precompute each recipe's searchable words once.
  const wordIndex = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of recipes) m.set(r.slug, recipeWords(r));
    return m;
  }, [recipes]);

  // Pinned keyword chips plus whatever is being typed right now, so results
  // filter live and each keyword narrows (AND) the set.
  const activeKeywords = useMemo(() => {
    const list = [...filters.keywords];
    const d = draft.trim().toLowerCase();
    if (d && !list.includes(d)) list.push(d);
    return list;
  }, [filters.keywords, draft]);

  // Recipes matching keywords + every facet EXCEPT meal — used for tab counts.
  const preMeal = useMemo(() => {
    let list = recipes;
    if (activeKeywords.length) {
      list = recipes.filter((r) => {
        const words = wordIndex.get(r.slug) ?? [];
        return activeKeywords.every((kw) => keywordMatches(words, kw));
      });
    }
    const noMeal = { ...filters, meal: [] };
    return list.filter((r) => matchesFacets(r, noMeal));
  }, [filters, activeKeywords, wordIndex, recipes]);

  const tabCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of MEAL_TABS) {
      out[t.key] = t.tags.length ? preMeal.filter((r) => r.mealTags.some((m) => t.tags.includes(m))).length : preMeal.length;
    }
    return out;
  }, [preMeal]);

  const results = useMemo(() => {
    const filtered = filters.meal.length ? preMeal.filter((r) => filters.meal.some((m) => r.mealTags.includes(m))) : preMeal;
    return sortRecipes(filtered, filters.sort);
  }, [preMeal, filters.meal, filters.sort]);

  const activeTab = activeMealTab(filters.meal) ?? (filters.meal.length ? 'custom' : 'all');
  const panelCount = countActive({ ...filters, meal: [] });

  // --- Mutators ---
  const toggleValue = (field: MultiField, value: string) => {
    setFilters((f) => {
      const set = new Set(f[field]);
      set.has(value) ? set.delete(value) : set.add(value);
      return { ...f, [field]: [...set] };
    });
  };
  const setTime = (value: string) => setFilters((f) => ({ ...f, time: f.time === value ? '' : value }));
  const pickTab = (key: string) => {
    const tab = MEAL_TABS.find((t) => t.key === key);
    setFilters((f) => ({ ...f, meal: tab ? [...tab.tags] : [] }));
  };
  const clearAll = () => {
    setDraft('');
    setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }));
  };

  // --- Keyword tokens ---
  const commitKeyword = () => {
    const kw = draft.trim().toLowerCase();
    setDraft('');
    if (!kw) return;
    setFilters((f) => (f.keywords.includes(kw) ? f : { ...f, keywords: [...f.keywords, kw] }));
  };
  const removeKeyword = (kw: string) => setFilters((f) => ({ ...f, keywords: f.keywords.filter((k) => k !== kw) }));
  const onKeywordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitKeyword();
    } else if (e.key === 'Backspace' && draft === '' && filters.keywords.length) {
      setFilters((f) => ({ ...f, keywords: f.keywords.slice(0, -1) }));
    }
  };

  // --- Removable active-chip list (panel facets + time; keywords live in the search box) ---
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  for (const field of PANEL_FIELDS) {
    for (const value of filters[field]) {
      chips.push({ key: `${field}:${value}`, label: `${FIELD_LABEL[field]}: ${optionLabel(field, value)}`, onRemove: () => toggleValue(field, value) });
    }
  }
  if (activeTab === 'custom') {
    for (const value of filters.meal) chips.push({ key: `meal:${value}`, label: `Meal: ${labelize(value)}`, onRemove: () => toggleValue('meal', value) });
  }
  if (filters.time) {
    const t = TIME_RANGES.find((x) => x.value === filters.time);
    chips.push({ key: 'time', label: t ? t.label : filters.time, onRemove: () => setFilters((f) => ({ ...f, time: '' })) });
  }

  // Link each card back with the current filter state preserved.
  const cardHref = (slug: string) => {
    const qs = filtersToParams(filters).toString();
    const target = `${base}/${slug}/`;
    return qs ? `${target}?from=${encodeURIComponent(qs)}` : target;
  };

  const anyActive = chips.length > 0 || filters.keywords.length > 0 || activeTab !== 'all';

  return (
    <div className="library">
      {/* ---------------- Search ---------------- */}
      <div className="library__search">
        <div className="tokenbox" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
          <svg className="tokenbox__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <div className="tokenbox__tokens">
            {filters.keywords.map((kw) => (
              <span className="ktoken" key={kw}>
                {kw}
                <button type="button" className="ktoken__x" onClick={(e) => { e.stopPropagation(); removeKeyword(kw); }} aria-label={`Remove keyword ${kw}`}>×</button>
              </span>
            ))}
            <input
              type="text"
              className="tokenbox__input"
              placeholder={filters.keywords.length ? 'Add another keyword…' : 'Search chicken, pasta, R0012… then Enter'}
              aria-label="Add a search keyword, then press Enter"
              value={draft}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeywordKeyDown}
              onBlur={commitKeyword}
            />
          </div>
          {(filters.keywords.length > 0 || draft) && (
            <button className="tokenbox__clear" onClick={(e) => { e.stopPropagation(); setDraft(''); setFilters((f) => ({ ...f, keywords: [] })); }} aria-label="Clear all keywords">×</button>
          )}
        </div>
      </div>

      {/* ---------------- Meal tabs ---------------- */}
      <div className="segmented library__tabs" role="tablist" aria-label="Meal">
        {MEAL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`segmented__btn${activeTab === t.key ? ' segmented__btn--on' : ''}`}
            onClick={() => pickTab(t.key)}
          >
            <span className="library__tab-long">{t.label}</span>
            <span className="library__tab-short">{t.short}</span>
            <span className="segmented__count">{tabCounts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* ---------------- Controls row ---------------- */}
      <div className="library__controls">
        <button className={`btn btn--outline btn--sm filters-toggle${panelOpen ? ' filters-toggle--open' : ''}`} aria-expanded={panelOpen} aria-controls="filter-panel" onClick={() => setPanelOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M7 12h10M10 18h4"/></svg>
          Filters
          {panelCount > 0 && <span className="filters-toggle__badge">{panelCount}</span>}
        </button>

        <label className="sort">
          <span className="visually-hidden">Sort</span>
          <select className="sort__select" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>

        <p className="count" aria-live="polite">
          <strong>{results.length}</strong> {results.length === 1 ? 'recipe' : 'recipes'}
        </p>
      </div>

      {/* ---------------- Filter panel ---------------- */}
      <div id="filter-panel" className="panel" hidden={!panelOpen}>
        <div className="panel__grid">
          <fieldset className="group">
            <legend className="group__title">Total time</legend>
            <div className="chips-choice">
              {TIME_RANGES.map((t) => (
                <button key={t.value} type="button" className={`choice${filters.time === t.value ? ' choice--on' : ''}`} aria-pressed={filters.time === t.value} onClick={() => setTime(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          {PANEL_FIELDS.map((field) =>
            facets[field].length ? (
              <fieldset className={`group${field === 'tags' ? ' group--wide' : ''}`} key={field}>
                <legend className="group__title">{FIELD_LABEL[field]}</legend>
                <div className="chips-choice">
                  {facets[field].map((value) => {
                    const on = filters[field].includes(value);
                    return (
                      <button key={value} type="button" className={`choice${on ? ' choice--on' : ''}`} aria-pressed={on} onClick={() => toggleValue(field, value)}>
                        {optionLabel(field, value)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null
          )}
        </div>
        <div className="panel__foot">
          <button className="btn btn--dark btn--sm" onClick={() => setPanelOpen(false)}>Show {results.length} {results.length === 1 ? 'recipe' : 'recipes'}</button>
          {panelCount > 0 && <button className="btn-link" onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, keywords: f.keywords, meal: f.meal, sort: f.sort }))}>Reset filters</button>}
        </div>
      </div>

      {/* ---------------- Active chips ---------------- */}
      {chips.length > 0 && (
        <div className="active-chips">
          {chips.map((c) => (
            <button key={c.key} className="active-chip" onClick={c.onRemove}>
              <span>{c.label}</span>
              <span className="active-chip__x" aria-hidden="true">×</span>
              <span className="visually-hidden">— remove filter</span>
            </button>
          ))}
          <button className="btn-link clear-all" onClick={clearAll}>Clear all</button>
        </div>
      )}

      {/* ---------------- Results grid / empty state ---------------- */}
      {results.length > 0 ? (
        <div className="grid" ref={gridRef}>
          {results.map((r) => <RecipeCard key={r.slug} recipe={r} href={cardHref(r.slug)} />)}
        </div>
      ) : (
        <div className="empty">
          <div className="empty__mark" aria-hidden="true">🍽️</div>
          <h2 className="empty__title">Nothing matches yet</h2>
          <p className="empty__body">Try a different meal, loosen a filter, or check the keyword spelling.</p>
          {anyActive && <button className="btn btn--primary" onClick={clearAll}>Clear everything</button>}
        </div>
      )}
    </div>
  );
}
