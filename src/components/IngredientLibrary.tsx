import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import ScoreBadge from './ScoreBadge';
import { band, BAND_LABEL, type Band } from '../lib/scoring';

export interface IngredientRow {
  id: string;
  name: string;
  score: number;
  cls: string;
  group: string;
  note: string;
  products: number;
  aliases: string[];
}

interface Props {
  items: IngredientRow[];
  base: string;
}

const BANDS: Band[] = ['zero', 'high', 'moderate', 'limited', 'clear'];
const SORTS = [
  { value: 'score', label: 'Lowest score first' },
  { value: 'common', label: 'Most common on labels' },
  { value: 'alpha', label: 'A to Z' },
];

export default function IngredientLibrary({ items, base }: Props) {
  const [q, setQ] = useState('');
  const [bands, setBands] = useState<Band[]>([]);
  const [cls, setCls] = useState('');
  const [sort, setSort] = useState('score');
  const ready = useRef(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQ(p.get('q') ?? '');
    setBands((p.get('band') ?? '').split(',').filter((b): b is Band => BANDS.includes(b as Band)));
    setCls(p.get('class') ?? '');
    setSort(p.get('sort') ?? 'score');
    ready.current = true;
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (bands.length) p.set('band', bands.join(','));
    if (cls) p.set('class', cls);
    if (sort !== 'score') p.set('sort', sort);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [q, bands, cls, sort]);

  const classes = useMemo(() => [...new Set(items.map((i) => i.cls))].sort(), [items]);
  const fuse = useMemo(
    () =>
      new Fuse(items, {
        threshold: 0.34,
        ignoreLocation: true,
        keys: [
          { name: 'name', weight: 3 },
          { name: 'aliases', weight: 1.2 },
          { name: 'group', weight: 1 },
          { name: 'cls', weight: 0.6 },
        ],
      }),
    [items]
  );
  const bandCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[band(i.score)] = (c[band(i.score)] ?? 0) + 1;
    return c;
  }, [items]);

  const results = useMemo(() => {
    const query = q.trim();
    let list = query ? fuse.search(query).map((r) => r.item) : items.slice();
    if (bands.length) list = list.filter((i) => bands.includes(band(i.score)));
    if (cls) list = list.filter((i) => i.cls === cls);
    if (!query || sort !== 'score') {
      if (sort === 'score') list.sort((a, b) => a.score - b.score || b.products - a.products);
      if (sort === 'common') list.sort((a, b) => b.products - a.products);
      if (sort === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [q, bands, cls, sort, fuse, items]);

  const toggleBand = (b: Band) => setBands((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  const anyFilter = q.trim() || bands.length || cls;

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar__row">
          <div className="search">
            <svg className="search__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              className="search__input"
              placeholder="Search an ingredient, E-number, or label spelling…"
              aria-label="Search ingredients"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button className="search__clear" onClick={() => setQ('')} aria-label="Clear search">×</button>
            )}
          </div>
          <label className="visually-hidden" htmlFor="ing-class">Ingredient type</label>
          <select id="ing-class" className="select" value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">All types</option>
            {classes.map((c) => (
              <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor="ing-sort">Sort</label>
          <select id="ing-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="bands" role="group" aria-label="Filter by score band">
          {BANDS.map((b) => {
            const on = bands.includes(b);
            return (
              <button key={b} type="button" className={`band-choice${on ? ' band-choice--on' : ''}`} aria-pressed={on} onClick={() => toggleBand(b)}>
                <span className={`band-dot band-dot--${b}`} aria-hidden="true" />
                {BAND_LABEL[b]} <span style={{ opacity: 0.6 }}>{bandCounts[b] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="results-meta" aria-live="polite">
        <strong>{results.length}</strong> {results.length === 1 ? 'ingredient' : 'ingredients'}
        {anyFilter ? (
          <>
            {' '}of {items.length} ·{' '}
            <button className="link-btn" onClick={() => { setQ(''); setBands([]); setCls(''); }}>Clear filters</button>
          </>
        ) : null}
      </p>

      {results.length ? (
        <ul className="ing-list">
          {results.map((i) => (
            <li key={i.id}>
              <a className="ing-item" href={`${base}/ingredients/${i.id}/`}>
                <ScoreBadge score={i.score} />
                <div>
                  <div className="ing-item__name">{i.name}</div>
                  <div className="ing-item__class">{i.cls}{i.group !== i.name && i.group !== 'Other recognized additives' ? ` · ${i.group}` : ''}</div>
                  <p className="ing-item__note">{i.note}</p>
                </div>
                <div className="ing-item__count">
                  <strong>{i.products.toLocaleString()}</strong>products
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <h2 className="empty__title">No ingredient matches</h2>
          <p className="empty__body">Try a different spelling, or paste the whole label into the label checker.</p>
          <a className="btn-primary" href={`${base}/check/`}>Check a label</a>
        </div>
      )}
    </div>
  );
}
