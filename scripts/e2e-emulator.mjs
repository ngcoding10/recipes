// End-to-end check of the built site against the backend's Firebase EMULATORS. Run before a release:
//
//   1. in the backend repository (backend-combination): start the emulators
//      (Auth 127.0.0.1:9099, Firestore 127.0.0.1:8080, Functions 127.0.0.1:5001, project demo-apps, fake AI model)
//   2. here: npm run test:e2e            (add -- --skip-build to reuse the last builds)
//
// It never touches the real Firebase project:
//   - the signed-in part opens the site with ?emulator, which makes core.js ignore the real config;
//   - the signed-out part uses a second build made with PUBLIC_NO_FIREBASE=1, which has no config at all;
//   - every request the test browser makes to anything but this machine is BLOCKED (two static
//     Google sign-in helper hosts excepted) and the run fails if one was aimed at the real project.
//
// Playwright is not a dependency of the site. The script uses the one installed on the machine
// (`npm i -g playwright`, or NODE_PATH pointing at a node_modules that has it).
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DIST_OFF = join(ROOT, '.e2e', 'noconfig');
const PROJECT = 'demo-apps';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const ADMIN = { Authorization: 'Bearer owner', 'content-type': 'application/json' }; // emulator-only admin access
/** Static files the Firebase sign-in SDK loads from Google before it can open the sign-in window. Nothing is sent to them. */
const SIGN_IN_HELPERS = ['apis.google.com', 'www.gstatic.com'];
/** Anything matching this is the real backend. A single request there fails the run. */
const REAL = /combination-23e84|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firestore\.googleapis\.com|cloudfunctions\.net|firebaseappcheck\.googleapis\.com|firebaseinstallations\.googleapis\.com|\.run\.app|AIzaSy/;

// ───────── helpers ─────────
let passed = 0, failed = 0; const skipped = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra && !ok ? `\n      ${String(extra).replace(/\s+/g, ' ').slice(0, 300)}` : ''}`); ok ? passed++ : failed++; };
const skip = (name, why) => { console.log(`  - skipped: ${name} (${why})`); skipped.push(name); };
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fsStatus = async (path) => (await fetch(`${FS}/${path}`, { headers: ADMIN })).status;
const fsJson = async (path) => (await fetch(`${FS}/${path}`, { headers: ADMIN })).json();
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end;) { if (await fn()) return true; await sleep(250); } return false; };
const authUserExists = async (uid) => {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ localId: [uid] }) });
  return ((await r.json()).users ?? []).length === 1;
};

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const paths = [ROOT, ...(process.env.NODE_PATH ?? '').split(':').filter(Boolean), '/opt/node-tools/node_modules'];
  try { return require(require.resolve('playwright', { paths })); } catch {
    console.error('Playwright was not found. Install it (npm i -g playwright && npx playwright install chromium) or set NODE_PATH to a node_modules folder that has it.');
    process.exit(2);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm' };
/** Serve a built copy of the site at http://localhost:<port>/recipes/ the way GitHub Pages does. */
function serve(dir) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith('/recipes')) { res.writeHead(404).end(); return; }
    let file = join(dir, normalize(path.slice('/recipes'.length) || '/'));
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, 'localhost', () => resolve({ server, base: `http://localhost:${server.address().port}/recipes` })));
}

/** A browser context that can only reach this machine. Everything else is blocked and written down. */
async function guarded(browser, options = {}) {
  const ctx = await browser.newContext(options);
  const hosts = new Map(); // host -> 'allowed' | 'blocked'
  const real = [], errors = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (/^(data|blob|about):/.test(url)) return route.continue();
    const host = new URL(url).host;
    if (REAL.test(url) && !/^(localhost|127\.0\.0\.1):/.test(host)) { real.push(url); hosts.set(host, 'blocked'); return route.abort(); }
    if (/^(localhost|127\.0\.0\.1):\d+$/.test(host) || SIGN_IN_HELPERS.includes(host)) { hosts.set(host, 'allowed'); return route.continue(); }
    hosts.set(host, 'blocked');
    return route.abort();
  });
  ctx.on('page', (page) => {
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
  });
  return { ctx, hosts, real, errors };
}

const tokens = async (page) => (await page.locator('.ktoken').allInnerTexts()).map((t) => t.replace('×', '').trim());
const addToPantry = async (page, ...items) => { for (const it of items) { await page.fill('.tokenbox__input', it); await page.keyboard.press('Enter'); } };
/** Wait until every interactive part of the page has started (a signed-in page never goes network-idle). */
const hydrated = (page) => page.waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0, null, { timeout: 30000 });
const signIn = async (page, email) => {
  await page.waitForFunction(() => typeof window.__emuSignIn === 'function', null, { timeout: 30000 });
  return (await page.evaluate((e) => window.__emuSignIn(e), email)).uid;
};

// ───────── set-up ─────────
const { chromium } = loadPlaywright();
for (const [name, url] of [['Auth', 'http://127.0.0.1:9099/'], ['Firestore', 'http://127.0.0.1:8080/'], ['Functions', 'http://127.0.0.1:5001/']]) {
  const up = await fetch(url).then(() => true, () => false);
  if (!up) { console.error(`The ${name} emulator is not answering at ${url}. Start the backend's emulators first (see docs/BACKEND.md).`); process.exit(2); }
}
if (!process.argv.includes('--skip-build') || !existsSync(DIST) || !existsSync(DIST_OFF)) {
  console.log('Building the site (as deployed)…');
  execFileSync('npx', ['astro', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('Building a second copy with no Firebase config (PUBLIC_NO_FIREBASE=1)…');
  execFileSync('npx', ['astro', 'build', '--outDir', DIST_OFF], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PUBLIC_NO_FIREBASE: '1' } });
}
const site = await serve(DIST), siteOff = await serve(DIST_OFF);
const browser = await chromium.launch();
const stamp = Date.now();
const allHosts = new Map(); const allReal = [];
const finish = (g, label) => { for (const [h, s] of g.hosts) allHosts.set(`${h} (${s}, ${label})`, s); allReal.push(...g.real); };

try {
  // ═════════ 1. Signed out, no Firebase config at all ═════════
  section('Signed out, built with no Firebase config');
  {
    const g = await guarded(browser);
    const page = await g.ctx.newPage();
    const BASE = siteOff.base;
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.setItem('pantry.anthropicKey', 'sk-ant-old'));
    await page.goto(`${BASE}/new/`, { waitUntil: 'networkidle' });
    check('an API key saved by the old site is wiped on load', await page.evaluate(() => localStorage.getItem('pantry.anthropicKey')) === null);
    const go = await page.locator('.newr__go').innerText();
    check('New page: AI says sign-in is not set up yet, no sign-in button', /sign-in is not set up yet/i.test(go) && await page.locator('.btn--google').count() === 0, go);
    await addToPantry(page, 'rice');
    await page.reload({ waitUntil: 'networkidle' });
    check('the pantry is kept on the device', (await tokens(page)).join() === 'rice');
    await page.goto(`${BASE}/account/`, { waitUntil: 'networkidle' });
    check('Account page: sign-in not set up, nothing about API keys', /Sign-in is not set up yet/i.test(await page.locator('body').innerText()) && !/api key|anthropic/i.test(await page.locator('body').innerText()));
    for (const p of ['/scan/', '/pantry/', '/products/', '/ingredients/', '/privacy/']) await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
    check('no test sign-in hook outside emulator mode', await page.evaluate(() => typeof window.__emuSignIn) === 'undefined');
    const sdk = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /firebase|firestore/i.test(n)));
    check('the Firebase SDK is never loaded', sdk.length === 0, sdk.join(' '));
    check('no request left this machine', [...g.hosts.keys()].every((h) => /^localhost:\d+$/.test(h)), [...g.hosts.keys()].join(', '));
    check('no page errors', g.errors.length === 0, g.errors.join(' || '));
    finish(g, 'signed-out build');
    await g.ctx.close();
  }

  // ═════════ 2. Emulator mode on the real build ═════════
  const BASE = site.base;
  // ignoreHTTPSErrors only matters for the two static Google helper hosts (some test machines sit behind a proxy with its own certificate).
  const g = await guarded(browser, { ignoreHTTPSErrors: true });
  const page = await g.ctx.newPage();

  section('Emulator mode: sign-in');
  const emailA = `pantry-e2e-${stamp}-a@example.com`;
  await page.goto(`${BASE}/new/?emulator`);
  await page.waitForFunction(() => typeof window.__emuSignIn === 'function', null, { timeout: 30000 });
  const googleBtn = page.locator('.newr__go .btn--google');
  await googleBtn.waitFor();
  await page.waitForFunction(() => !document.querySelector('.newr__go .btn--google')?.disabled, null, { timeout: 30000 });
  check('"Sign in with Google" becomes enabled once Firebase has loaded', /Sign in with Google/.test(await googleBtn.innerText()));
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 8000 }).catch(() => null), googleBtn.click()]);
  if (popup) {
    check('clicking it opens the sign-in window straight away (the Auth emulator\'s)', popup.url().startsWith('http://127.0.0.1:9099/'), popup.url());
    await popup.close();
    await page.waitForFunction(() => /Sign in with Google/.test(document.querySelector('.newr__go .btn--google')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
    check('closing the window shows no error', await page.locator('.newr__go .notice--red').count() === 0, await page.locator('.newr__go').innerText());
  } else {
    skip('the sign-in window opens from the click', 'Google\'s sign-in helper (apis.google.com) could not be loaded on this machine');
    await page.reload(); await page.waitForFunction(() => typeof window.__emuSignIn === 'function');
  }
  const uidA = await signIn(page, emailA);
  await page.locator('.newr__go .btn--primary').waitFor({ timeout: 15000 });
  check(`signed in as a made-up account (${emailA})`, !!uidA);

  section('Pantry sync');
  check('signing in alone creates no pantry document', await fsStatus(`pantry_users/${uidA}`) === 404);
  await addToPantry(page, 'eggs', 'spinach', 'garlic');
  await until(async () => await fsStatus(`pantry_users/${uidA}`) === 200);
  const doc = await fsJson(`pantry_users/${uidA}`);
  check('the pantry is saved to pantry_users/{uid} with a server timestamp', (doc.fields?.pantry?.arrayValue?.values ?? []).map((v) => v.stringValue).join() === 'eggs,spinach,garlic' && !!doc.fields?.updatedAt?.timestampValue, JSON.stringify(doc));
  check('nothing is written to the old users/{uid}', await fsStatus(`users/${uidA}`) === 404);
  await page.evaluate(() => localStorage.removeItem('pantry.items'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.ktoken').length === 3, null, { timeout: 15000 }).catch(() => {});
  check('after a reload (device copy removed) the pantry comes back from the account', (await tokens(page)).join() === 'eggs,spinach,garlic', (await tokens(page)).join());

  section('New recipe: generate, save, list, delete');
  const hint = () => page.locator('.newr__go .tools__hint').innerText();
  await page.locator('.newr__go .btn--primary').click();
  await page.locator('.gen__title').waitFor({ timeout: 30000 });
  check('a recipe is generated (the fake model\'s "Garlic Spinach Eggs")', (await page.locator('.gen__title').innerText()) === 'Garlic Spinach Eggs', await page.locator('.gen__title').innerText());
  const limit = Number((await hint()).match(/1 of (\d+) used today/)?.[1] ?? 0);
  check('usage is shown ("1 of N used today")', limit > 0, await hint());
  await page.getByRole('button', { name: 'Save to my recipes' }).click();
  await page.locator('.saved-list__item').waitFor({ timeout: 10000 });
  const recs = await fsJson(`pantry_users/${uidA}/recipes`);
  check('saved to pantry_users/{uid}/recipes', recs.documents?.length === 1 && recs.documents[0].fields.recipe.mapValue.fields.title.stringValue === 'Garlic Spinach Eggs');
  await page.reload();
  await page.locator('.saved-list__item').waitFor({ timeout: 15000 }).catch(() => {});
  check('listed under "My recipes" after a reload', /Garlic Spinach Eggs/.test(await page.locator('.newr__saved').innerText()));
  await page.locator('.saved-list__del').click();
  await page.waitForFunction(() => document.querySelectorAll('.saved-list__item').length === 0, null, { timeout: 10000 }).catch(() => {});
  check('deleting it removes it from the list and the database', await page.locator('.saved-list__item').count() === 0 && !((await fsJson(`pantry_users/${uidA}/recipes`)).documents?.length));

  section('Daily limit');
  for (let n = 2; n <= limit; n++) {
    await page.locator('.newr__go .btn--primary').click();
    await page.waitForFunction((k) => document.querySelector('.newr__go')?.textContent?.includes(`${k} used today`), `${n} of ${limit}`, { timeout: 30000 });
  }
  check(`${limit} requests in a day are accepted`, (await hint()).includes(`${limit} of ${limit} used today`), await hint());
  await page.locator('.newr__go .btn--primary').click();
  await page.locator('.newr__go .notice--red').waitFor({ timeout: 30000 }).catch(() => {});
  const limitMsg = await page.locator('.newr__go .notice--red').innerText().catch(() => '');
  check('the next one shows the daily-limit message, with no technical suffix', new RegExp(`^You have used all ${limit} AI requests for today\\. They reset at midnight UTC\\.$`).test(limitMsg), limitMsg);

  section('Delete my Pantry data: the only app this person uses');
  await page.goto(`${BASE}/account/`);
  await page.getByRole('button', { name: 'Delete my Pantry data' }).waitFor({ timeout: 15000 });
  check('Account page shows who is signed in', (await page.locator('.account__email').innerText()) === emailA);
  await page.getByRole('button', { name: 'Delete my Pantry data' }).click();
  await page.locator('.notice--green').waitFor({ timeout: 30000 }).catch(() => {});
  const msgA = await page.locator('.notice--green').innerText().catch(() => '');
  check('says the data was deleted and the sign-in removed', /Your Pantry data was deleted\..*sign-in was removed too/.test(msgA), msgA);
  check('signed out afterwards', await page.locator('.btn--google').count() === 1);
  check('pantry_users/{uid} and the Auth account are gone', await fsStatus(`pantry_users/${uidA}`) === 404 && !(await authUserExists(uidA)));
  check('the device copy is cleared too', await page.evaluate(() => localStorage.getItem('pantry.items')) === null);

  section('AI label check (second account)');
  const emailB = `pantry-e2e-${stamp}-b@example.com`;
  let sent = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('pantryCheckLabel')) sent.push(JSON.parse(r.postData()).data); });
  await page.goto(`${BASE}/scan/`);
  const uidB = await signIn(page, emailB);
  await page.getByText('or paste the ingredient text').click();
  await page.fill('textarea.scan__ocr', 'Ingredients: sugar, wheat flour, palm oil, sodium nitrite, salt');
  await page.getByRole('button', { name: 'Run AI check' }).click();
  await page.waitForFunction(() => /1 of \d+ free AI requests used today/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  check('pasted text: the AI check answers', /1 of \d+ free AI requests used today/.test(await page.locator('body').innerText()) && /AI confidence/.test(await page.locator('body').innerText()));
  check('pasted text: the request has no photo', sent.length === 1 && sent[0].image === null && Object.keys(sent[0]).sort().join() === 'flagged,image,kind,text', JSON.stringify(sent[0] ?? null).slice(0, 200));
  // a photo: a small JPEG drawn here. Reading text off it needs an OCR engine from a CDN, which this test blocks, so the label text is typed in.
  await page.goto(`${BASE}/scan/`);
  const jpeg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 320, 200); x.fillStyle = '#000'; x.font = '20px sans-serif'; x.fillText('Ingredients: sugar, salt', 10, 100); return c.toDataURL('image/jpeg', 0.8).split(',')[1]; });
  await page.locator('input[type=file]').last().setInputFiles({ name: 'label.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  await page.locator('textarea.scan__ocr').waitFor({ timeout: 60000 });
  await page.fill('textarea.scan__ocr', 'Ingredients: sugar, salt');
  sent = [];
  await page.getByRole('button', { name: 'Run AI check' }).click();
  await page.waitForFunction(() => /2 of \d+ free AI requests used today/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  check('photo: the AI check answers', /2 of \d+ free AI requests used today/.test(await page.locator('body').innerText()));
  check('photo: the request carries the picture as a base64 JPEG', sent.length === 1 && typeof sent[0].image === 'string' && sent[0].image.startsWith('/9j/'), JSON.stringify(sent[0] ?? null).slice(0, 120));

  section('Delete my Pantry data: the sign-in is kept because another app has data');
  const other = await fetch(`${FS}/whyb_users/${uidB}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: { book: { stringValue: '{}' }, settings: { stringValue: '{}' }, name: { stringValue: '' }, updatedAt: { timestampValue: new Date().toISOString() } } }) });
  check('(set-up) this person also has data in another app', other.status === 200);
  await page.goto(`${BASE}/new/`);
  await page.locator('.newr__go .btn--primary').waitFor({ timeout: 15000 });
  await addToPantry(page, 'eggs', 'rice');
  await until(async () => await fsStatus(`pantry_users/${uidB}`) === 200);
  await page.goto(`${BASE}/account/`);
  await page.getByRole('button', { name: 'Delete my Pantry data' }).click();
  await page.locator('.notice--green').waitFor({ timeout: 30000 }).catch(() => {});
  const msgB = await page.locator('.notice--green').innerText().catch(() => '');
  check('says the data was deleted and that they are still signed in', /Your Pantry data was deleted\. You are still signed in/.test(msgB), msgB);
  check('still signed in, Auth account kept', (await page.locator('.account__email').innerText().catch(() => '')) === emailB && await authUserExists(uidB));
  check('Pantry data gone, the other app\'s data untouched', await fsStatus(`pantry_users/${uidB}`) === 404 && await fsStatus(`whyb_users/${uidB}`) === 200);
  for (const p of ['/new/', '/pantry/', '/account/']) { await page.goto(`${BASE}${p}`); await sleep(1200); }
  check('browsing on while signed in does not recreate a pantry document', await fsStatus(`pantry_users/${uidB}`) === 404);
  await fetch(`${FS}/whyb_users/${uidB}`, { method: 'DELETE', headers: ADMIN }); // tidy up the set-up document

  section('Typo-tolerant search, one per search box');
  await page.goto(`${BASE}/ingredients/`);
  await hydrated(page);
  await page.fill('#ing-q', 'xantham gum'); await sleep(200);
  check('ingredients: "xantham gum" → Xanthan gum first', (await page.locator('.db-item__name').first().innerText().catch(() => '')) === 'Xanthan gum');
  await page.goto(`${BASE}/`);
  await hydrated(page);
  const cards = async (q) => { await page.fill('.library__search .tokenbox__input', q); await sleep(250); return page.locator('.card__title, .recipe-card__title, article h3, article h2').allInnerTexts(); };
  const right = await cards('chicken'), typo = await cards('chiken');
  check('library: "chiken" finds the chicken recipes', typo.length > 0 && typo.length === right.length && /chicken/i.test(typo.join(' ')), `${typo.length} vs ${right.length}`);
  await page.goto(`${BASE}/pantry/`);
  await hydrated(page);
  await page.locator('.tokenbox__input').click(); await page.locator('.tokenbox__input').pressSequentially('brocoli');
  await page.locator('.pantry__quick .choice', { hasText: '+ broccoli' }).waitFor({ timeout: 8000 }).catch(() => {});
  check('pantry box: typing "brocoli" offers "+ broccoli"', await page.locator('.pantry__quick .choice', { hasText: '+ broccoli' }).count() === 1);
  await page.keyboard.press('Enter');
  await page.locator('.choice--fix').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('pantry box: "brocoli" is kept as typed and "brocoli → broccoli" is offered', (await tokens(page)).includes('brocoli') && /brocoli\s*→\s*broccoli/.test(await page.locator('.choice--fix').first().innerText().catch(() => '')));
  await page.locator('.tokenbox__clear').click();
  await page.goto(`${BASE}/products/`);
  await hydrated(page);
  await page.fill('#prod-q', 'dorritos'); await sleep(500);
  check('products: "dorritos" finds Doritos', /^doritos/i.test(await page.locator('.brand-btn__name').first().innerText().catch(() => '')));
  await page.locator('.brand-btn').first().click();
  await page.locator('#prod-f').waitFor({ timeout: 15000 });
  await page.fill('#prod-f', 'nachoo chese'); await sleep(500);
  check('products: the filter inside a brand forgives "nachoo chese"', /nacho/i.test(await page.locator('main').innerText()) && !/No .*match/i.test(await page.locator('.db-meta').last().innerText().catch(() => '')));
  await page.goto(`${BASE}/scan/`);
  await hydrated(page);
  await page.getByText('or paste the ingredient text').click();
  await page.fill('textarea.scan__ocr', 'Ingredients: water, sodium citrate, tartrazlne, salt');
  await page.waitForFunction(() => /closest spelling/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  const rows = await page.locator('.ingr__row').allInnerTexts();
  check('label: "tartrazlne" is read as Tartrazine and says so; harmless "sodium citrate" is not flagged 0', rows.some((t) => /Tartrazine/.test(t) && /read from “tartrazlne” \(closest spelling\)/.test(t)) && !rows.some((t) => /sodium citrate/i.test(t) && /\b0\/100/.test(t)), rows.join(' ## '));

  section('Isolation from the real project');
  const keys = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  check('every browser storage key the site set starts with "pantry."', [...keys.local, ...keys.session].every((k) => k.startsWith('pantry.') || k.startsWith('firebase:')), JSON.stringify(keys));
  const pageErrors = g.errors.filter((e) => !/tesseract/.test(e)); // the photo test blocks the OCR engine's CDN on purpose
  check('no page errors', pageErrors.length === 0, pageErrors.join(' || '));
  finish(g, 'emulator mode');
  await g.ctx.close();
  check('not one request was aimed at the real Firebase project or Google\'s live APIs', allReal.length === 0, allReal.join(' '));
  const reached = [...allHosts.entries()].filter(([, s]) => s === 'allowed').map(([h]) => h);
  const blocked = [...allHosts.entries()].filter(([, s]) => s === 'blocked').map(([h]) => h);
  check('only this machine and Google\'s static sign-in helper files were reached', reached.every((h) => /^(localhost|127\.0\.0\.1):\d+ /.test(h) || SIGN_IN_HELPERS.some((s) => h.startsWith(s + ' '))));
  console.log(`\nHosts reached:  ${reached.join('; ') || 'none'}`);
  console.log(`Hosts blocked:  ${blocked.join('; ') || 'none'}`);
} finally {
  await browser.close();
  site.server.close(); siteOff.server.close();
}
console.log(`\n${passed} passed, ${failed} failed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
process.exit(failed ? 1 : 0);
