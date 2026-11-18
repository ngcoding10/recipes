/**
 * Your pantry list and saved AI recipes.
 *
 * Signed out: kept on this device (localStorage).
 * Signed in with Google: kept in Firestore under users/{uid}, so they follow you to any device.
 * The first time you sign in, anything saved on the device is merged into the account.
 */
import type { GeneratedRecipe, RecipeRequest } from './ai-shared';
import { firebaseEnabled, loadFirebase } from './firebase';

const PANTRY_KEY = 'pantry.items';
const SAVED_KEY = 'pantry.savedRecipes';
export const PANTRY_EVENT = 'pantry:items';
export const SAVED_EVENT = 'pantry:saved';

export interface SavedRecipe { id: string; recipe: GeneratedRecipe; request: RecipeRequest | null; createdAt: number }

const readLocal = <T>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const writeLocal = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const emit = (name: string) => { try { window.dispatchEvent(new CustomEvent(name)); } catch { /* SSR */ } };

// ---------------------------------------------------------------------------------------------
// Pantry
// ---------------------------------------------------------------------------------------------
export function getLocalPantry(): string[] { return readLocal<string[]>(PANTRY_KEY, []); }

let pushTimer: ReturnType<typeof setTimeout> | undefined;
/** Save the pantry on this device and, when signed in, to the account (debounced). */
export function setPantry(items: string[], uid: string | null): void {
  const clean = [...new Set(items.map((i) => i.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  writeLocal(PANTRY_KEY, clean);
  emit(PANTRY_EVENT);
  if (!uid || !firebaseEnabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const { db } = await loadFirebase();
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', uid), { pantry: clean, updatedAt: serverTimestamp() });
    } catch { /* offline: Firestore retries from its local cache */ }
  }, 600);
}

/** On sign-in: merge the account's pantry with this device's and return the result. */
export async function syncPantry(uid: string): Promise<string[]> {
  const local = getLocalPantry();
  try {
    const { db } = await loadFirebase();
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'users', uid));
    const remote: string[] = (snap.exists() && Array.isArray(snap.get('pantry')) ? snap.get('pantry') : []) as string[];
    const merged = [...new Set([...remote, ...local])];
    if (merged.length !== remote.length) setPantry(merged, uid);
    else { writeLocal(PANTRY_KEY, merged); emit(PANTRY_EVENT); }
    return merged;
  } catch {
    return local;
  }
}

// ---------------------------------------------------------------------------------------------
// Saved recipes
// ---------------------------------------------------------------------------------------------
export async function listSaved(uid: string | null): Promise<SavedRecipe[]> {
  if (!uid || !firebaseEnabled) return readLocal<SavedRecipe[]>(SAVED_KEY, []).sort((a, b) => b.createdAt - a.createdAt);
  const { db } = await loadFirebase();
  const { collection, getDocs, orderBy, query, limit } = await import('firebase/firestore');
  const snap = await getDocs(query(collection(db, 'users', uid, 'recipes'), orderBy('createdAt', 'desc'), limit(100)));
  return snap.docs.map((d) => ({ id: d.id, recipe: d.get('recipe'), request: d.get('request') ?? null, createdAt: d.get('createdAt')?.toMillis?.() ?? Date.now() }));
}

export async function saveRecipe(recipe: GeneratedRecipe, request: RecipeRequest | null, uid: string | null): Promise<string> {
  if (!uid || !firebaseEnabled) {
    const list = readLocal<SavedRecipe[]>(SAVED_KEY, []);
    const id = `local-${Date.now().toString(36)}`;
    list.unshift({ id, recipe, request, createdAt: Date.now() });
    writeLocal(SAVED_KEY, list.slice(0, 100));
    emit(SAVED_EVENT);
    return id;
  }
  const { db } = await loadFirebase();
  const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
  const ref = await addDoc(collection(db, 'users', uid, 'recipes'), { recipe, request, createdAt: serverTimestamp() });
  emit(SAVED_EVENT);
  return ref.id;
}

export async function deleteSaved(id: string, uid: string | null): Promise<void> {
  if (!uid || !firebaseEnabled || id.startsWith('local-')) {
    writeLocal(SAVED_KEY, readLocal<SavedRecipe[]>(SAVED_KEY, []).filter((r) => r.id !== id));
  } else {
    const { db } = await loadFirebase();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await deleteDoc(doc(db, 'users', uid, 'recipes', id));
  }
  emit(SAVED_EVENT);
}

/** On sign-in: move recipes saved on this device into the account. */
export async function migrateLocalSaved(uid: string): Promise<number> {
  const local = readLocal<SavedRecipe[]>(SAVED_KEY, []);
  if (!local.length) return 0;
  for (const r of local.slice().reverse()) await saveRecipe(r.recipe, r.request, uid);
  writeLocal(SAVED_KEY, []);
  emit(SAVED_EVENT);
  return local.length;
}

/** Delete everything stored for this account (pantry and saved recipes). */
export async function deleteAccountData(uid: string): Promise<void> {
  const { db } = await loadFirebase();
  const { collection, deleteDoc, doc, getDocs } = await import('firebase/firestore');
  const snap = await getDocs(collection(db, 'users', uid, 'recipes'));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, 'users', uid));
}

/** Delete everything kept on this device. */
export function clearDeviceData(): void {
  for (const k of [PANTRY_KEY, SAVED_KEY]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  emit(PANTRY_EVENT); emit(SAVED_EVENT);
}
