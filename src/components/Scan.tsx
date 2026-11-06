import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeLabel, type LabelAnalysis } from '../lib/label';
import { askClaude, extractJson, fileToImageBlock, getKey, KEY_EVENT, type ContentBlock } from '../lib/ai';
import ApiKeyBox from './ApiKeyBox';

type Stage = 'idle' | 'ocr' | 'ready' | 'error';

interface AiResult {
  score: number;
  summary: string;
  productGuess?: string;
  items?: Array<{ name: string; score: number; note?: string }>;
  concerns?: Array<{ title: string; severity: 'low' | 'moderate' | 'high'; detail: string }>;
  positives?: string[];
  swaps?: string[];
  nutritionNotes?: string;
  confidence?: 'low' | 'medium' | 'high';
}

const RISK_LABEL: Record<number, string> = { 0: 'No known concern', 1: 'Limited concern', 2: 'Moderate concern', 3: 'High concern' };

function ScoreRing({ score, grade, label, sub }: { score: number; grade: string; label: string; sub?: string }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className={`score score--${grade}`}>
      <div className="score__ring" role="img" aria-label={`Score ${score} out of 100, ${label}`}>
        <svg viewBox="0 0 132 132">
          <circle className="score__ring-bg" cx="66" cy="66" r={r} />
          <circle className="score__ring-fg" cx="66" cy="66" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
        </svg>
        <div className="score__num"><strong>{score}</strong><small>/ 100</small></div>
      </div>
      <div>
        <div className="score__grade">{label}</div>
        {sub && <p className="score__sum">{sub}</p>}
      </div>
    </div>
  );
}

function gradeOf(score: number) {
  return score >= 75 ? ['excellent', 'Excellent'] : score >= 50 ? ['good', 'Good'] : score >= 25 ? ['poor', 'Poor'] : ['bad', 'Bad'];
}

/** Shrink a photo before OCR so phones stay fast; returns a Blob. */
async function downscale(file: File, maxSide = 1800): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale === 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.92));
  } finally { URL.revokeObjectURL(url); }
}

export default function Scan() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHasKey(!!getKey());
    const sync = () => setHasKey(!!getKey());
    window.addEventListener(KEY_EVENT, sync);
    return () => window.removeEventListener(KEY_EVENT, sync);
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const analysis: LabelAnalysis | null = useMemo(() => (text.trim() ? analyzeLabel(text) : null), [text]);

  const reset = () => {
    setFile(null); setPreview(''); setStage('idle'); setProgress(0); setStatus(''); setText(''); setAi(null); setAiError(''); setShowAll(false);
  };

  const onFile = async (f: File | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    reset();
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStage('ocr');
    setStatus('Preparing photo…');
    try {
      const blob = await downscale(f);
      setStatus('Loading reader (first time only)…');
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text') { setStatus('Reading the label…'); setProgress(m.progress ?? 0); }
          else if (typeof m.status === 'string' && /load|init/.test(m.status)) setStatus('Loading reader (first time only)…');
        },
      });
      const { data } = await worker.recognize(blob);
      await worker.terminate();
      const t = (data.text ?? '').trim();
      setText(t);
      setStage('ready');
      setStatus('');
      if (!t) setPasteMode(true);
    } catch (e: any) {
      setStage('error');
      setStatus(e?.message ?? 'Could not read that photo.');
    }
  };

  const runAi = async () => {
    setAiBusy(true); setAiError(''); setAi(null);
    try {
      const content: ContentBlock[] = [];
      if (file) content.push(await fileToImageBlock(file));
      const found = analysis?.flagged.map((g) => `${g.match?.name ?? g.raw} (risk ${g.risk})`).join('; ') || 'none';
      content.push({ type: 'text', text:
`Analyse this food like the Yuka app would. ${file ? 'A photo is attached.' : 'No photo; use the label text only.'}
Label text read by OCR (may contain errors):
"""${text.slice(0, 4000)}"""
Our additive database already flagged: ${found}.
Return JSON only:
{"productGuess":"what the product most likely is","score":0-100,"summary":"two sentences, plain English",
 "nutritionNotes":"what the nutrition panel or visible food suggests about sugar, salt, saturated fat, fibre, protein — say 'not visible' if you cannot see it",
 "items":[{"name":"ingredient or food item","score":0-100,"note":"short reason"}],
 "concerns":[{"title":"","severity":"low|moderate|high","detail":"why, with the public classification (IARC group, EU/US ban, EFSA opinion) where one exists"}],
 "positives":["..."],"swaps":["healthier alternatives"],"confidence":"low|medium|high"}
Scoring: 60% nutrition quality (Nutri-Score-like), 30% additives, 10% degree of processing. Be precise and calm: distinguish 'possibly carcinogenic (IARC 2B)' from 'carcinogenic (Group 1)'. Never diagnose. If the image is not food, say so in summary and give score 0.` });
      const reply = await askClaude({ system: 'You are a careful food-label and nutrition analyst. You only state classifications you are sure of and you say when something is uncertain or not visible. This is educational, not medical advice.', content, maxTokens: 1800, temperature: 0.2 });
      const data = extractJson<AiResult>(reply);
      if (typeof data.score !== 'number') throw new Error('The AI reply was incomplete. Try again.');
      data.score = Math.max(0, Math.min(100, Math.round(data.score)));
      setAi(data);
    } catch (e: any) {
      setAiError(e?.message ?? 'AI check failed.');
    } finally {
      setAiBusy(false);
    }
  };

  const combined = analysis && ai ? Math.round(0.4 * analysis.score + 0.6 * ai.score) : null;

  return (
    <div className="scan">
      {/* ------------ Input ------------ */}
      {!file && !pasteMode && (
        <div className="card-surface tools__card">
          <div
            className={`scan__drop${drag ? ' scan__drop--active' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          >
            <div className="scan__drop-ico">
              <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><use href="#i-camera" /></svg>
            </div>
            <div className="scan__drop-title">Photograph the ingredients list</div>
            <div className="scan__drop-sub">Fill the frame with the label, hold steady, good light. Reading happens on your device, free.</div>
          </div>
          <div className="tools__actions">
            <button className="btn btn--primary" onClick={() => cameraRef.current?.click()}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><use href="#i-camera" /></svg>
              Take a photo
            </button>
            <button className="btn btn--ghost" onClick={() => inputRef.current?.click()}>Choose from gallery</button>
            <button className="btn-link" onClick={() => setPasteMode(true)}>or paste the ingredient text</button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      )}

      {(file || pasteMode) && (
        <div className="card-surface tools__card">
          {preview && (
            <div className="scan__preview">
              <img src={preview} alt="Your photo" />
              <button className="btn btn--outline btn--sm scan__preview-x" onClick={reset}>New scan</button>
            </div>
          )}
          {stage === 'ocr' && (
            <div className="scan__progress">
              <span className="spinner spinner--dark" />
              <span>{status}</span>
              <div className="scan__bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            </div>
          )}
          {stage === 'error' && <p className="notice notice--red" style={{ marginTop: '0.75rem' }}>{status} You can still paste the text below.</p>}
          {(stage === 'ready' || stage === 'error' || pasteMode) && (
            <div className="field" style={{ marginTop: '0.9rem' }}>
              <span className="field__label">{stage === 'ready' ? 'Text we read (fix any mistakes and the score updates)' : 'Ingredient list'}</span>
              <textarea className="input scan__ocr" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ingredients: sugar, wheat flour, palm oil, cocoa, emulsifier (soy lecithin), E102, salt…" />
              {pasteMode && !file && <div className="tools__row"><button className="btn-link" onClick={() => setPasteMode(false)}>Use a photo instead</button></div>}
            </div>
          )}
        </div>
      )}

      {/* ------------ Result ------------ */}
      {analysis && analysis.ingredients.length > 0 && (
        <>
          <div className="card-surface tools__card">
            <ScoreRing
              score={combined ?? analysis.score}
              grade={gradeOf(combined ?? analysis.score)[0]}
              label={gradeOf(combined ?? analysis.score)[1]}
              sub={combined != null
                ? `Combined: ${analysis.score} from the label check and ${ai!.score} from the AI nutrition check.`
                : `${analysis.ingredients.length} ingredients read · ${analysis.flagged.length} flagged · ${analysis.unknownCount} not in the database. Label-only score (additives and sugar), nutrition not included.`}
            />
          </div>

          {analysis.flagged.length > 0 ? (
            <div className="card-surface tools__card">
              <h2 className="section-title">Worst ingredients first</h2>
              <ul className="ingr">
                {analysis.flagged.map((g, i) => (
                  <li key={i} className={`ingr__row ingr__row--${g.risk}`}>
                    <span className={`ingr__dot risk--${g.risk}`} aria-hidden="true" />
                    <div>
                      <div className="ingr__name">{g.match?.name}{g.match?.code ? ` · ${g.match.code}` : ''} <span className="ingr__raw">{g.raw !== g.match?.name ? `“${g.raw}”` : ''}</span></div>
                      <div className="ingr__why">{g.match?.why}</div>
                      {g.match?.evidence && <div className="ingr__ev">{RISK_LABEL[g.risk ?? 0]} · {g.match.evidence}</div>}
                    </div>
                    <span className="ingr__score">{g.score}/100</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="notice notice--green">No flagged additives found in this list.</p>
          )}

          <div className="card-surface tools__card">
            <button className="btn-link" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Hide' : 'Show'} every ingredient ({analysis.ingredients.length})</button>
            {showAll && (
              <ul className="ingr" style={{ marginTop: '0.75rem' }}>
                {analysis.ingredients.map((g, i) => (
                  <li key={i} className={`ingr__row${g.risk != null ? ` ingr__row--${g.risk}` : ''}`}>
                    <span className={`ingr__dot risk--${g.risk ?? 'u'}`} aria-hidden="true" />
                    <div>
                      <div className="ingr__name">{g.raw}</div>
                      <div className="ingr__why">{g.match ? `${g.match.name}: ${g.match.why}` : 'Not in the database — most likely an ordinary food ingredient.'}</div>
                    </div>
                    <span className="ingr__score">{g.score == null ? '—' : `${g.score}/100`}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="scan__legend">
              <span><i className="risk--3" /> High</span><span><i className="risk--2" /> Moderate</span><span><i className="risk--1" /> Limited</span><span><i className="risk--0" /> No concern</span><span><i className="risk--u" /> Unknown</span>
            </div>
            {analysis.notes.length > 0 && (
              <details style={{ marginTop: '0.75rem' }}>
                <summary className="btn-link" style={{ cursor: 'pointer' }}>How the score was calculated</summary>
                <ul className="ai__list">{analysis.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </details>
            )}
          </div>

          {/* ------------ AI second opinion ------------ */}
          <div className="card-surface tools__card">
            <h2 className="section-title">AI nutrition check</h2>
            <p className="tools__muted" style={{ marginTop: 0 }}>Optional. Sends the photo once to Claude to judge the nutrition panel, the type of food and anything the label reader missed. About a cent per scan on your own key.</p>
            {!hasKey ? (
              <div style={{ marginTop: '0.75rem' }}><ApiKeyBox compact onChange={setHasKey} /></div>
            ) : (
              <div className="tools__actions">
                <button className="btn btn--dark" onClick={runAi} disabled={aiBusy}>{aiBusy ? <><span className="spinner" /> Checking…</> : ai ? 'Run again' : 'Run AI check'}</button>
              </div>
            )}
            {aiError && <p className="notice notice--red" style={{ marginTop: '0.75rem' }}>{aiError}</p>}
            {ai && (
              <div style={{ marginTop: '1rem' }}>
                <ScoreRing score={ai.score} grade={gradeOf(ai.score)[0]} label={`${gradeOf(ai.score)[1]} · AI`} sub={`${ai.productGuess ? ai.productGuess + '. ' : ''}${ai.summary}`} />
                {ai.nutritionNotes && <p className="gen__why"><strong>Nutrition:</strong> {ai.nutritionNotes}</p>}
                {ai.concerns && ai.concerns.length > 0 && (
                  <>
                    <h3 className="tools__sub">Concerns</h3>
                    <ul className="ingr">
                      {ai.concerns.map((c, i) => (
                        <li key={i} className={`ingr__row ingr__row--${c.severity === 'high' ? 3 : c.severity === 'moderate' ? 2 : 1}`}>
                          <span className={`ingr__dot risk--${c.severity === 'high' ? 3 : c.severity === 'moderate' ? 2 : 1}`} aria-hidden="true" />
                          <div><div className="ingr__name">{c.title}</div><div className="ingr__why">{c.detail}</div></div>
                          <span className="ingr__score">{c.severity}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {ai.items && ai.items.length > 0 && (
                  <>
                    <h3 className="tools__sub">Items the AI saw</h3>
                    <div className="ai__items">{ai.items.map((it, i) => <span key={i} className={`pill ${it.score >= 75 ? 'pill--green' : it.score >= 50 ? 'pill--amber' : 'pill--red'}`} title={it.note}>{it.name} · {it.score}</span>)}</div>
                  </>
                )}
                {ai.positives && ai.positives.length > 0 && (<><h3 className="tools__sub">Positives</h3><ul className="ai__list">{ai.positives.map((p, i) => <li key={i}>{p}</li>)}</ul></>)}
                {ai.swaps && ai.swaps.length > 0 && (<><h3 className="tools__sub">Healthier swaps</h3><ul className="ai__list">{ai.swaps.map((p, i) => <li key={i}>{p}</li>)}</ul></>)}
                {ai.confidence && <p className="tools__hint">AI confidence: {ai.confidence}.</p>}
              </div>
            )}
          </div>

          <p className="tools__hint">Scores are informational and based on public classifications (IARC, EFSA, FDA, EU rules). They are not medical advice, and a single ingredient at trace levels is rarely a reason to panic. “Possibly carcinogenic” (IARC 2B) is a statement about evidence strength, not about how dangerous something is.</p>
        </>
      )}
      {analysis && analysis.ingredients.length === 0 && text.trim() && (
        <p className="notice notice--amber">Could not find an ingredient list in that text. Try a closer, straighter photo of the label, or paste the text.</p>
      )}
    </div>
  );
}
