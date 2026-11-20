// Checks that everything online is set up: both website addresses, the Firebase project
// (sign-in, authorized domains, database, rules) and the Cloud Functions.
//
//   npm run check:live                     uses src/config/firebase.ts
//   node scripts/check-live.mjs cfg.json   uses a pasted firebaseConfig instead
//
// It only reads public endpoints and never signs in, so a few things (your Anthropic key's
// credit, billing alerts, GitHub secrets) can only be confirmed in their dashboards; those are
// listed at the end.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITES = { main: 'https://ngcoding10.github.io/recipes/', ascoding: 'https://ascoding11.github.io/recipes/' };
const ORIGINS = ['https://ngcoding10.github.io', 'https://ascoding11.github.io'];
const REGION = 'us-central1';

let fails = 0, warns = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m, fix) => { fails++; console.log(`  ✗ ${m}${fix ? `\n      → ${fix}` : ''}`); };
const warn = (m, fix) => { warns++; console.log(`  ! ${m}${fix ? `\n      → ${fix}` : ''}`); };
const get = async (url, opts = {}) => { try { const r = await fetch(url, { redirect: 'follow', ...opts }); return { status: r.status, headers: r.headers, text: await r.text() }; } catch (e) { return { status: 0, text: String(e.message) }; } };

// ---------------------------------------------------------------------------------------------
let config = null;
if (process.argv[2]) config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
else {
  const tmp = mkdtempSync(join(tmpdir(), 'cfg-'));
  execFileSync('npx', ['esbuild', 'src/config/firebase.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${tmp}/c.mjs`, '--log-level=error'], { cwd: ROOT });
  config = (await import(`${tmp}/c.mjs`)).FIREBASE_CONFIG;
}

console.log('\nWebsites');
const pages = {};
for (const [k, url] of Object.entries(SITES)) {
  const r = await get(url);
  pages[k] = r;
  if (r.status === 200) ok(`${url} is live`);
  else if (k === 'ascoding') bad(`${url} returns ${r.status}`, 'finish docs/ASCODING.md: deploy key secret + ASCoding11/recipes repo, then Actions → Run workflow, then Pages → gh-pages');
  else bad(`${url} returns ${r.status}`, 'check the latest run in the Actions tab');
}
const build = (t) => (t?.match(/\/_astro\/[\w.-]+\.(?:css|js)/g) ?? []).sort().join(',');
if (pages.main?.status === 200 && pages.ascoding?.status === 200) {
  if (build(pages.main.text) === build(pages.ascoding.text)) ok('both addresses serve the same build');
  else warn('the two addresses serve different builds', 'a deploy is probably still running; check again in a few minutes');
}
const acct = await get(SITES.main + 'account/');
if (acct.status === 200 && /not switched on/i.test(acct.text)) bad('the live site was built without a Firebase config (sign-in hidden)', 'paste firebaseConfig into src/config/firebase.ts, commit and push');
else if (acct.status === 200) ok('the live site was built with sign-in switched on');

console.log('\nFirebase project');
if (!config) {
  bad('src/config/firebase.ts is still null', 'Firebase console → Project settings → Your apps → Web app → copy the config into src/config/firebase.ts (docs/SETUP-FIREBASE.md step 2)');
} else {
  ok(`config found for project "${config.projectId}"`);
  // Sign-in settings (public: the same call the Firebase SDK makes)
  const pc = await get(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(config.apiKey)}`);
  if (pc.status !== 200) bad(`could not read sign-in settings (${pc.status}): ${pc.text.slice(0, 160)}`, 'check apiKey in src/config/firebase.ts; Authentication must be "Get started" in the console');
  else {
    const p = JSON.parse(pc.text);
    const domains = p.authorizedDomains ?? [];
    for (const d of ['ngcoding10.github.io', 'ascoding11.github.io']) {
      if (domains.includes(d)) ok(`authorized domain: ${d}`);
      else bad(`authorized domain missing: ${d}`, 'Authentication → Settings → Authorized domains → Add domain');
    }
  }
  // Google provider: asking for a Google sign-in URL only works when the provider is enabled.
  const g = await get(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(config.apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ providerId: 'google.com', continueUri: SITES.main }),
  });
  if (g.status === 200 && /authUri/.test(g.text)) ok('Google sign-in provider is enabled');
  else bad('Google sign-in provider is not enabled', 'Authentication → Sign-in method → Google → Enable');
  // Database + rules
  const fs = await get(`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/users/check-live`);
  if (fs.status === 403 && /insufficient permissions/i.test(fs.text)) ok('Firestore exists and refuses signed-out reads (rules are not open)');
  else if (/does not exist/i.test(fs.text)) bad('Firestore database has not been created', 'Build → Firestore Database → Create database (production mode)');
  else if (fs.status === 404 || fs.status === 200) bad('Firestore rules let anyone read user data (test mode?)', 'run: firebase deploy --only firestore:rules');
  else if (fs.status === 403) bad('Firestore is not set up for this project', 'Build → Firestore Database → Create database (production mode)');
  else warn(`unexpected Firestore answer ${fs.status}: ${fs.text.slice(0, 120)}`);

  // Cloud Functions: a signed-out call must be refused by OUR code (proves deployed, running, secret attached)
  for (const fn of ['generateRecipe', 'checkLabel']) {
    const url = `https://${REGION}-${config.projectId}.cloudfunctions.net/${fn}`;
    const r = await get(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGINS[0] }, body: JSON.stringify({ data: {} }) });
    let status = '';
    try { status = JSON.parse(r.text)?.error?.status ?? ''; } catch { /* not JSON */ }
    if (['UNAUTHENTICATED', 'INVALID_ARGUMENT'].includes(status)) ok(`function ${fn} is deployed and answering`);
    else if (r.status === 404) bad(`function ${fn} is not deployed`, 'firebase functions:secrets:set ANTHROPIC_API_KEY, then firebase deploy --only firestore:rules,functions');
    else if (r.status === 403) bad(`function ${fn} refuses public calls (403)`, 'redeploy with: firebase deploy --only functions (callable functions must allow public invocation)');
    else warn(`function ${fn} answered ${r.status}: ${r.text.slice(0, 120)}`);
    // Both website addresses must be allowed to call it
    for (const origin of ORIGINS) {
      const pre = await get(url, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' } });
      const allow = pre.headers?.get?.('access-control-allow-origin');
      if (allow === origin || allow === '*') ok(`  ${fn} accepts requests from ${origin}`);
      else if (r.status !== 404) bad(`  ${fn} does not accept requests from ${origin}`, 'firebase deploy --only functions (the current code allows both addresses)');
    }
  }
}

console.log('\nOnly checkable in a dashboard');
for (const m of [
  'console.anthropic.com → Billing: credit added, and Limits: a monthly spend limit set',
  'console.cloud.google.com → Billing → Budgets & alerts: a budget alert on the Firebase project',
  'github.com/ngcoding10/recipes → Settings → Secrets → Actions: ASCODING_DEPLOY_KEY exists (if the ASCoding address above is live, it does)',
  'ASCoding11/recipes → Settings → Pages: source is the gh-pages branch',
  'Pull request adding The Pantry card to ASCoding merged by Arjun',
]) console.log(`  · ${m}`);

console.log(`\n${fails ? `${fails} thing(s) to fix` : 'Everything checkable is set up'}${warns ? `, ${warns} warning(s)` : ''}.\n`);
process.exitCode = fails ? 1 : 0;
