# HANDOVER: The Pantry (`ngcoding10/recipes`)

Written for the merge chat that moves The Pantry, Where Have You Been and Movi into one new Firebase
project. Nothing in any backend project, key or rule was changed while writing this.

Secrets are listed by **name only**. Public Firebase web config values are in `src/config/firebase.ts`.

---

## 1. Branches, build, deploy

| Item | State |
|---|---|
| Live branch | `claude/recipe-library-site-y0b77e` (all current work). Last commit before this file: `600e966` |
| `main` | **Outdated** (stops at `239d823`, PR #1). Its last Pages deploy failed. Do not deploy from it without merging the live branch first. |
| `ingredient-database` | Old branch, already merged into `main` by PR #1. Safe to ignore. |
| Live site | https://ngcoding10.github.io/recipes/ (GitHub Pages, source = GitHub Actions) |
| ASCoding copy | https://ascoding11.github.io/recipes/: **not live**. The deploy workflow's `mirror-ascoding` job pushes the same build to `ASCoding11/recipes` (`gh-pages`) once the GitHub secret `ASCODING_DEPLOY_KEY` exists. The repo `ASCoding11/recipes` has not been created yet. Steps: `docs/ASCODING.md`. |
| ASCoding card | Branch `add-the-pantry` (commit `0ad7542`) in the fork `ngcoding10/ASCoding11.github.io`. **No PR opened yet.** It adds a Productivity card, a home-page listing, `the-pantry/preview.jpg` and a redirect page. |

**Build.** Astro 5 (static output) + React 19 islands, base path `/recipes`. `npm ci && npm run build` → `dist/`.
CI file: `.github/workflows/deploy.yml` (Node 20). It runs on push to `main` or the live branch and has three jobs: build,
deploy to Pages, and mirror to ASCoding (skipped while `ASCODING_DEPLOY_KEY` is missing).

**Content.** 91 recipes are Markdown files in `recipes/` (frontmatter schema in `src/content.config.ts`). Images live in
`public/images/` (800px) and `public/images/thumb/` (480px, made by `scripts/make-thumbs.mjs`).

**Static data (no backend).** These ship as files and are read in the browser:
- `public/data/ingredients.json` (27k rated ingredients) and `public/data/synonyms.json` (14.5k translations).
- `public/data/brands.json`, `flags.json`, `p/*.json` (416k products, about 165 MB) and `upc/*.json`.
- `src/data/ingredient-db.json` and `product-stats.json`.

Rebuild them with `npm run build:data`, `npm run build:synonyms` and `npm run build:products`.

**Half done / not deployed**
- Firebase project `the-pantry-8e315` (Spark plan):
  - Done: Google sign-in on; authorized domains `ngcoding10.github.io` and `ascoding11.github.io`; Firestore created (production mode, `(default)` database).
  - Web config committed in `600e966`, so the live site now shows sign-in.
  - Not done: `firestore.rules` has **not** been deployed, so the default deny-all rules are active and cloud saving fails today. The Cloud Functions are **not** deployed (that needs Blaze). The secret `ANTHROPIC_API_KEY` is **not** set.
- `.firebaserc` points the CLI at `the-pantry-8e315`.
- `npm run check:live` shows what is still missing.

## 2. Every place the front end talks to a backend

All Firebase access goes through two files. Firebase loads only when `FIREBASE_CONFIG` is not null, and then only through
dynamic `import()`.

| File | What | When |
|---|---|---|
| `src/config/firebase.ts` | `FIREBASE_CONFIG` (web config) and `FUNCTIONS_REGION = 'us-central1'` | build time |
| `src/lib/firebase.ts` | `loadFirebase()`: `initializeApp`, `getAuth` + `setPersistence(browserLocalPersistence)`, `initializeFirestore(..., { localCache: persistentLocalCache() })`, `getFunctions(app, 'us-central1')` | first use on a page |
| ″ | `onAccount(cb)`: `getRedirectResult` + `onAuthStateChanged`; shares the user across islands | every page (`HeaderAccount` in `src/layouts/Base.astro` uses `client:idle`, so **Firebase loads on every page** once configured) |
| ″ | `signInWithGoogle()`: `GoogleAuthProvider` with `prompt=select_account`, `signInWithPopup`; falls back to `signInWithRedirect` if the popup is blocked | Account page, AI buttons (`AiAccess`) |
| ″ | `signOutNow()` | Account page |
| ″ | `callFunction(name, data)`: `httpsCallable` with a 120 s timeout; turns error codes into readable messages | AI features when signed in |
| `src/lib/store.ts` | `setPantry(items, uid)`: writes localStorage now; if signed in, `setDoc(users/{uid}, {pantry, updatedAt})` after a 600 ms debounce (errors swallowed) | each pantry edit (Cook, New recipe) |
| ″ | `syncPantry(uid)`: `getDoc(users/{uid})`, merges (union) with the device list, writes back if different | once per uid per page, after sign-in (`src/lib/usePantry.ts`) |
| ″ | `listSaved(uid)`: `getDocs(users/{uid}/recipes orderBy createdAt desc limit 100)` | New recipe page, Account page |
| ″ | `saveRecipe(recipe, request, uid)`: `addDoc(users/{uid}/recipes, {recipe, request, createdAt})` | "Save" on a generated recipe |
| ″ | `deleteSaved(id, uid)`: `deleteDoc` | × on a saved recipe |
| ″ | `migrateLocalSaved(uid)`: uploads recipes saved on the device, then clears them | once per uid per page, after sign-in |
| ″ | `deleteAccountData(uid)`: deletes every `recipes` doc, then `users/{uid}` | Account → "Delete my data" |
| `src/lib/ai.ts` | `generateRecipe(req, signedIn)` / `checkLabel(req, image, signedIn)`: signed in → `callFunction('generateRecipe' \| 'checkLabel')`; else the visitor's own key → `api.anthropic.com` via `@anthropic-ai/sdk` with `dangerouslyAllowBrowser` | New recipe "Create", Scan "Run AI check" |
| `src/lib/ai-shared.ts` | Prompts, Zod v4 schemas, `MODEL = 'claude-opus-5-5'`, `EFFORT = 'medium'`; shared by the browser and the functions | n/a |

UI that uses these:
- `src/components/NewRecipe.tsx`
- `src/components/Scan.tsx`
- `src/components/Pantry.tsx`
- `src/components/AccountPanel.tsx`
- `src/components/HeaderAccount.tsx`
- `src/components/AiAccess.tsx`

Shared hooks: `src/lib/useAccount.ts` and `src/lib/usePantry.ts`.

## 3. Data model (Firestore). Rules: `firestore.rules`

| Path | Fields | Read | Write |
|---|---|---|---|
| `users/{uid}` | `pantry: string[]` (lower-cased, de-duplicated, ≤ 200), `updatedAt: timestamp` | owner | owner create/update with **only** `pantry` and `updatedAt`, `pantry` is a list of ≤ 200; owner delete |
| `users/{uid}/recipes/{autoId}` | `recipe: map` (GeneratedRecipe, below), `request: map \| null` (RecipeRequest, below), `createdAt: timestamp` | owner | owner create/update with **only** those 3 keys, `recipe` is a map, `recipe.title` is a string ≤ 200; owner delete |
| `usage/{YYYY-MM-DD}_{uid}` | `count: int`, `uid`, `day` | nobody (client) | Cloud Functions only (admin) |
| `usage/{YYYY-MM-DD}_total` | `count: int`, `day` | nobody | Cloud Functions only |
| everything else | n/a | denied | denied |

The two map types are defined as Zod schemas in `src/lib/ai-shared.ts`:
- **GeneratedRecipe**
  - Text: `title`, `description`, `meal` (`breakfast|lunch|dinner|snack|dessert`), `difficulty` (`Easy|Medium|Hard`).
  - Numbers: `servings`, `prepMin`, `cookMin`, `totalTimeMin`.
  - `ingredients[]`, each `{amount, unit, us, item, note, fromPantry}`.
  - `steps[]`, `tips[]`, `needsToBuy[]`.
  - `nutrition {calories, protein_g, carbs_g, fat_g, fiber_g}`.
- **RecipeRequest**: `ingredients[]`, `meal`, `servings`, `maxMinutes`, `diets[]`, `strict`, `avoidZero`, `note`.

There are no usernames, profiles, friends, follows or shared data. Each user sees only their own documents.

## 4. Server code (`functions/`, Firebase Functions v2, not deployed)

- **Logic:** `functions/src/handlers.ts`. **Wiring:** `functions/src/index.ts`.
- `functions/build.mjs` bundles them with `../src/lib/ai-shared.ts` and `../src/lib/zero-list.ts`, so `src/data/additives.ts` is included.
- Settings for both functions:
  - Region `us-central1`, timeout 120 s, 512 MiB, at most 5 instances.
  - CORS: `https://ngcoding10.github.io`, `https://ascoding11.github.io`, `http://localhost:*`, `http://127.0.0.1:*`.

| Callable | Input (`data`) | Output | Checks / limits |
|---|---|---|---|
| `generateRecipe` | RecipeRequest | `{ recipe: GeneratedRecipe, usage: {used, limit} }` | signed-in only; input cleaned (≤ 40 ingredients of ≤ 60 chars, servings 1–12, `maxMinutes` 0–240, ≤ 8 diets, note ≤ 300); prompt can list every food scored 0 (`avoidZero`) |
| `checkLabel` | `{ kind: food\|cosmetic\|household, text, hasImage, flagged: string[], image: base64 JPEG \| null }` | `{ result: LabelCheck, usage }` | signed-in only; `text` ≤ 6000, `image` ≤ 2.5 M base64 chars, `flagged` ≤ 40 × 120; score clamped to 0–100 |

**Limits.** The params `DAILY_LIMIT_PER_USER` (default 8) and `DAILY_LIMIT_TOTAL` (default 100) cap requests per UTC day.
A Firestore transaction on `usage/*` enforces them, and a failed model call refunds the count.

**Model call.** `client.messages.parse` with `claude-opus-5-5`, `output_config: { effort: 'medium', format: zodOutputFormat(...) }`
and `max_tokens` 6000. A refusal or unparsed output becomes a readable error. API 429/529/503 become `unavailable`, and a
billing error becomes `failed-precondition`.

**Secret names.** `ANTHROPIC_API_KEY` (Firebase Secret Manager), used by both functions. In CI: `ASCODING_DEPLOY_KEY`.

**Browser fallback.** The browser can call Anthropic directly with the visitor's own key (`pantry.anthropicKey`). No server
is involved in that path.

## 5. Sign-in

- **Method:** Google only, through Firebase Auth (popup, redirect fallback). There is no email/password and no anonymous sign-in.
- **Accounts:** no usernames. The UI shows `displayName`, `email` and `photoURL` from Firebase Auth.
- **Social:** no friends, follows or anything shared between users.
- **Signing in is optional.** Signed-out users keep everything in localStorage, and the AI works with their own key.

## 6. Real users today

- **Firestore:** effectively **zero data**. The rules were never deployed, so every client read and write has been denied.
- **Auth:** sign-in was switched on less than a day ago (`600e966`). At most a test account by Nico may exist. Check
  Firebase Console → Authentication → Users.
- **Nothing to migrate** from `the-pantry-8e315`.
- The only user data that exists sits in visitors' browsers (`pantry.items`, `pantry.savedRecipes`). The app already uploads it
  to the account on first sign-in (`migrateLocalSaved`, `syncPantry`). **Keep that behaviour** so it is not lost when the
  backend changes.

## 7. Browser storage keys

| Key | Store | What |
|---|---|---|
| `pantry.items` | localStorage | pantry list (string[]) |
| `pantry.savedRecipes` | localStorage | saved recipes while signed out (SavedRecipe[]) |
| `pantry.anthropicKey` | localStorage | visitor's own Anthropic key (optional) |
| `pantry.theme` | localStorage | `light` / `dark` (absent = follow device); read by an inline script in `Base.astro` before paint |
| `pantry.scanMode` | localStorage | `evidence` / `yuka` scoring mode on Scan |
| `pantry.scanText` | sessionStorage | label text handed from Products to Scan |
| Firebase SDK | IndexedDB | auth user (`firebase:authUser:<apiKey>:[DEFAULT]`) and the Firestore offline cache |

Recipe-page tick boxes and scaled amounts are deliberately **not** stored.

## 8. Tests

| Command | What |
|---|---|
| `npm test` | label analyser regression tests (12): matching, zero rule, on-skin scores, 6 languages |
| `cd functions && npm test` | function logic with a fake model and counter (7): validation, auth, limits, refunds |
| `npm run test:emulators` | needs Java, `firebase-tools` and `functions/.secret.local` with `ANTHROPIC_API_KEY=anything`. Runs the real functions + rules on the emulators (11): sign-in, owner-only access, extra-field rejection, private counters, limits, refunds |
| `npm run build:data` | rebuilds scores and runs the consistency audit (fails on conflicts) |
| `npm run check:live` | checks the live sites, Firebase settings, rules exposure and deployed functions from outside |
| `npm run build` | type-checks via Astro and builds |

## 9. Known bugs / about to fix

1. **Cloud saving is broken right now:** the rules are not deployed (see §1). `setPantry` swallows the error, while `saveRecipe` shows "Missing or insufficient permissions".
2. The AI on an account does not work until the functions are deployed. Without them, the UI falls back to "Sign in or add your own key".
3. Firebase loads on **every** page once configured, because the header avatar (`HeaderAccount`, `client:idle`) needs it. That is roughly 100 kB+ gzipped of auth and Firestore. Consider loading auth only, or reading a cached "signed in" flag first.
4. `persistentLocalCache()` uses the default single-tab manager. A second open tab may log a persistence warning and fall back to memory cache. Consider `persistentMultipleTabManager()`.
5. The `signInWithRedirect` fallback can fail on Safari and other browsers that partition storage, because `authDomain` (`*.firebaseapp.com`) is a different site from `*.github.io`. The popup (default) works.
6. `public/robots.txt` is served at `/recipes/robots.txt`, which crawlers ignore. The sitemap is still listed there.
7. `data-pipeline/fix.ts`, `post.ts` and `score_memo.ts` import a missing `./label_memo` and are excluded from `tsconfig`. `data-pipeline/rescore.mjs` replaces them.
8. Pending, not started: importing recipes from Nico's Instagram saved-posts export (`scripts/ig-extract.py` exists).
9. ASCoding hosting (§1) and the ASCoding card PR are waiting on Arjun and Nico.

## 10. Questions from the merge request

**What would break if every collection were renamed with an app prefix (`pantry_`)?** Nothing, as long as these places
change together:
- `src/lib/store.ts`: `'users'` and the `'recipes'` subcollection
- `functions/src/index.ts`: the `usage/...` paths
- `firestore.rules`
- `scripts/emulator-test.mjs`

There is no data to migrate. localStorage keys are already prefixed (`pantry.`).

Also rename the **callable names** if the shared project has other functions, e.g. `pantryGenerateRecipe` and
`pantryCheckLabel`. Update `src/lib/ai.ts` (`callFunction(...)`) and `functions/src/index.ts` to match.

A good layout for the merge: `pantry_users/{uid}` (pantry), `pantry_users/{uid}/recipes/{id}` and `pantry_usage/{day}_{uid|total}`.

**Can the app use one shared account record (uid, username, display name, photo)?** Yes, easily. The Pantry has no
profile of its own. It reads `displayName`, `email` and `photoURL` from Firebase Auth (`toAccount` in
`src/lib/firebase.ts`) and never writes a profile.

It would read the shared record for display and ignore `username`. Its own data stays keyed by the same `uid`. The only
requirements are Google sign-in in the shared project, and an `account.uid` that is the Firebase Auth uid (it already is).

**Movi-only questions:** not applicable to The Pantry.

## 11. Things the merge must keep

- **Every Firebase / AI path is optional.** With `FIREBASE_CONFIG = null` and no key, the site must still fully work. Only the AI features may be missing.
- **The model call stays server-side for signed-in users.** The visitor's own-key path stays browser-only.
- **The daily limits and the refund-on-failure behaviour.**
- **The AI-check prompt scores 0 for any cancer link,** matching `docs/SCORING.md`. The shared zero list comes from `src/lib/zero-list.ts`.
- **Allowed origins** (CORS) and **authorized domains** must cover both `ngcoding10.github.io` and `ascoding11.github.io`, plus any new home.
