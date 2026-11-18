import { useEffect, useMemo, useRef, useState } from 'react';

export interface IngredientRow {
  id: string;
  name: string;
  score: number | null;
  carc: string;
  cls: string;
  why: string;
  products: number;
  search: string;
}

const BANDS = [
  ['all', 'All'],
  ['c', 'Cancer link'],
  ['3', 'High'],
  ['2', 'Moderate'],
  ['1', 'Limited'],
  ['0', 'Low'],
] as const;
const riskOf = (r: IngredientRow) => (r.score == null ? 'n' : r.carc || r.score === 0 ? 'c' : r.score < 25 ? '3' : r.score < 50 ? '2' : r.score < 75 ? '1' : '0');

export default function IngredientList({ items, base }: { items: IngredientRow[]; base: string }) {
  const [q, setQ] = useState('');
  const [band, setBand] = useState('all');
  const [sort, setSort] = useState<'score' | 'common' | 'alpha'>('score');
  const ready = useRef(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQ(p.get('q') ?? '');
    setBand(p.get('band') ?? 'all');
    const s = p.get('sort');
    if (s === 'common' || s === 'alpha') setSort(s);
    ready.current = true;
  }, []);
  useEffect(() => {
    if (!ready.current) return;
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (band !== 'all') p.set('band', band);
    if (sort !== 'score') p.set('sort', sort);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [q, band, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[riskOf(i)] = (c[riskOf(i)] ?? 0) + 1;
    return c;
  }, [items]);

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = items.filter((i) => (band === 'all' || riskOf(i) === band) && words.every((w) => i.search.includes(w)));
    list = list.slice();
    if (sort === 'score') list.sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || b.products - a.products);
    if (sort === 'common') list.sort((a, b) => b.products - a.products);
    if (sort === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
    // exact name hits first when searching
    if (words.length) {
      const ql = q.trim().toLowerCase();
      list.sort((a, b) => Number(b.name.toLowerCase().startsWith(ql)) - Number(a.name.toLowerCase().startsWith(ql)));
    }
    return list;
  }, [items, q, band, sort]);

  return (
    <div>
      <div className="db-search">
        <label className="visually-hidden" htmlFor="ing-q">Search ingredients</label>
        <input id="ing-q" type="search" className="input" placeholder="Search an ingredient, E-number or label spelling" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented" role="group" aria-label="Sort">
          {([['score', 'Worst first'], ['common', 'Most common'], ['alpha', 'A to Z']] as const).map(([v, l]) => (
            <button key={v} type="button" className={`segmented__btn${sort === v ? ' segmented__btn--on' : ''}`} aria-pressed={sort === v} onClick={() => setSort(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Filter by score band" style={{ marginTop: '0.6rem' }}>
        {BANDS.map(([v, l]) => (
          <button key={v} type="button" className={`segmented__btn${band === v ? ' segmented__btn--on' : ''}`} aria-pressed={band === v} onClick={() => setBand(v)}>
            {v !== 'all' && <i className={`ingr__dot risk--${v}`} style={{ display: 'inline-block', width: 9, height: 9, margin: '0 0.35rem 0 0' }} aria-hidden="true" />}
            {l}<span className="segmented__count">{counts[v] ?? 0}</span>
          </button>
        ))}
      </div>

      <p className="db-meta"><strong>{results.length}</strong> {results.length === 1 ? 'ingredient' : 'ingredients'}</p>
      {results.length ? (
        <ul className="db-list">
          {results.map((i) => {
            const r = riskOf(i);
            return (
              <li key={i.id}>
                <a className="db-item" href={`${base}/ingredients/${i.id}/`}>
                  <span className={`sc sc--${r === 'n' ? 'none' : r}`}>{i.score ?? '–'}</span>
                  <span>
                    <span className="db-item__name">{i.name}</span>
                    <span className="db-item__sub">{i.cls}</span>
                    <span className="db-item__why" style={{ display: 'block' }}>{i.why}</span>
                  </span>
                  <span className="db-item__count"><strong>{i.products.toLocaleString()}</strong>products</span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="notice notice--info">No ingredient matches. Try another spelling, or paste the whole label on the Scan page.</p>
      )}
    </div>
  );
}
