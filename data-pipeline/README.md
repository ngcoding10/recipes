# Ingredient data pipeline

These Python scripts built the ingredient database behind the Ingredients, Products and Check a label pages. The site does not run them. It only reads what they export:

| File | What it is |
|---|---|
| `src/data/ingredients.json` | every scored ingredient (one page each) |
| `src/data/ingredients-lite.json` | id, name, score, type, for client-side lookups |
| `src/data/scoring.json` | the scoring rules and label parser patterns, so the site scores labels exactly like the pipeline |
| `public/data/brands.json` | brand index |
| `public/data/p/*.json` | products, grouped by brand, loaded on demand |
| `public/data/upc/*.json` | barcode to product file |

## Changing a score

Every score is one line in `rules.txt`: `name | type | score | pattern | evidence note`. To change one:

1. Edit the line in `rules.txt`.
2. Rerun `s5_build.py`, then `s7_site_export.py`.
3. Rebuild the site.

The scripts use absolute paths from the machine that built them (`/home/claude/...`) and need the raw USDA FoodData Central branded foods table and the Open Food Facts taxonomies, which are too large to keep in this repo. Update the paths at the top of each script if you rerun them.

## Checking the site scorer

`parity-test.ts` scores a sample of labels with the TypeScript scorer (`src/lib/scoring.ts`) and compares the result with the pipeline's. The last run matched on 40,154 of 40,158 labels.

```bash
node --experimental-strip-types data-pipeline/parity-test.ts sample.json
```

`sample.json` is an array of `[ingredient text, [expected flagged ingredient ids]]`.
