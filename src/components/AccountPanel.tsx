import { useEffect, useState } from 'react';
import { firebaseEnabled, signInWithGoogle, signOutNow } from '../lib/firebase';
import { useAccount } from '../lib/useAccount';
import { clearDeviceData, deleteAccountData, listSaved } from '../lib/store';
import { usePantry } from '../lib/usePantry';
import { GoogleMark } from './AiAccess';

type Theme = 'system' | 'light' | 'dark';
function applyTheme(t: Theme) {
  try { if (t === 'system') localStorage.removeItem('pantry.theme'); else localStorage.setItem('pantry.theme', t); } catch { /* ignore */ }
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
}

export function AccountCard() {
  const { account, ready } = useAccount();
  const { items } = usePantry();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [savedCount, setSavedCount] = useState<number | null>(null);

  useEffect(() => { listSaved(account?.uid ?? null).then((l) => setSavedCount(l.length)).catch(() => setSavedCount(null)); }, [account?.uid]);

  const act = async (fn: () => Promise<void>, ok = '') => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); if (ok) setMsg(ok); } catch (e: any) { setErr(e?.message ?? 'Something went wrong.'); } finally { setBusy(false); }
  };

  if (!firebaseEnabled) {
    return (
      <div>
        <h2 className="section-title">Google sign-in</h2>
        <p className="tools__muted">Sign-in is not switched on for this site yet. Everything still works: your pantry and saved recipes are kept on this device, and the AI features can use your own API key below.</p>
      </div>
    );
  }
  if (!ready) return <p className="tools__muted"><span className="spinner spinner--dark" /> Checking sign-in…</p>;
  if (!account) {
    return (
      <div>
        <h2 className="section-title">Sign in</h2>
        <p className="tools__muted" style={{ marginTop: 0 }}>Sign in with Google to keep your pantry and saved recipes on every device, and to use the AI features without your own key (with a daily limit).</p>
        <button className="btn btn--outline btn--google btn--lg" onClick={() => act(signInWithGoogle)} disabled={busy}><GoogleMark /> {busy ? 'Opening Google…' : 'Sign in with Google'}</button>
        {err && <p className="notice notice--red" role="alert" style={{ marginTop: '0.75rem' }}>{err}</p>}
        <p className="tools__hint">We store your Google name and email (from Google), your pantry list and the recipes you save. Nothing else. See the <a href="../privacy/">privacy page</a>.</p>
      </div>
    );
  }
  const initial = (account.name || account.email || '?').slice(0, 1).toUpperCase();
  return (
    <div>
      <div className="account__who">
        <span className="account__avatar" aria-hidden="true">{account.photo ? <img src={account.photo} alt="" referrerPolicy="no-referrer" /> : initial}</span>
        <div><div className="account__name">{account.name || 'Signed in'}</div><div className="account__email">{account.email}</div></div>
      </div>
      <p className="tools__muted">{items.length} pantry item{items.length === 1 ? '' : 's'} and {savedCount ?? '…'} saved recipe{savedCount === 1 ? '' : 's'} in your account.</p>
      <div className="tools__actions">
        <button className="btn btn--outline" onClick={() => act(signOutNow, 'Signed out.')} disabled={busy}>Sign out</button>
        <button className="btn btn--ghost" disabled={busy} onClick={() => {
          if (!confirm('Delete your pantry and every saved recipe from your account? This cannot be undone.')) return;
          act(async () => { await deleteAccountData(account.uid); clearDeviceData(); await signOutNow(); }, 'Your saved data was deleted and you are signed out.');
        }}>Delete my data</button>
      </div>
      {msg && <p className="notice notice--green" style={{ marginTop: '0.75rem' }}>{msg}</p>}
      {err && <p className="notice notice--red" role="alert" style={{ marginTop: '0.75rem' }}>{err}</p>}
    </div>
  );
}

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => { try { const t = localStorage.getItem('pantry.theme'); if (t === 'light' || t === 'dark') setTheme(t); } catch { /* ignore */ } }, []);
  const pick = (t: Theme) => { setTheme(t); applyTheme(t); };
  return (
    <div className="segmented theme-pick" role="radiogroup" aria-label="Colour theme">
      {(['system', 'light', 'dark'] as Theme[]).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={theme === t} className={`segmented__btn${theme === t ? ' segmented__btn--on' : ''}`} onClick={() => pick(t)}>
          {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  );
}

export function DeviceData() {
  const [done, setDone] = useState(false);
  return (
    <div className="tools__actions" style={{ marginTop: 0 }}>
      <button className="btn btn--outline btn--sm" onClick={() => { if (confirm('Remove the pantry list and saved recipes stored on this device?')) { clearDeviceData(); setDone(true); } }}>{done ? 'Cleared' : 'Clear this device'}</button>
    </div>
  );
}
