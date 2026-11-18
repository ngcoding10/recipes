# How ingredients are scored

Every ingredient in The Pantry gets one number from **0 to 100**. This page is the rulebook. The
audit script (`node scripts/audit-scores.mjs`) checks the data against it on every build.

## 1. The zero rule

**Any cancer link, of any strength, scores 0.** The site owner chose this strict rule on purpose.
A 0 means a link exists somewhere in the evidence. It does not mean the amount on a label causes
cancer.

There are two kinds of zero. Every 0 shows which kind it is and why.

| Kind | What qualifies |
|---|---|
| **Classified carcinogen** | IARC Group 1, 2A or 2B; the US NTP Report on Carcinogens; an EU CLP carcinogen class; or a ban made on cancer grounds (for example FDA's Delaney Clause revocation of Red 3). |
| **Cancer link (weaker evidence)** | A carcinogenic contaminant or breakdown product that comes from making the ingredient, at levels regulators limit; tumour findings for the ingredient in animal studies; or a cancer association in a human cohort study of the ingredient. |

### What counts and what does not

These boundaries keep the rule consistent instead of turning every food into a 0.

1. **The link must apply to the ingredient as it is normally used.** Beta-carotene raised lung
   cancer in smokers only at supplement doses of 20–30 mg a day, far above food-colour use, so
   beta-carotene as a colour is not zero. The same reasoning covers vitamin E (the SELECT trial
   used 400 IU a day) and folic acid (1 mg a day).
2. **When IARC evaluated the food itself, that verdict wins over its contaminants.** Coffee
   contains acrylamide from roasting, but IARC evaluated coffee drinking directly and found it
   not classifiable (Group 3), so coffee is not zero. Red meat and processed meat were evaluated
   directly too, and they are zero.
3. **Contaminants count when they come from making the ingredient.** Refined palm oil forms
   glycidyl esters during refining; caramel colour III and IV form 4-MEI; acid-hydrolysed protein
   forms 3-MCPD; smoke flavouring carries PAHs; ethoxylated ingredients can carry 1,4-dioxane.
   These are zero.
4. **Contaminants from the environment do not count.** Arsenic in rice, cadmium in cocoa,
   mercury in fish and aflatoxin in nuts depend on where the crop or animal came from, not on what
   the ingredient is. They are tested for and limited by regulators. Rice, cocoa, fish and nuts are
   scored on their own merits.
5. **Alcohol is zero wherever it is listed.** Ethanol in alcoholic beverages is Group 1. The rule
   applies to alcohol named on a label and to alcohol-based flavour extracts (vanilla extract is at
   least 35% ethanol by law), even though the amount per serving is small.
6. **General diet effects are not cancer links.** Sugar, salt, saturated fat and calories are
   scored in the 1–100 range, not zeroed.
7. **Whole herbs and spices are foods; their concentrated oils are not.** Basil, tarragon, fennel
   and nutmeg naturally contain small amounts of estragole, methyleugenol or safrole. In cooking
   amounts they are scored as foods (96). The essential oils concentrate those constituents and
   score 0, and so do the isolated constituents themselves.
8. **Anything made with a zero ingredient follows it.** Bleached flour follows benzoyl peroxide and
   chlorine; vanilla extract follows alcohol; smoked paprika, smoked cheese and chipotle follow the
   smoke that flavours them; beef broth follows red meat.
9. **IARC scope is respected.** IARC's pickled-vegetable classification covers traditional Asian
   pickles (kimchi, suan cai, zha cai), so those are zero and Western vinegar pickles are not; its
   salted-fish classification is specific to Chinese-style salted fish.

## 2. The 1–100 scale

Everything without a cancer link is scored on the rest of the evidence: hormone activity, gut
effects, allergy, heart and metabolic links, regulatory restrictions, and how well studied it is.

| Score | Band | Anchors |
|---|---|---|
| 90–100 | Low concern | Whole foods, water, vitamins at food levels, citric acid, pectin, lecithin |
| 75–89 | Low concern | Well-studied additives with minor caveats: xanthan and guar gum, modified starch, potassium sorbate, yeast extract |
| 50–74 | Limited concern | Refined oils and flour, MSG, sugar alcohols (laxative), natural flavour (undisclosed), propionates, coconut oil (saturated fat) |
| 25–49 | Moderate concern | Added sugar, phosphate additives, sulphites (asthma), artificial flavour, high-fructose corn syrup, aluminium salts |
| 1–24 | High concern | Trans fat, brominated vegetable oil, long-chain parabens, mercury, banned fragrance and UV-filter chemicals |

## 3. Consistency rules (checked automatically)

1. **One substance, one score.** Every spelling, language, E-number and product type gets the same
   number. Curated entries are the reference; the 27,000-row list adopts the curated score for any
   name or spelling that matches a curated entry exactly.
2. **One alias, one owner.** A name may belong to two curated entries only if both score the same.
3. **A combination scores as its worst part.** "Sodium benzoate and potassium sorbate" scores as
   sodium benzoate.
4. **A label segment containing two ingredients scores as the worse one.** "Hydrogenated palm
   kernel oil" scores as palm oil, not as hydrogenated fat.
5. **Every misspelling follows the word it misspells.**
6. **Tier labels always match the score band.**
7. **Similar evidence, similar score.** The groups in the extended list use the same numbers as the
   curated anchors, for example natural flavour 70 and added sugar 44.

## 4. Route-specific scores

A few substances also carry a separate **on-skin score**, used when a cosmetic label is scanned.
This applies only when the concern depends entirely on whether you eat it or put it on skin. The
audit lists them on every run.

| Substance | Eaten | On skin | Why they differ |
|---|---|---|---|
| Sugar, glucose, HFCS, sugar alcohols, maltodextrin | 28–64 | 90–92 | The concern is dietary (blood sugar, laxative effect) |
| Salt, phosphates, MSG | 40–78 | 85–95 | The concern is dietary intake |
| Coconut oil, seed oils, olive oil, shea and cocoa butter | 56–92 | 90–92 | Saturated fat only matters when eaten |
| Caffeine, whey, soy protein, added vitamins | 58–94 | 88–95 | Stimulant and nutrition effects are dietary |
| Sodium lauryl sulfate | 72 | 55 | Its concern is skin irritation |
| Zinc oxide | 93 | 88 | Nano forms in sprays can be inhaled |
| Milk, cream, butter, cheese, plant milks, plant proteins | 58–88 | 90–92 | Saturated fat and processing are dietary concerns |
| Green tea extract | 42 | 90 | Liver injury comes from swallowing concentrated catechins |
| Liquorice (glycyrrhizin) | 65 | 90 | Blood pressure effects come from eating it regularly |
| Aloe vera | 0 | 92 | The IARC 2B finding is for whole-leaf extract taken by mouth; skin products use decolourised gel |
| Vitamin A (retinol, retinyl palmitate) | 90 | 0 | The tumour finding came from skin application with sunlight |

## 5. Labels in other languages

The scanner reads ingredient lists in English, Spanish, French, Italian, German, Portuguese and
Dutch. Accents are ignored ("azúcar" = "azucar"), headings such as *Ingredientes* or *Zutaten* and
allergen lines such as *Puede contener* are recognised, and about 14,500 foreign ingredient names
are translated to the English names the database knows before scoring. Translations come from the
Open Food Facts taxonomies, and a foreign name is only used when its English counterpart is already
in the database, so a translation can never invent a score.

## 6. Sources

Ratings lean on IARC Monographs (through Volume 142, 2026), the NTP Report on Carcinogens, EFSA,
SCCS and FDA opinions, EU regulations, and Yuka's published change logs (shown separately, never
used to set a score). The extended ingredient list and its label spellings are derived from Open
Food Facts data, available under the Open Database License.

Scores are informational, not medical advice.
