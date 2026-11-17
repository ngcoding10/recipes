import { useEffect, useMemo, useRef, useState } from 'react';

/** [display name, key, products, shard, average score] */
type BrandRow = [string, string, number, number, number];
/** [brandIdx, upc, name, category, labelDate, score, flagIdx[], ingredients, sourceUrl] */
type ProductRow = [number, string, string, string, string, number, number[], string, string];
/** [name, score, 'C' | 'L' | '', category, why, ingredient page id] */
type Flag = [string, number, string, string, string, string];
interface Shard { b: string[]; p: ProductRow[] }

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const PAGE = 50;
const SUGGEST = ['DORITOS', 'SKITTLES', 'REESES', 'COREPOWER', 'DAVID', 'COCACOLA', 'GATORADE', 'TAKIS', 'OREO', 'CELSIUS', 'CHOMPS', 'CHEEZIT'];
const grade = (s: number) => (s < 0 ? 'none' : s >= 75 ? 'excellent' : s >= 50 ? 'good' : s >= 25 ? 'poor' : 'bad');
const shown = (s: number) => (s < 0 ? '–' : String(s));
const GRADE_LABEL: Record<string, string> = { excellent: 'Excellent', good: 'Good', poor: 'Poor', bad: 'Bad', none: 'Not scored' };
const risk = (f: Flag) => (f[2] || f[1] === 0 ? 'c' : f[1] < 25 ? '3' : f[1] < 50 ? '2' : f[1] < 75 ? '1' : '0');

export default function Products({ base }: { base: string }) {
  const [brands, setBrands] = useState<BrandRow[] | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
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
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
      cache.current.set(i, p);
    }
    return p;
  };

  useEffect(() => {
    Promise.all([fetch(`${base}/data/brands.json`).then((r) => r.json()), fetch(`${base}/data/flags.json`).then((r) => r.json())])
      .then(([b, f]) => { setBrands(b); setFlags(f); })
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

  useEffect(() => {
    if (!brand) { setShard(null); return; }
    setLoading(true);
    loadShard(brand[3]).then(setShard).catch(() => setNotice('Could not load this brand. Try again.')).finally(() => setLoading(false));
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
      if (si == null) { setNotice(`No product with barcode ${raw.trim()} in the database. You can still scan or paste its label on the Scan page.`); return; }
      const s = await loadShard(si);
      const row = s.p.find((x) => x[1] === upc);
      if (row) { setQ(''); setFilter(''); setBrandKey(s.b[row[0]]); setOpen(upc); }
    } finally {
      setLoading(false);
    }
  }

  const match = useMemo(() => {
    const query = q.trim();
    if (!brands || !query || /^\d{6,14}$/.test(query.replace(/\s/g, ''))) return null;
    const words = query.split(/\s+/);
    for (let k = words.length; k >= 1; k--) {
      const head = compact(words.slice(0, k).join(''));
      if (head.length < 2) continue;
      const exact = brands.filter((b) => b[1] === head);
      const starts = brands.filter((b) => b[1] !== head && b[1].startsWith(head)).sort((a, b) => b[2] - a[2]);
      const found = [...exact, ...starts];
      if (found.length) return { brands: found.slice(0, 18), total: found.length, rest: words.slice(k).join(' ') };
    }
    const c = compact(query);
    const inner = c.length >= 3 ? brands.filter((b) => b[1].includes(c)).sort((a, b) => b[2] - a[2]) : [];
    return { brands: inner.slice(0, 18), total: inner.length, rest: '' };
  }, [q, brands]);

  const pick = (key: string, rest = '') => { setBrandKey(key); setFilter(rest); setOpen(null); };
  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const digits = q.replace(/\s/g, '');
    if (/^\d{6,14}$/.test(digits)) return void lookupUpc(digits);
    if (match && match.brands.length) pick(match.brands[0][1], match.rest);
  };

  const products = useMemo(() => {
    if (!shard || !brand) return [];
    const bi = shard.b.indexOf(brand[1]);
    let list = shard.p.filter((p) => p[0] === bi);
    const words = filter.toUpperCase().split(/\s+/).filter(Boolean);
    if (words.length) list = list.filter((p) => words.every((w) => (p[2] + ' ' + p[3]).toUpperCase().includes(w)));
    list = list.slice();
    if (sort === 'score') list.sort((a, b) => (a[5] < 0 ? 101 : a[5]) - (b[5] < 0 ? 101 : b[5]) || a[2].localeCompare(b[2]));
    if (sort === 'name') list.sort((a, b) => a[2].localeCompare(b[2]));
    if (sort === 'date') list.sort((a, b) => b[4].localeCompare(a[4]));
    if (open) {
      const i = list.findIndex((p) => (p[1] || `${p[2]}|${p[4]}`) === open);
      if (i >= limit) list.unshift(...list.splice(i, 1));
    }
    return list;
  }, [shard, brand, filter, sort, open, limit]);

  const suggestions = useMemo(() => SUGGEST.map((k) => brandByKey.get(k)).filter(Boolean) as BrandRow[], [brandByKey]);

  return (
    <div>
      <form className="db-search" onSubmit={submit} role="search">
        <label className="visually-hidden" htmlFor="prod-q">Search products by brand, product or barcode</label>
        <input
          id="prod-q"
          type="search"
          className="input"
          placeholder="Brand, brand + product, or barcode"
          value={q}
          onChange={(e) => { setQ(e.target.value); setNotice(''); if (brandKey) setBrandKey(''); setOpen(null); }}
        />
        <button type="submit" className="btn btn--primary">Search</button>
      </form>

      {notice && <p className="notice notice--amber" style={{ marginTop: '0.85rem' }} role="status">{notice}</p>}
      {!brands && !notice && <p className="tools__hint"><span className="spinner spinner--dark" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '0.4rem' }} />Loading the product index…</p>}

      {brands && !q.trim() && !brand && (
        <div style={{ marginTop: '1rem' }}>
          <div className="chips">
            {suggestions.map((b) => (
              <button key={b[1]} type="button" className="pill pill--green" style={{ border: 0, cursor: 'pointer' }} onClick={() => pick(b[1])}>{b[0]}</button>
            ))}
          </div>
          <p className="tools__hint">Type a brand ("doritos", "core power"), add words to narrow to one product ("takis fuego"), or enter the barcode digits.</p>
        </div>
      )}

      {brands && q.trim() && !brand && match && (match.brands.length ? (
        <>
          <p className="db-meta"><strong>{match.total.toLocaleString()}</strong> matching {match.total === 1 ? 'brand' : 'brands'}{match.rest && <> · products matching “{match.rest}”</>}</p>
          <ul className="brand-grid">
            {match.brands.map((b) => (
              <li key={b[1]}>
                <button type="button" className="brand-btn" onClick={() => pick(b[1], match.rest)}>
                  <span className={`sc sc--xs sc--${grade(b[4])}`}>{shown(b[4])}</span>
                  <span>
                    <span className="brand-btn__name">{b[0]}</span>
                    <span className="brand-btn__count">{b[2].toLocaleString()} {b[2] === 1 ? 'product' : 'products'}{b[4] >= 0 ? ` · average ${b[4]}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="notice notice--info" style={{ marginTop: '1rem' }}>No brand by that name. Try the brand printed on the package, fewer words, or scan the label instead.</p>
      ))}

      {brand && (
        <section>
          <div className="brand-head">
            <h2>{brand[0]}</h2>
            <span className="db-meta" style={{ margin: 0 }}>{brand[2].toLocaleString()} {brand[2] === 1 ? 'product' : 'products'}{brand[4] >= 0 ? ` · average ${brand[4]}` : ''}</span>
            <button type="button" className="btn-link" onClick={() => { setBrandKey(''); setOpen(null); }}>All brands</button>
          </div>
          <div className="db-search" style={{ marginTop: '0.75rem' }}>
            <label className="visually-hidden" htmlFor="prod-f">Filter this brand's products</label>
            <input id="prod-f" type="search" className="input" placeholder={`Filter ${brand[0]} products`} value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(PAGE); }} />
            <div className="segmented" role="group" aria-label="Sort">
              {([['score', 'Worst first'], ['name', 'A to Z'], ['date', 'Newest']] as const).map(([v, l]) => (
                <button key={v} type="button" className={`segmented__btn${sort === v ? ' segmented__btn--on' : ''}`} aria-pressed={sort === v} onClick={() => setSort(v)}>{l}</button>
              ))}
            </div>
          </div>

          {loading && !shard && <p className="tools__hint">Loading products…</p>}
          {shard && (
            <>
              <p className="db-meta"><strong>{products.length.toLocaleString()}</strong> {products.length === 1 ? 'product' : 'products'}</p>
              <ul className="db-list">
                {products.slice(0, limit).map((p) => {
                  const key = p[1] || `${p[2]}|${p[4]}`;
                  return <ProductItem key={key + p[4]} p={p} flags={flags} base={base} isOpen={open === key} onToggle={() => setOpen((o) => (o === key ? null : key))} />;
                })}
              </ul>
              {products.length > limit && (
                <button type="button" className="btn btn--outline more" onClick={() => setLimit((l) => l + PAGE * 2)}>Show more ({(products.length - limit).toLocaleString()} left)</button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function ProductItem({ p, flags, base, isOpen, onToggle }: { p: ProductRow; flags: Flag[]; base: string; isOpen: boolean; onToggle: () => void }) {
  const [, upc, name, cat, date, score, fi, text, src] = p;
  const fl = fi.map((i) => flags[i]).filter(Boolean);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (isOpen && ref.current && new URLSearchParams(window.location.search).get('open')) ref.current.scrollIntoView({ block: 'center' });
  }, [isOpen]);
  const year = Number(date.slice(0, 4));
  const g = grade(score);
  const id = `prod-${(upc || name).replace(/\W+/g, '-')}`;
  const openInScan = () => {
    try { sessionStorage.setItem('pantry.scanText', text); } catch { /* ignore */ }
    window.location.href = `${base}/scan/`;
  };
  return (
    <li ref={ref} className={`prod${isOpen ? ' prod--open' : ''}`}>
      <button type="button" className="prod__row" aria-expanded={isOpen} aria-controls={id} onClick={onToggle}>
        <span className={`sc sc--${g}`} title={score < 0 ? 'Not scored' : `${score}/100 · ${GRADE_LABEL[g]}`}>{shown(score)}</span>
        <span>
          <span className="prod__name">{name}</span>
          <span className="prod__worst">{score < 0 ? 'Ingredient list could not be read' : fl.length ? fl.slice(0, 3).map((f) => f[0]).join(' · ') + (fl.length > 3 ? ` · +${fl.length - 3} more` : '') : 'No flagged ingredients'}</span>
        </span>
        <span className="prod__date">{src ? 'Label 2026' : `Label ${year}`}</span>
      </button>
      {isOpen && (
        <div className="prod__body" id={id}>
          {score < 0 ? (
            <p className="score__sum" style={{ marginTop: 0 }}>The scanner could not read this ingredient list, so it has no score. Open it in Scan to check it by hand.</p>
          ) : (
            <p className="score__sum" style={{ marginTop: 0 }}><strong>{GRADE_LABEL[g]}</strong> · {score}/100 from the same check the Scan page runs. Label only: additives and sugar, not nutrition.</p>
          )}
          {fl.length > 0 && (
            <>
              <p className="prod__h">Worst ingredients first</p>
              <ul className="ingr">
                {fl.map((f, i) => {
                  const r = risk(f);
                  const inner = (
                    <>
                      <span className={`ingr__dot risk--${r}`} aria-hidden="true" />
                      <div>
                        <div className="ingr__name">{f[0]}</div>
                        {f[2] && <span className={`pill ingr__carc ingr__carc--${f[2] === 'C' ? 'classified' : 'linked'}`}>{f[2] === 'C' ? 'Classified carcinogen' : 'Cancer link (weaker evidence)'}</span>}
                        {f[4] && <div className="ingr__why">{f[4]}</div>}
                      </div>
                      <span className="ingr__score">{f[1]}/100</span>
                    </>
                  );
                  return (
                    <li key={i} className={`ingr__row ingr__row--${r}`}>
                      {f[5] ? <a className="ingr__link" href={`${base}/ingredients/${f[5]}/`} style={{ display: 'contents' }}>{inner}</a> : inner}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="prod__h">Full ingredient list</p>
          <p className="prod__text">{text}</p>
          <div className="prod__meta">
            {upc && <span><b>Barcode</b> {upc}</span>}
            {cat && <span><b>Category</b> {cat}</span>}
            <span><b>Label</b> {date}</span>
            <span><b>Source</b> {src ? <a href={src} rel="noopener noreferrer">brand or retailer page, checked Nov 2026</a> : 'USDA FoodData Central'}</span>
          </div>
          {!src && year && year < 2024 && <p className="notice notice--amber" style={{ marginTop: '0.85rem' }}>This label is from {year}. The recipe may have changed since, so check the package.</p>}
          <div className="tools__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={openInScan}>Open in Scan for the full breakdown</button>
          </div>
        </div>
      )}
    </li>
  );
}
