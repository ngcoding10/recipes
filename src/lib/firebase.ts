/**
 * Firebase, loaded only when it is configured and first needed, so pages stay light.
 * Everything here is optional: callers check `firebaseEnabled` first and fall back to
 * on-device storage and a personal API key.
 */
import { FIREBASE_CONFIG, FUNCTIONS_REGION } from '../config/firebase';
import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';

export const firebaseEnabled = FIREBASE_CONFIG !== null;

interface Fb { app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions }
let loading: Promise<Fb> | null = null;

export function loadFirebase(): Promise<Fb> {
  if (!FIREBASE_CONFIG) return Promise.reject(new Error('Sign-in is not set up on this site yet.'));
  if (!loading) {
    const config = FIREBASE_CONFIG;
    loading = (async () => {
      const [{ initializeApp }, authMod, fsMod, fnMod] = await Promise.all([
        import('firebase/app'), import('firebase/auth'), import('firebase/firestore'), import('firebase/functions'),
      ]);
      const app = initializeApp(config);
      const auth = authMod.getAuth(app);
      await authMod.setPersistence(auth, authMod.browserLocalPersistence);
      const db = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache() });
      const functions = fnMod.getFunctions(app, FUNCTIONS_REGION);
      return { app, auth, db, functions };
    })();
  }
  return loading;
}

// ---------------------------------------------------------------------------------------------
// Auth state, shared by every island on the page
// ---------------------------------------------------------------------------------------------
export interface Account { uid: string; name: string; email: string; photo: string }
type Listener = (a: Account | null) => void;
const listeners = new Set<Listener>();
let current: Account | null = null;
let ready = false;
let started = false;

const toAccount = (u: User | null): Account | null =>
  u ? { uid: u.uid, name: u.displayName ?? '', email: u.email ?? '', photo: u.photoURL ?? '' } : null;

function start() {
  if (started || !firebaseEnabled) return;
  started = true;
  loadFirebase().then(async ({ auth }) => {
    const { onAuthStateChanged, getRedirectResult } = await import('firebase/auth');
    getRedirectResult(auth).catch(() => { /* no pending redirect */ });
    onAuthStateChanged(auth, (u) => {
      current = toAccount(u); ready = true;
      for (const l of listeners) l(current);
    });
  }).catch(() => { ready = true; for (const l of listeners) l(null); });
}

/** Subscribe to sign-in changes. Calls back immediately once the state is known. */
export function onAccount(cb: Listener): () => void {
  listeners.add(cb);
  start();
  if (ready || !firebaseEnabled) cb(current);
  return () => listeners.delete(cb);
}

export async function signInWithGoogle(): Promise<void> {
  const { auth } = await loadFirebase();
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e: any) {
    // Some phones and in-app browsers block popups: fall back to a full-page redirect.
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
    if (e?.code === 'auth/unauthorized-domain') throw new Error('This website address is not on the Firebase "Authorized domains" list yet.');
    throw new Error(e?.message ?? 'Sign-in failed.');
  }
}

export async function signOutNow(): Promise<void> {
  const { auth } = await loadFirebase();
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
}

/** Call a Cloud Function (callable). Errors come back with a readable message. */
export async function callFunction<I, O>(name: string, data: I): Promise<O> {
  const { functions } = await loadFirebase();
  const { httpsCallable } = await import('firebase/functions');
  try {
    const res = await httpsCallable<I, O>(functions, name, { timeout: 120_000 })(data);
    return res.data;
  } catch (e: any) {
    const code: string = e?.code ?? '';
    if (code.endsWith('unauthenticated')) throw new Error('Sign in with Google first.');
    if (code.endsWith('resource-exhausted')) throw new Error(e?.message || 'Daily limit reached. Try again tomorrow.');
    if (code.endsWith('not-found') || code.endsWith('internal') && /not found|404/i.test(e?.message ?? '')) throw new Error('The AI service is not deployed yet.');
    throw new Error(e?.message || 'The AI service failed. Try again.');
  }
}
