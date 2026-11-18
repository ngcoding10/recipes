import { useEffect, useState } from 'react';
import { firebaseEnabled, onAccount, type Account } from './firebase';

/** The signed-in Google account (null when signed out or when sign-in is not set up). */
export function useAccount(): { account: Account | null; ready: boolean } {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(!firebaseEnabled);
  useEffect(() => onAccount((a) => { setAccount(a); setReady(true); }), []);
  return { account, ready };
}
