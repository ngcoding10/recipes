# 🥬 The Pantry — my personal recipe library

A clean, fast, **static** recipe app. One user (me), no accounts, no backend,
no database. Every recipe is a plain Markdown file with YAML frontmatter, so
**adding a recipe = dropping a new `.md` file into `recipes/` and pushing.**
It deploys to GitHub Pages for free.

- **Live site:** https://nicorgutierrez08-eng.github.io/recipes/
- **Built with:** [Astro](https://astro.build) + React islands, Manrope, no CSS framework.

---

## What's on the site

| Page | What it does | Needs an API key? |
|---|---|---|
| **Library** (`/`) | All 91 recipes. Meal tabs (All / Breakfast / Lunch / Dinner / Snacks & desserts), keyword chips (type, Enter, ×), typo-tolerant search, filters for time, protein, tags, difficulty, cost and source level. Filter state lives in the URL. | No |
| **Recipe** (`/r0001-…/`) | Servings scaler, edit-any-amount proportional scaling, session-only tick boxes, storage, nutrition, substitutions, and collapsible *Source & accuracy notes* with provenance badges. | No |
| **Cook with what I have** (`/pantry/`) | Type the ingredients you have. The library is ranked by how many of them each recipe uses. "Make me a new recipe" asks Claude to write one from exactly those ingredients. | Only for the AI recipe |
| **Scan** (`/scan/`) | Photograph an ingredients label. The text is read on-device (Tesseract OCR, free), each ingredient is matched against a built-in additive database, and you get a 0–100 score with the worst ingredients explained. An optional AI pass judges the nutrition panel and whole foods. | Only for the AI pass |
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

- Label text → ingredient list (split on commas/parentheses) → each ingredient
  is matched against `src/data/additives.ts` (130 entries: E-numbers, aliases,
  concern level 0–3, a plain-English *why*, and the public classification it
  leans on: IARC group, EU/US bans, EFSA opinions, EU hyperactivity warning).
- Score starts at 100. High-concern additive −30 (and caps the score at 30),
  moderate −12 (caps at 72 / 55), limited −4, sugar first on the list −15,
  more than six additives −2 each. Bands mirror Yuka: 75+ Excellent, 50 Good,
  25 Poor, below that Bad.
- To add or change an entry, edit `src/data/additives.ts`. The scoring lives in
  `src/lib/label.ts`. It is informational, not medical advice.

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

The full schema (every optional field, including the two-layer
`sourceIngredients` / `workingIngredients` model) is in
[`src/content.config.ts`](src/content.config.ts). Unknown fields are ignored, so
declare new ones there first.

---

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
src/
  content.config.ts      ← recipe schema (validated at build)
  data/additives.ts      ← additive / ingredient database for Scan
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
