// Integration test against the Firebase emulators (auth, firestore, functions):
//   npx firebase-tools emulators:exec --project demo-pantry --only auth,firestore,functions "node scripts/emulator-test.mjs"
// Needs functions/.secret.local with ANTHROPIC_API_KEY=anything (the model call is expected to fail
// with a fake key, which also exercises the error mapping and the refund).
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, addDoc, collection, getDocs } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const PROJECT = 'demo-pantry';
const app = initializeApp({ apiKey: 'demo', authDomain: `${PROJECT}.firebaseapp.com`, projectId: PROJECT, appId: 'demo' });
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
const fns = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fns, '127.0.0.1', 5001);
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const admin = { authorization: 'Bearer owner', 'content-type': 'application/json' };

let passed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log('✓', name); } catch (e) { process.exitCode = 1; console.error('✗', name, '\n  ', e.message); } };
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return String(e.code).replace(/^(functions|firestore)\//, ''); } };
const signIn = (sub, email) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: 'Test ' + sub })));
const req = { ingredients: ['eggs', 'spinach'], meal: 'breakfast', servings: 2, maxMinutes: 20, diets: [], strict: false, avoidZero: true, note: '' };
const gen = httpsCallable(fns, 'generateRecipe');

await check('signed-out callers are refused', async () => assert.equal(await code(gen(req)), 'unauthenticated'));
const { user: alice } = await signIn('alice', 'alice@example.com');
await check('Google sign-in works (auth emulator)', async () => assert.equal(alice.email, 'alice@example.com'));

await check('own pantry can be written and read', async () => {
  await setDoc(doc(db, 'users', alice.uid), { pantry: ['eggs', 'rice'], updatedAt: new Date() });
  assert.deepEqual((await getDoc(doc(db, 'users', alice.uid))).get('pantry'), ['eggs', 'rice']);
});
await check('extra fields on the user doc are rejected', async () => assert.equal(await code(setDoc(doc(db, 'users', alice.uid), { pantry: [], updatedAt: new Date(), admin: true })), 'permission-denied'));
await check('own recipes can be saved and listed', async () => {
  await addDoc(collection(db, 'users', alice.uid, 'recipes'), { recipe: { title: 'Test' }, request: null, createdAt: new Date() });
  assert.equal((await getDocs(collection(db, 'users', alice.uid, 'recipes'))).size, 1);
});
await check('usage counters are not readable or writable by users', async () => {
  assert.equal(await code(getDoc(doc(db, 'usage', `x_${alice.uid}`))), 'permission-denied');
  assert.equal(await code(setDoc(doc(db, 'usage', `x_${alice.uid}`), { count: 0 })), 'permission-denied');
});
await check('invalid request is rejected before spending', async () => assert.equal(await code(gen({ meal: 'brunch' })), 'invalid-argument'));
await check('model failure maps to a readable error and is refunded', async () => {
  const c = await code(gen(req));
  assert.ok(['internal', 'unavailable', 'failed-precondition'].includes(c), c);
  const day = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${FS}/usage/${day}_${alice.uid}`, { headers: admin }).then((x) => x.json());
  assert.equal(Number(r.fields?.count?.integerValue ?? 0), 0);
});
await check('daily limit stops the 9th request', async () => {
  const day = new Date().toISOString().slice(0, 10);
  await fetch(`${FS}/usage/${day}_${alice.uid}?updateMask.fieldPaths=count`, { method: 'PATCH', headers: admin, body: JSON.stringify({ fields: { count: { integerValue: '8' } } }) });
  assert.equal(await code(gen(req)), 'resource-exhausted');
});

await signOut(auth);
const { user: bob } = await signIn('bob', 'bob@example.com');
await check("another account cannot read or write Alice's data", async () => {
  assert.equal(await code(getDoc(doc(db, 'users', alice.uid))), 'permission-denied');
  assert.equal(await code(getDocs(collection(db, 'users', alice.uid, 'recipes'))), 'permission-denied');
  assert.equal(await code(setDoc(doc(db, 'users', alice.uid), { pantry: ['x'], updatedAt: new Date() })), 'permission-denied');
});
await check("Alice's limit does not affect Bob", async () => assert.notEqual(await code(gen(req)), 'resource-exhausted'));
console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
process.exit(process.exitCode ?? 0);
