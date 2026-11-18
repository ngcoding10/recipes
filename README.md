# 🥬 The Pantry — my personal recipe library

A clean, fast, **static** recipe app. One user (me), no accounts, no backend,
no database. Every recipe is a plain Markdown file with YAML frontmatter, so
**adding a recipe = dropping a new `.md` file into `recipes/` and pushing.**
It deploys to GitHub Pages for free.

- **Live site:** https://nicorgutierrez08-eng.github.io/recipes/
- **Built with:** [Astro](https://astro.build) + React islands, Manrope, no CSS framework.

---


## Products and ingredient database

- **Products** (`/products/`): 416,454 US packaged foods. Search by brand, brand plus product, or barcode. Each product shows its full ingredient list and the same score the Scan page would give it, with a button to open it in Scan.
- **Ingredients** (`/ingredients/`): 552 food additives and questionable ingredients. Each has its scanner score plus regulatory status, sources, how many products use it, and which brands use it most.
- **Recipes**: every recipe page has an ingredient check, using the same database as Scan.

How the data was built is in [`data-pipeline/README.md`](data-pipeline/README.md).

## What's on the site

| Page | What it does | Needs an API key? |
|---|---|---|
| **Library** (`/`) | All 91 recipes. Meal tabs (All / Breakfast / Lunch / Dinner / Snacks & desserts), keyword chips (type, Enter, ×), typo-tolerant search, filters for time, protein, tags, difficulty, cost and source level. Filter state lives in the URL. | No |
| **Recipe** (`/r0001-…/`) | Servings scaler, edit-any-amount proportional scaling, session-only tick boxes, storage, nutrition, substitutions, and collapsible *Source & accuracy notes* with provenance badges. | No |
| **Cook with what I have** (`/pantry/`) | Type the ingredients you have. The library is ranked by how many of them each recipe uses. "Make me a new recipe" asks Claude to write one from exactly those ingredients. | Only for the AI recipe |
| **Scan** (`/scan/`) | Photograph a food, cosmetic or household ingredients label. The text is read on-device (Tesseract OCR, free), each ingredient is matched against a built-in database of ~300 additives, cosmetic ingredients and contaminants, and you get a 0–100 score with the worst ingredients explained, plus Yuka's own rating where known. An optional AI pass judges the nutrition panel and whole foods. | Only for the AI pass |
| **Settings** (`/settings/`) | Paste your Anthropic API key once. It is stored in your browser only. | — |

### About the API key (how the AI features are paid for)

- The site is static, so there is no server to hold a key. You create a key at
  **console.anthropic.com → API keys**, add a small prepaid credit (minimum $5),
  and paste it into **Settings**. It is saved in `localStorage` on that device
  and only ever sent to `api.anthropic.com`.
- **Claude Pro does not cover this.** Pro pays for claude.ai and Claude Code;
  API usage is separate pay-as-you-go billing. A recipe costs well under a cent,
  a photo scan roughly one to two cents.
- Anyone else opening the site gets the library as normal; the AI buttons show
  an "add your key" box instead. **Never commit a key to this repo** — it's public.

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
