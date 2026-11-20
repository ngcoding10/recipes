import { useEffect, useState } from 'react';
import { getKey, setKey, maskKey, KEY_EVENT } from '../lib/ai';

interface Props {
  /** Compact inline variant used on the Cook / Scan pages when no key is saved. */
  compact?: boolean;
  onChange?: (hasKey: boolean) => void;
}

export default function ApiKeyBox({ compact, onChange }: Props) {
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    setSaved(getKey());
    const sync = () => setSaved(getKey());
    window.addEventListener(KEY_EVENT, sync);
    return () => window.removeEventListener(KEY_EVENT, sync);
  }, []);

  const save = () => {
    const k = draft.trim();
    if (!k.startsWith('sk-ant-')) { setFlash('That does not look like an Anthropic key (they start with sk-ant-).'); return; }
    setKey(k);
    setSaved(k);
    setDraft('');
    setFlash('Saved on this device.');
    onChange?.(true);
  };
  const forget = () => {
    setKey('');
    setSaved('');
    setFlash('Key removed from this device.');
    onChange?.(false);
  };

  return (
    <div className={`keybox${compact ? ' keybox--compact' : ''}`}>
      {!compact && <h2 className="section-title">Your own Anthropic key <span className="section-title__aside">optional</span></h2>}
      {compact && <p className="keybox__title">Add your API key to use this</p>}
      <p className="keybox__help">
        {saved ? (
          <>Key saved: <code>{maskKey(saved)}</code>. It is stored only in this browser and sent only to api.anthropic.com.</>
        ) : (
          <>With your own pay-as-you-go key, the AI features run on it with no daily limit, for a few cents each. It stays in this browser and is sent only to api.anthropic.com. A Claude Pro subscription does not cover API use.</>
        )}
      </p>
      {saved ? (
        <div className="keybox__row">
          <button className="btn btn--outline btn--sm" onClick={forget}>Forget key</button>
          {flash && <span className="keybox__flash">{flash}</span>}
        </div>
      ) : (
        <>
          <div className="keybox__row">
            <input
              className="input keybox__input"
              type={show ? 'text' : 'password'}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              aria-label="Anthropic API key"
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
            <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={!draft.trim()}>Save</button>
          </div>
          {flash && <p className="keybox__flash">{flash}</p>}
          <ol className="keybox__steps">
            <li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com → API keys</a> and create a key.</li>
            <li>Add a small amount of credit under Billing (the minimum top-up is $5 and lasts a long time at personal use).</li>
            <li>Paste the key above and press Save. You only do this once per device.</li>
          </ol>
        </>
      )}
    </div>
  );
}
