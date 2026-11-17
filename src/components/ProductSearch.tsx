import { useEffect, useMemo, useRef, useState } from 'react';
import ScoreBadge from './ScoreBadge';
import liteData from '../data/ingredients-lite.json';
import type { LiteIngredient } from '../lib/scoring';

const LITE = liteData as LiteIngredient[];

/** [display name, key, products, shard, average score] */
type BrandRow = [string, string, number, number, number];
/** [brandIdx, upc, name, category, labelDate, score, ingredientIdx[], ingredients, sourceUrl] */
type ProductRow = [number, string, string, string, string, number, number[], string, string];
interface Shard {
  b: string[];
  p: ProductRow[];
}

interface Props {
  base: string;
}

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const PAGE = 60;
const SUGGEST = ['DORITOS', 'SKITTLES', 'REESES', 'COREPOWER', 'DAVID', 'COCACOLA', 'GATORADE', 'TAKIS', 'OREO', 'CELSIUS', 'TRIDENT', 'CHEEZIT'];

export default function ProductSearch({ base }: Props) {
  const [brands, setBrands] = useState<BrandRow[] | null>(null);
  const [q, setQ] = useState('');
  const [brandKey, setBrandKey] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'score' | 'name' | 'date'>('score');
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [shard, setShard] = useState<Shard | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const cache = useRef(new Map<number, Promise<Shard>>());
  const ready = useRef(false);

  const loadShard = (i: number) => {
    let p = cache.current.get(i);
    if (!p) {
      p = fetch(`${base}/data/p/${i}.json`).then((r) => {
        if (!r.ok) throw new Error(`shard ${i}: ${r.status}`);
        return r.json();
      });
      cache.current.set(i, p);
    }
    return p;
  };

  // --- load the brand index and read URL state ---
  useEffect(() => {
    fetch(`${base}/data/brands.json`)
      .then((r) => r.json())
      .then((b: BrandRow[]) => setBrands(b))
      .catch(() => setNotice('Could not load the product index. Check your connection and reload.'));
    const p = new URLSearchParams(window.location.search);
    setQ(p.get('q') ?? '');
    setBrandKey(p.get('brand') ?? '');
    setFilter(p.get('f') ?? '');
    setOpen(p.get('open'));
    if (p.get('upc')) lookupUpc(p.get('upc')!);
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    const p = new URLSearchParams();
    if (q.trim() && !brandKey) p.set('q', q.trim());
    if (brandKey) p.set('brand', brandKey);
    if (brandKey && filter.trim()) p.set('f', filter.trim());
    if (open) p.set('open', open);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [q, brandKey, filter, open]);

  const brandByKey = useMemo(() => new Map((brands ?? []).map((b) => [b[1], b])), [brands]);
  const brand = brandByKey.get(brandKey);

  // --- load the selected brand's products ---
  useEffect(() => {
    if (!brand) {
      setShard(null);
      return;
    }
    setLoading(true);
    loadShard(brand[3])
      .then((s) => setShard(s))
      .catch(() => setNotice('Could not load this brand. Try again.'))
      .finally(() => setLoading(false));
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand]);

  async function lookupUpc(raw: string) {
    const upc = raw.replace(/\D/g, '').replace(/^0+/, '');
    if (upc.length < 6) return;
    setNotice('');
    setLoading(true);
    try {
      const r = await fetch(`${base}/data/upc/${upc.slice(-3).padStart(3, '0')}.json`);
      const m: Record<string, number> = r.ok ? await r.json() : {};
      const si = m[upc];
      if (si == null) {
        setNotice(`No product with barcode ${raw.trim()} in the database. Paste its ingredients into the label checker instead.`);
        return;
      }
      const s = await loadShard(si);
      const row = s.p.find((x) => x[1] === upc);
      if (row) {
        setQ('');
        setFilter('');
        setBrandKey(s.b[row[0]]);
        setOpen(upc);
      }
    } finally {
      setLoading(false);
    }
  }

  // --- brand matching for the search box ---
  const match = useMemo(() => {
    const query = q.trim();
    if (!brands || !query || /^\d{6,14}$/.test(query.replace(/\s/g, ''))) return null;
    const words = query.split(/\s+/);
    for (let k = words.length; k >= 1; k--) {
      const head = compact(words.slice(0, k).join(''));
      if (head.length < 2) continue;
      const exact = brands.filter((b) => b[1] === head);
      const starts = brands.filter((b) => b[1] !== head && b[1].startsWith(head));
      const found = [...exact, ...starts.sort((a, b) => b[2] - a[2])];
      if (found.length) return { brands: found.slice(0, 18), total: found.length, rest: words.slice(k).join(' ') };
    }
    const c = compact(query);
    const inner = c.length >= 3 ? brands.filter((b) => b[1].includes(c)).sort((a, b) => b[2] - a[2]) : [];
    return { brands: inner.slice(0, 18), total: inner.length, rest: '' };
  }, [q, brands]);

  const pick = (key: string, rest = '') => {
    setBrandKey(key);
    setFilter(rest);
    setOpen(null);
  };

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const digits = q.replace(/\s/g, '');
    if (/^\d{6,14}$/.test(digits)) return void lookupUpc(digits);
    if (match && match.brands.length) pick(match.brands[0][1], match.rest);
  };

  // --- products for the selected brand ---
  const products = useMemo(() => {
    if (!shard || !brand) return [];
    const bi = shard.b.indexOf(brand[1]);
    let list = shard.p.filter((p) => p[0] === bi);
    const words = filter.toUpperCase().split(/\s+/).filter(Boolean);
    if (words.length) list = list.filter((p) => words.every((w) => (p[2] + ' ' + p[3]).toUpperCase().includes(w)));
    list = list.slice();
    if (sort === 'score') list.sort((a, b) => a[5] - b[5] || a[2].localeCompare(b[2]));
    if (sort === 'name') list.sort((a, b) => a[2].localeCompare(b[2]));
    if (sort === 'date') list.sort((a, b) => b[4].localeCompare(a[4]));
    if (open) {
      const i = list.findIndex((p) => p[1] === open || `${p[2]}|${p[4]}` === open);
      if (i >= limit) list.unshift(...list.splice(i, 1));
    }
    return list;
  }, [shard, brand, filter, sort, open, limit]);

  const suggestions = useMemo(() => SUGGEST.map((k) => brandByKey.get(k)).filter(Boolean) as BrandRow[], [brandByKey]);

  return (
    <div>
      <form className="toolbar" onSubmit={submit} role="search">
        <div className="toolbar__row">
          <div className="search">
            <svg className="search__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              className="search__input"
              placeholder="Brand, brand + product, or barcode…"
              aria-label="Search products by brand, product or barcode"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setNotice('');
                if (brandKey) setBrandKey('');
                setOpen(null);
              }}
            />
            {q && (
              <button type="button" className="search__clear" onClick={() => setQ('')} aria-label="Clear search">×</button>
            )}
          </div>
          <button type="submit" className="btn-primary">Search</button>
        </div>
      </form>

      {notice && <p className="stale" role="status">{notice}</p>}
      {!brands && !notice && <p className="loading">Loading the product index…</p>}

      {/* ---------- start state ---------- */}
      {brands && !q.trim() && !brand && (
        <div style={{ marginTop: '1.25rem' }}>
          <div className="suggest">
            <span className="suggest__label">Try</span>
            {suggestions.map((b) => (
              <button key={b[1]} type="button" className="choice" onClick={() => pick(b[1])}>{b[0]}</button>
            ))}
          </div>
          <p className="disclaimer">
            Type a brand to start ("doritos", "core power"). Add words after it to narrow to a product ("takis fuego"). A barcode
            (the digits under the bars) jumps straight to the product.
          </p>
        </div>
      )}

      {/* ---------- brand matches ---------- */}
      {brands && q.trim() && !brand && match && (
        match.brands.length ? (
          <>
            <p className="results-meta">
              <strong>{match.total.toLocaleString()}</strong> matching {match.total === 1 ? 'brand' : 'brands'}
              {match.rest && <> · products matching “{match.rest}”</>}
            </p>
            <ul className="brand-list">
              {match.brands.map((b) => (
                <li key={b[1]}>
                  <button type="button" className="brand-btn" onClick={() => pick(b[1], match.rest)}>
                    <ScoreBadge score={b[4]} size="xs" />
                    <span>
                      <span className="brand-btn__name">{b[0]}</span>
                      <span className="brand-btn__count">{b[2].toLocaleString()} {b[2] === 1 ? 'product' : 'products'} · average {b[4]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty">
            <h2 className="empty__title">No brand by that name</h2>
            <p className="empty__body">Search by the brand printed on the package, try fewer words, or paste the label into the checker.</p>
            <a className="btn-primary" href={`${base}/check/`}>Check a label</a>
          </div>
        )
      )}

      {/* ---------- one brand ---------- */}
      {brand && (
        <section>
          <div className="brand-head">
            <h2>{brand[0]}</h2>
            <span className="results-meta" style={{ margin: 0 }}>
              {brand[2].toLocaleString()} products · average score {brand[4]}
            </span>
            <button type="button" className="link-btn" onClick={() => { setBrandKey(''); setOpen(null); }}>All brands</button>
          </div>
          <div className="toolbar__row" style={{ marginTop: '0.75rem' }}>
            <div className="search" style={{ flex: '1 1 260px' }}>
              <input
                type="search"
                className="search__input"
                style={{ paddingLeft: '0.9rem' }}
                placeholder={`Filter ${brand[0]} products…`}
                aria-label="Filter this brand's products"
                value={filter}
                onChange={(e) => { setFilter(e.target.value); setLimit(PAGE); }}
              />
            </div>
            <label className="visually-hidden" htmlFor="prod-sort">Sort</label>
            <select id="prod-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="score">Lowest score first</option>
              <option value="name">A to Z</option>
              <option value="date">Newest label first</option>
            </select>
          </div>

          {loading && !shard && <p className="loading">Loading products…</p>}
          {shard && (
            <>
              <p className="results-meta"><strong>{products.length.toLocaleString()}</strong> {products.length === 1 ? 'product' : 'products'}</p>
              <ul className="prod-list">
                {products.slice(0, limit).map((p) => (
                  <ProductItem
                    key={`${p[1]}|${p[2]}|${p[4]}`}
                    p={p}
                    base={base}
                    isOpen={open === (p[1] || `${p[2]}|${p[4]}`)}
                    onToggle={() => setOpen((o) => (o === (p[1] || `${p[2]}|${p[4]}`) ? null : p[1] || `${p[2]}|${p[4]}`))}
                  />
                ))}
              </ul>
              {products.length > limit && (
                <button type="button" className="more-btn" onClick={() => setLimit((l) => l + PAGE * 2)}>
                  Show more ({(products.length - limit).toLocaleString()} left)
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function ProductItem({ p, base, isOpen, onToggle }: { p: ProductRow; base: string; isOpen: boolean; onToggle: () => void }) {
  const [, upc, name, cat, date, score, ing, text, src] = p;
  const flagged = ing.map((i) => LITE[i]).filter(Boolean).sort((a, b) => a[2] - b[2]);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (isOpen && ref.current && new URLSearchParams(window.location.search).get('open')) {
      ref.current.scrollIntoView({ block: 'center' });
    }
  }, [isOpen]);
  const year = Number(date.slice(0, 4));
  const id = `prod-${upc || name.replace(/\W+/g, '-')}`;
  return (
    <li ref={ref} className={`prod${isOpen ? ' prod--open' : ''}`}>
      <button type="button" className="prod__row" aria-expanded={isOpen} aria-controls={id} onClick={onToggle}>
        <ScoreBadge score={score} />
        <span>
          <span className="prod__name">{name}</span>
          <span className="prod__worst">
            {flagged.length ? flagged.slice(0, 3).map((f) => f[1]).join(' · ') + (flagged.length > 3 ? ` · +${flagged.length - 3} more` : '') : 'No flagged ingredients'}
          </span>
        </span>
        <span className="prod__date">{src ? 'Label 2026' : `Label ${year}`}</span>
      </button>
      {isOpen && (
        <div className="prod__body" id={id}>
          {flagged.length > 0 && (
            <>
              <p className="prod__section-title">Flagged ingredients</p>
              <ul className="flag-list">
                {flagged.map((f) => (
                  <li key={f[0]}>
                    <a href={`${base}/ingredients/${f[0]}/`}>
                      <ScoreBadge score={f[2]} size="xs" />
                      <span className="flag-list__name">{f[1]}</span>
                      <span className="flag-list__cls">{f[3]}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="prod__section-title">Full ingredient list</p>
          <p className="prod__ingredients">{text}</p>
          <div className="prod__meta">
            {upc && <span><b>Barcode</b> {upc}</span>}
            {cat && <span><b>Category</b> {cat}</span>}
            <span><b>Label</b> {date}</span>
            <span>
              <b>Source</b>{' '}
              {src ? <a href={src} rel="noopener noreferrer">brand or retailer page, checked Nov 2026</a> : 'USDA FoodData Central'}
            </span>
          </div>
          {!src && year && year < 2024 && (
            <p className="stale">This label is from {year}. The recipe may have changed since, so check the package before relying on it.</p>
          )}
        </div>
      )}
    </li>
  );
}
