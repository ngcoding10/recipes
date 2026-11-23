import { useEffect, useState } from 'react';
import { firebaseConfigured, firebaseEnabled, onAccount, type Account } from './firebase';

interface State {
  /** The signed-in person (null when signed out or when sign-in is not set up). */
  account: Account | null;
  /** True once the sign-in state is known. From then on a click can open the Google window. */
  ready: boolean;
  /** True when sign-in is available on this site. */
  enabled: boolean;
}

/**
 * Who is signed in. Mounting this starts loading Firebase, so that it is already loaded by the
 * time someone clicks "Sign in with Google".
 */
export function useAccount(): State {
  // The first render must match the server's HTML, which never knows about emulator mode.
  const [state, setState] = useState<State>({ account: null, ready: !firebaseConfigured, enabled: firebaseConfigured });
  useEffect(() => {
    if (firebaseEnabled !== firebaseConfigured) setState({ account: null, ready: false, enabled: firebaseEnabled });
    return onAccount((account) => setState({ account, ready: true, enabled: firebaseEnabled }));
  }, []);
  return state;
}
