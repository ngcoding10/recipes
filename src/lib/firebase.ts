/**
 * Firebase for The Pantry: a thin wrapper around core.js, the module every app on the shared
 * backend copies unchanged (see docs/BACKEND.md). The Firebase SDK is loaded lazily, the first
 * time a page asks who is signed in, so pages stay light.
 *
 * Everything here is optional: when `firebaseEnabled` is false the site is local-only.
 */
import { APP_CHECK_SITE_KEY, FIREBASE_CONFIG } from '../config/firebase';
import { createCore, wantsEmulator, type Core, type CoreUser } from './core.js';

/** The app's name on the shared backend: prefix of its collections, functions and storage keys. */
export const APP_NAME = 'pantry';

/** True when the site was built with a Firebase config (the same on the server and in the browser). */
export const firebaseConfigured = FIREBASE_CONFIG !== null;
/** Local testing: localhost with ?emulator in the address talks to the Firebase emulators. */
const emulator = wantsEmulator(APP_NAME);
/** True when sign-in and cloud saving are available. Browser-only when it comes from emulator mode. */
export const firebaseEnabled = firebaseConfigured || emulator;

export type Account = CoreUser;

let core: Core | null = null;
let loading: Promise<Core> | null = null;

/** Load the Firebase SDK and build the core, once. */
export function loadFirebase(): Promise<Core> {
  if (!firebaseEnabled) return Promise.reject(new Error('Sign-in is not set up on this site yet.'));
  if (!loading) {
    loading = (async () => {
      const [app, auth, firestore, functions, appCheck] = await Promise.all([
        import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
        import('firebase/functions'), import('firebase/app-check'),
      ]);
      const c = createCore({
        appName: APP_NAME,
        sdk: { app, auth, firestore, functions, appCheck },
        config: FIREBASE_CONFIG,
        appCheckSiteKey: APP_CHECK_SITE_KEY,
        emulator,
      });
      // Local testing only: Google's sign-in window cannot be driven by a test, so emulator
      // mode exposes a way to sign in as a made-up account.
      if (c.emulator) (window as any).__emuSignIn = (email: string) => c.emulatorSignIn(email);
      core = c;
      return c;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

// ---------------------------------------------------------------------------------------------
// Who is signed in, shared by every island on the page
// ---------------------------------------------------------------------------------------------
type Listener = (a: Account | null) => void;
const listeners = new Set<Listener>();
let current: Account | null = null;
let ready = false;
let started = false;

function start() {
  if (started || !firebaseEnabled) return;
  started = true;
  const tell = (a: Account | null) => { current = a; ready = true; for (const l of [...listeners]) l(a); };
  loadFirebase().then((c) => c.onUser(tell)).catch(() => tell(null));
}

/**
 * Subscribe to sign-in changes. Starts loading Firebase, and calls back once the state is
 * known. After the first call back, `signInWithGoogle` is ready to use from a click.
 */
export function onAccount(cb: Listener): () => void {
  listeners.add(cb);
  start();
  if (ready || !firebaseEnabled) cb(current);
  return () => listeners.delete(cb);
}

/**
 * Google sign-in. Call it straight from the click handler with nothing awaited before it:
 * browsers only open the sign-in window in direct response to a click. That is why Firebase is
 * loaded beforehand (see `onAccount`) and this function does not load anything itself.
 */
export function signInWithGoogle(): Promise<Account | null> {
  if (!core) return Promise.reject(new Error(firebaseEnabled ? 'Sign-in is still loading. Try again in a moment.' : 'Sign-in is not set up on this site yet.'));
  return core.signInWithGoogle();
}

export async function signOutNow(): Promise<void> {
  await (await loadFirebase()).signOut();
}

/** Call a Cloud Function. Errors carry a message that is fine to show. */
export async function callFunction<I, O>(name: string, data: I): Promise<O> {
  return (await loadFirebase()).call<O>(name, data);
}
