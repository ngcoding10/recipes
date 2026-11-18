# Morning checklist: switch on Google sign-in and free AI

Everything is built and deployed. The site already works without this: pantry and saved recipes stay
on each device, and the AI features accept a personal API key on the Account page. These steps turn
on **Sign in with Google**, cloud-saved pantries and recipes, and AI that runs on **your** Anthropic
key with a daily limit per person.

Time: about 20 minutes. You need a computer with Node.js 20 or later.

## 1. Create the Firebase project (console, ~5 min)

1. Go to <https://console.firebase.google.com> → **Create a project**. Name it e.g. `the-pantry`.
   Google Analytics: off (the site has no analytics).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.** Pick your support
   email, Save.
3. Still in Authentication: **Settings → Authorized domains → Add domain** →
   `nicorgutierrez08-eng.github.io`. (`localhost` is already there for testing.)
4. **Build → Firestore Database → Create database** → *Start in production mode* → pick a location
   near you (e.g. `nam5` for the US). The rules in this repo replace the defaults in step 4.
5. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app called
   `The Pantry` (no Hosting). Copy the `firebaseConfig` object it shows.
6. **Upgrade to the Blaze plan** (bottom left, *Spark → Upgrade*). Cloud Functions and Secret Manager
   require it. Firebase itself will cost cents at this size; the real cost is the Anthropic API.
   Then in Google Cloud Billing set a **budget alert** (e.g. $10/month).

## 2. Paste the web config (1 min)

Open `src/config/firebase.ts` and replace `null` with the values you copied:

```ts
export const FIREBASE_CONFIG: FirebaseWebConfig | null = {
  apiKey: '…',
  authDomain: 'the-pantry.firebaseapp.com',
  projectId: 'the-pantry',
  appId: '1:…:web:…',
  storageBucket: 'the-pantry.firebasestorage.app',
  messagingSenderId: '…',
};
```

These are public identifiers, not secrets; it is normal for them to be in the repo.

## 3. Anthropic key (2 min)

1. <https://console.anthropic.com> → **Billing**: add credit (e.g. $10) and set a **monthly spend
   limit** under *Limits*. This is the hard ceiling on what strangers can cost you.
2. **API keys → Create key**. Keep the tab open for step 4.

## 4. Deploy the functions and database rules (~10 min)

From the repo folder:

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # choose the project, alias "default"

cd functions && npm install && npm test && cd ..

firebase functions:secrets:set ANTHROPIC_API_KEY   # paste the key; it goes to Secret Manager, never into the repo
firebase deploy --only firestore:rules,functions
```

The first deploy asks for two limits. Press Enter to accept the defaults or type your own:

| Setting | Default | Meaning |
|---|---|---|
| `DAILY_LIMIT_PER_USER` | 8 | AI requests (recipes + label checks) per Google account per UTC day |
| `DAILY_LIMIT_TOTAL` | 100 | AI requests for the whole site per day: your spending cap |

They are saved in `functions/.env.<project-id>`; change them there and redeploy.

## 5. Publish (1 min)

```bash
git add src/config/firebase.ts && git commit -m "Turn on Firebase" && git push
```

GitHub Actions rebuilds the site in about a minute. Open the site → **Account** (top-right icon) →
**Sign in with Google**. Then try **New** → pick a meal → **Create**.

## What it costs

The model is `claude-opus-5-5` ($4 per million input tokens, $20 per million output). A recipe is
roughly 3,000 tokens in and 2,000–3,000 out (including the model's thinking): **about 5–7 cents**.
A label check with a photo is about 3–5 cents. With the defaults, the site can spend at most about
**$6 a day**, and your Anthropic spend limit stops it entirely.

Cheaper option, your call: change `MODEL` in `src/lib/ai-shared.ts` to `claude-haiku-5-5`
($0.10 / $0.50 per million tokens, about 40× cheaper, slightly simpler recipes), then push and run
`firebase deploy --only functions`.

## If something goes wrong

| Symptom | Fix |
|---|---|
| "This website address is not on the Firebase Authorized domains list" | Step 1.3 |
| Sign-in popup flashes and closes on a phone | It falls back to a full-page redirect automatically; make sure third-party cookies are not blocked for `firebaseapp.com` |
| "The AI service is not deployed yet" | Step 4 did not finish; run `firebase deploy --only functions` again |
| "The site has run out of AI credit" | Top up at console.anthropic.com |
| "You have used all 8 AI requests for today" | Working as designed; resets at midnight UTC |
| Logs | `firebase functions:log` or Google Cloud console → Logging |

Optional hardening later: Firebase **App Check** (reCAPTCHA Enterprise) so only your site can call
the functions; then add `enforceAppCheck: true` to the options in `functions/src/index.ts`.
