# Product and ingredient database pipeline

Builds the data behind the Products and Ingredients pages. The site does not run these scripts. It only reads their output:

| File | What it is |
|---|---|
| `public/data/brands.json` | brand index: name, key, product count, file, average score |
| `public/data/p/*.json` | 416,454 products grouped by brand, loaded one brand at a time |
| `public/data/flags.json` | every distinct flagged ingredient, referenced by the product files |
| `public/data/upc/*.json` | barcode to product file |
| `src/data/ingredient-db.json` | 552 ingredients with regulatory research and their scanner score |
| `src/data/product-stats.json` | counts shown on the pages |

## How it was built (November 2026)

1. `s5_build.py` and `s7_site_export.py` parse USDA FoodData Central branded food labels (newest label per barcode) plus 158 labels checked on brand and retailer pages, and collect the ingredient research (IARC, Prop 65, NTP, FDA, state laws, EU and EFSA).
2. `score_memo.ts` scores every product with **the site's own scanner** (`src/lib/label.ts`, food mode, evidence scoring), so a product's score here matches what the Scan page gives for the same label. It runs on a copy of `label.ts` whose matchers cache their results. The output is identical but runs about 8 times faster.
3. `fix.ts` re-scores labels the scanner could not read because the word "ingredients" appears inside the list. 84 are still unreadable and show as not scored.
4. `post.ts` writes the files above and gives each ingredient its scanner score.

## Re-scoring after a score change

Run `npm run build:products` (`data-pipeline/rescore.mjs`). It needs nothing outside this repo: every product shard keeps its label text, so the script re-runs the current scanner over all 416,454 labels (about two minutes) and rewrites the product shards, flags, brand averages, ingredient-page scores and stats. Run it after `npm run build:data` whenever scores or the matcher change, so Products, Ingredients and Scan agree. The original build scripts below (`score_memo.ts`, `fix.ts`, `post.ts`) are kept for reference; they used paths on the machine that first built the data.

Scores therefore follow the scanner's rule in `scripts/build-scores.py`: any cancer link scores 0. To change a score, edit that script and `src/data/additives.ts` as before, then rerun steps 2 to 4.

The scripts use absolute paths from the machine that built them, and need the raw USDA data, which is too large for this repo.
