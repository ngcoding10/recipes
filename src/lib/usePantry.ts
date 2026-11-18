import { useEffect, useState } from 'react';
import { useAccount } from './useAccount';
import { getLocalPantry, migrateLocalSaved, PANTRY_EVENT, setPantry, syncPantry } from './store';

const synced = new Set<string>();

/** The shared pantry list: on this device, and synced to the Google account when signed in. */
export function usePantry() {
  const { account, ready } = useAccount();
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    setItems(getLocalPantry());
    const f = () => setItems(getLocalPantry());
    window.addEventListener(PANTRY_EVENT, f);
    return () => window.removeEventListener(PANTRY_EVENT, f);
  }, []);
  useEffect(() => {
    if (!account || synced.has(account.uid)) return;
    synced.add(account.uid);
    syncPantry(account.uid);
    migrateLocalSaved(account.uid).catch(() => {});
  }, [account?.uid]);
  const update = (next: string[]) => { setItems(next); setPantry(next, account?.uid ?? null); };
  return { items, setItems: update, account, ready };
}
