# 🥬 The Pantry

A recipe library you can cook from, a tool that writes new recipes from what you have, and a label
scanner that scores every ingredient. Static site on GitHub Pages; Google sign-in and the AI backend
run on Firebase when it is switched on.

- **Live site:** https://ngcoding10.github.io/recipes/ (also served at https://ascoding11.github.io/recipes/, same accounts; see [`docs/ASCODING.md`](docs/ASCODING.md))
- **Built with:** [Astro](https://astro.build) + React islands, Fraunces + Manrope, no CSS framework.
- **Switching on Google sign-in and free AI:** [`docs/SETUP-FIREBASE.md`](docs/SETUP-FIREBASE.md)
- **How ingredients are scored:** [`docs/SCORING.md`](docs/SCORING.md)

---

## What's on the site

| Page | What it does |
|---|---|
| **Library** (`/`) | All 91 recipes. Meal tabs, keyword chips, typo-tolerant search, filters for time, protein, tags, difficulty, cost and source level. Filter state lives in the URL. |
| **Recipe** (`/r0001-…/`) | Servings scaler, edit-any-amount scaling, session-only tick boxes, storage, nutrition, substitutions, an ingredient check, and *Source & accuracy notes* with provenance badges. |
| **Cook** (`/pantry/`) | Type what you have; the library is ranked by how many of those ingredients each recipe uses. |
| **New** (`/new/`) | Pick Breakfast, Lunch, Dinner, Snack or Dessert, servings, time and diet, and Claude writes a complete recipe from your ingredients. Optionally only what you listed, and away from anything this site scores 0. The result is checked against the ingredient database and can be saved, copied or printed. |
| **Scan** (`/scan/`) | Photograph a food, cosmetic or household label (or paste the text, in English, Spanish, French, Italian, German, Portuguese or Dutch). Text is read on-device, every ingredient is scored, and the worst are explained. Optional AI second opinion. |
| **Products** (`/products/`) | 416,454 US packaged foods by brand, product or barcode, each scored by the same scanner ([how the data was built](data-pipeline/README.md); re-score with `npm run build:products`). |
| **Ingredients** (`/ingredients/`) | 552 additives and questionable ingredients with score, regulatory status, sources and the brands that use them most. |
| **Account** (`/account/`) | Sign in with Google, light/dark/system theme, optional own API key, delete your data. |
| **Privacy** (`/privacy/`) | What is stored where. |

### Accounts and AI (who pays)

- **Signed out:** your pantry list and saved recipes stay in this browser. AI features work if you
  paste your own Anthropic API key on the Account page (stored only in the browser, sent only to
  api.anthropic.com).
- **Signed in with Google** (once Firebase is set up): the pantry and saved recipes sync through
  Firestore, and AI requests go to the site's Cloud Functions, which use the owner's key from
  Secret Manager with a per-account and site-wide daily limit. Firestore rules let each account
  read and write only its own data.
- Model: `claude-opus-5-5` with structured outputs (`src/lib/ai-shared.ts`, shared by browser and
  server). About 5–7 cents per recipe. **Never commit a key to this repo**; it is public.

| Folder | What |
|---|---|
| `src/config/firebase.ts` | Firebase web config (null = off) |
| `src/lib/ai.ts`, `ai-shared.ts` | AI client (own key or Cloud Function), prompts and schemas |
| `src/lib/firebase.ts`, `store.ts` | Lazy Firebase, sign-in, pantry and saved-recipe storage |
| `functions/` | Cloud Functions `generateRecipe`, `checkLabel` (`npm test` there) |
| `firestore.rules`, `firebase.json` | Database rules and deploy config |

### How the scan score works

**Every ingredient gets a score from 0 to 100.**

- **0 = any cancer link at all.** This is a deliberately strict rule. Two strengths, both score 0:
  - *Classified carcinogen*: IARC Group 1, 2A or 2B, the US NTP list, an EU carcinogen
    classification, or a ban made on cancer grounds (nitrites, processed and red meat, aspartame,
    BHA, titanium dioxide, Red 3, potassium bromate, caramel IV, alcohol, talc…).
  - *Cancer link (weaker evidence)*: a carcinogenic contaminant or breakdown product (palm oil →
    glycidyl esters, benzoates → benzene, ethoxylated ingredients → 1,4-dioxane, Red 40 / Yellow 5 /
    Yellow 6 → benzidine traces), tumour findings in animal studies (TBHQ, BHT, saccharin, Blue 1,
    CMC, polysorbate 80), or a cancer association in a human cohort study (mono- and
    diglycerides, acesulfame K, carrageenan in NutriNet-Santé).
  - General diet effects (sugar, fat, salt, calories) are not treated as cancer links.
  - A 0 means a link exists somewhere in the evidence, not that the amount on a label causes cancer.
- **1–100 = everything else**, judged on the remaining evidence: hormone activity, gut effects,
  allergy, heart and metabolic links, regulatory restrictions, how well studied it is.
  Bands: 1–24 high concern, 25–49 moderate, 50–74 limited, 75–100 low.

The full rulebook (what counts as a cancer link, the consistency rules, the few on-skin scores)
is in [`docs/SCORING.md`](docs/SCORING.md). After editing scores run `npm run build:data`; it
rebuilds both lists and runs the consistency audit, which fails on any contradiction. `npm test`
checks the label analyser against known labels.

**Two sources, both re-rated under that rule.**

- `src/data/additives.ts`: ~400 curated entries (additives, whole foods, cosmetic and household
  chemicals) with the evidence
  cited. Their scores live in `scripts/build-scores.py`, which writes `src/data/scores.ts` and
  fails if any entry is unscored. Each 0 carries its reason.
- `data/flagged_ingredients_rated.csv`: 27,288 label ingredients with real spellings and
  misspellings. `scripts/build-ingredients.py` re-rates every row (by evidence group, plus name
  keywords that catch cancer-linked substances inside combined names) and writes
  `public/data/ingredients.json` (~330 KB gzipped), loaded on first scan. Curated entries win;
  the list fills the rest. Rows with only a category-default rating are shown but not scored.
- `public/data/synonyms.json`: ~14,500 ingredient names in Spanish, French, Italian, German,
  Portuguese and Dutch mapped to English, so foreign labels score the same way
  (`npm run build:synonyms`).

Ingredient spellings and translations are derived from [Open Food Facts](https://world.openfoodfacts.org)
data, available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

**Product score.** Starts at 100. Each distinct ingredient subtracts: classified carcinogen −40,
cancer link −25, high −30, moderate −12, limited −4 (cosmetics −15 / −6). Sugar first on the list
−15, more than six additives −2 each. Then the worst ingredient sets a ceiling: classified
carcinogen → 20, cancer link → 45, high concern → 30, two moderates → 55, one → 72. Product bands
mirror Yuka: 75+ Excellent, 50 Good, 25 Poor, below that Bad. The scanner detects food, cosmetic
or household labels and only matches the right entries. **Yuka-style** mode additionally caps an
ingredient at Yuka's own published tier (red 15, orange 45, yellow 70).

---

## ➕ Add a new recipe

1. Create `recipes/r0123-short-name.md` (lowercase, dashes).
2. Paste the template below and fill it in. Only `id`, `title` and the
   ingredient `item` fields are required; delete any line you don't need.
3. Push. The build validates every file and stops with the exact field to fix if
   something is wrong.

```markdown
---
id: "R0123"
title: "Lemon Garlic Chicken Thighs"
description: "One-pan, 30 minutes, very garlicky."
servings: 4
totalTimeMin: 30
cuisine: "Mediterranean"
meal: "Dinner"
mealTags: ["dinner", "lunch"]          # breakfast | brunch | lunch | dinner | snack | dessert | side | appetizer | drink
protein: "Chicken"
proteinTags: ["chicken"]
difficulty: "Easy"                     # Easy | Medium | Hard
cost: "$$"                             # $ | $$ | $$$
tags: ["quick", "one-pan", "high-protein", "hot"]   # anything; low-calorie, cold, hot, meal-prep, air-fryer…
keywords: ["lemon", "garlic", "sheet pan"]
source: "https://www.instagram.com/reel/…/"
provenance: "Creator-stated"           # Creator-stated | Editorially completed | Culinary reconstruction
ingredients:
  - { amount: 800, unit: "g", us: "1 3/4 lb", item: "bone-in chicken thighs" }
  - { amount: 4, unit: "clove", item: "garlic, minced" }
  - { amount: 1, item: "lemon, juiced", note: "plus zest" }
  - { item: "salt and pepper", note: "to taste" }
workingInstructions:
  - "Heat the oven to 425°F (220°C)."
  - "Toss everything together on a sheet pan and roast 25–30 minutes until the thighs reach 165°F (74°C)."
storage: { fridge: "3 days", freezer: "2 months", reheat: "Oven 350°F until hot" }
workingNutrition: { calories: "~420", protein: "38 g", carbs: "4 g", fat: "28 g", basis: "per serving" }
---
```

**Pictures.** Every recipe has a 960×600 card image in `public/images/<slug>.jpg`
(`image: "/images/<slug>.jpg"` in the frontmatter). They are AI-generated from
the title and description with Pollinations' Flux model. To make one for a new
recipe, run `POLLINATIONS_TOKEN=<key> node scripts/gen-images.mjs` with a free
key from enter.pollinations.ai (only recipes without an image are generated;
`--force` redoes them all, `--only=slug1,slug2` picks specific ones). Without a
key it falls back to the weaker anonymous model. Drop in your own photo under
the same name any time to replace one.

The full schema (every optional field, including the two-layer
`sourceIngredients` / `workingIngredients` model) is in
[`src/content.config.ts`](src/content.config.ts). Unknown fields are ignored, so
declare new ones there first.

---

## 📲 Import recipes from Instagram

1. Collect the links. Fastest for a big backlog: Instagram → Settings →
   Accounts Center → Your information and permissions → Download your
   information → choose **Saved** → JSON. The export contains
   `saved_posts.json` with every saved post's URL. For a handful, Share →
   Copy link on each reel works too.
2. Put the URLs one per line in a text file and run
   `python3 scripts/ig-extract.py links.txt --out /somewhere/packets`
   (needs `pip install yt-dlp faster-whisper` and ffmpeg). For each link it
   saves the caption, a speech-to-text transcript of the audio, and a few
   video frames for on-screen text, as one JSON packet.
3. Those packets are what the recipe files get written from: caption first
   (creator-stated), transcript second, frames when the recipe is only shown
   on screen. Anything still missing is estimated and labelled as such.

## 👀 Preview locally

```bash
npm install        # once
npm run dev        # live preview at http://localhost:4321/recipes
npm run build      # production build + validates every recipe
```

---

## 🚀 Publish

Every push rebuilds and deploys through the **Actions** tab; the live site updates
a minute or two after the green ✓.

> The `github-pages` environment is locked to the
> `claude/recipe-library-site-y0b77e` branch, so that is the branch that
> publishes. To publish from `main` as well: **Settings → Environments →
> github-pages → Deployment branches** → "No restriction".

---

## 🗂 Project structure

```
recipes/                 ← your recipes (one .md each)
public/images/           ← card images, one per recipe (scripts/gen-images.mjs)
src/
  content.config.ts      ← recipe schema (validated at build)
  data/additives.ts      ← ~300-entry curated additive / cosmetic / contaminant database for Scan
data/flagged_ingredients_rated.csv ← 27k-row rated ingredient list (source for public/data/ingredients.json)
  lib/
    filters.ts           ← search, facets, meal tabs
    label.ts             ← OCR text → ingredients → score
    ai.ts                ← browser-side Anthropic client (BYO key)
    collection.ts        ← entry → RecipeData mapping
  components/
    RecipeLibrary.tsx    ← library island (search, tabs, filters)
    IngredientsPanel.tsx ← servings / proportional scaler
    Pantry.tsx           ← cook with what I have
    Scan.tsx             ← label scanner
    ApiKeyBox.tsx        ← key entry
  pages/                 ← index, [slug], pantry, scan, settings
  styles/                ← global (design tokens), library, recipe, tools
  layouts/Base.astro     ← app shell: header, mobile tab bar
.github/workflows/deploy.yml
```
