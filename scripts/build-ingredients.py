#!/usr/bin/env python3
"""
Compact data/flagged_ingredients_rated.csv (27k rated ingredients) into
public/data/ingredients.json for the label scanner.

    python3 scripts/build-ingredients.py

Output shape (kept small; the scanner lazy-loads it on first scan):
  { "cats": [...], "notes": [...], "tiers": [...],
    "rows": [[name, score, tierIdx, catIdx, noteIdx, specific(0|1), eNumber, [spellings...], carc(0|1|2)], ...] }

Scores are RE-RATED here, not copied from the CSV. Rule (set by the site owner, strict):
  0      = any cancer link: carc 1 "classified" (IARC 1/2A/2B, NTP, cancer-based ban) or
           carc 2 "linked" (carcinogenic contaminant/by-product, animal tumour findings,
           or a cancer association in a human cohort study)
  1..100 = everything else, by evidence group (NOTE_RULES) with name keywords (ZERO_KEYWORDS)
           catching cancer-linked substances inside combined or default-rated names.
"""
import collections, csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'flagged_ingredients_rated.csv'
OUT = ROOT / 'public' / 'data' / 'ingredients.json'

def norm(s: str) -> str:
    s = s.lower().replace('â', '').replace(' ', ' ')
    s = re.sub(r'[^a-z0-9&/\-\s]', ' ', s)   # drop +, *, °, punctuation noise
    s = re.sub(r'\s+', ' ', s).strip(' -')
    return s


C, L = 1, 2
# (substring of the CSV's evidence note, new score or (level, why)). Longest matching key wins.
NOTE_RULES = [
    ('Processed meat', (C, 'Processed meat: IARC Group 1 (colorectal cancer)')),
    ('FDA revoked authorization Jan 2025', (C, 'Red 3: thyroid tumours in rats; FDA revoked it under the Delaney Clause (2025)')),
    ('IARC Group 2B (inhalation)', (C, 'Titanium dioxide: IARC Group 2B (inhaled); EFSA could not rule out genotoxicity')),
    ('BHA:', (C, 'BHA: IARC Group 2B; NTP "reasonably anticipated to be a human carcinogen"')),
    ('Ingested nitrate/nitrite', (C, 'Nitrite/nitrate: IARC Group 2A under nitrosation conditions')),
    ('Potassium bromate', (C, 'Potassium bromate: IARC Group 2B')),
    ('IARC Group 2B (2023', (C, 'Aspartame: IARC Group 2B (2023)')),
    ('Class III/IV caramel', (C, 'Class III/IV caramel contains 4-methylimidazole (IARC Group 2B)')),
    ('Ethanol in alcoholic', (C, 'Alcoholic beverages: IARC Group 1 (trace carrier amounts are far smaller)')),
    ('Ginkgo', (C, 'Ginkgo biloba extract: IARC Group 2B')),
    ('Talc:', (C, 'Talc: IARC Group 2A (2024)')),
    ('EU decided in 2024 not to renew smoke', (C, 'Smoke flavouring: EFSA could not rule out genotoxicity; EU phase-out')),
    ('Banned in US food since 1970', (C, 'Cyclamate: banned in the US since 1970 after bladder tumours in rats (IARC Group 3)')),
    ('Breaks down to semicarbazide', (L, 'Azodicarbonamide forms semicarbazide and urethane (IARC 2A) when baked')),
    ('Class not stated on label', (L, 'Caramel colour, class not stated: classes III and IV contain 4-MEI (IARC 2B)')),
    ('Vegetable nitrate source', (L, 'Natural nitrite source: same nitrosamine chemistry as added nitrite when used for curing')),
    ('TBHQ', (L, 'TBHQ: tumour findings in some rodent studies at high dose; NTP and EFSA concluded not carcinogenic')),
    ('Synthetic azo dye', (L, 'Azo dye: may contain trace benzidine-type contaminants (known carcinogens); the dye itself is not classified')),
    ('BHT', (L, 'BHT: tumour promotion in some animal studies; IARC Group 3')),
    ('Possible endocrine activity; limited data', (L, 'Propyl gallate: suggestive tumour increases in an NTP rat study; not classified')),
    ('Mineral oil hydrocarbons', (L, 'Mineral oil: aromatic fraction (MOAH) may be genotoxic (EFSA 2023)')),
    ('Synthetic dye; not authorized in EU', (L, 'Green 3: bladder and testis tumour signal in male rats; FDA judged it not conclusive')),
    ('Unspecified synthetic color', (L, 'Unspecified synthetic colour: assumed to be an FD&C dye (contaminant or rodent tumour signals)')),
    ('Synthetic dye; FDA phase-out', (L, 'Blue 1 / Blue 2: tumour signals in single rodent studies; regulators judged them not conclusive')),
    ('Gut barrier and microbiome disruption', (L, 'Polysorbate: promoted colon tumours in a mouse study (2017); ethoxylated, may carry 1,4-dioxane (IARC 2B)')),
    ('WHO 2023 guideline advises against', (L, 'Sucralose: impurity sucralose-6-acetate genotoxic in vitro (2023); leukaemia signal in one mouse study')),
    ('WHO 2023 non-sugar sweetener guideline; cohort', (L, 'Acesulfame K: cancer association in the NutriNet-Santé cohort (2022); observational')),
    ('IARC Group 3 (delisted)', (L, 'Saccharin: bladder tumours in rats; mechanism judged not relevant to humans, delisted 2000')),
    ('Can form benzene', (L, 'Benzoate can form benzene (IARC Group 1) with vitamin C in drinks')),
    ('Food-grade is IARC Group 3', (L, 'Carrageenan: degraded form is IARC 2B; breast-cancer association in NutriNet-Santé (2024)')),
    ('Altered gut microbiota in a controlled', (L, 'Cellulose gum (CMC): promoted colon tumours in a mouse study (2017)')),
    ('High saturated fat; refining contaminants', (L, 'Palm oil: refining forms glycidyl esters (glycidol is IARC 2A), highest in palm oil')),
    ('Acid-hydrolyzed proteins', (L, 'Acid-hydrolysed protein can contain 3-MCPD (IARC Group 2B)')),
    ('May carry trace trans fat; observational association with cancer', (L, 'Mono- and diglycerides: cancer association in the NutriNet-Santé cohort (2024); may carry glycidyl esters')),
    ('Synthetic polymer or pigment carrier', (L, 'Pearlescent pigments are usually coated with titanium dioxide (IARC 2B)')),
    ('Artificial trans fat', 3), ('Brominated vegetable oil', 5), ('Propylparaben', 14),
    ('Stimulant; cardiovascular adverse', 10), ('Stimulant; cardiovascular concerns', 18),
    ('Triggers reactions in sulfite', 46), ('FDA: not lawful', 30), ('Supplement active with liver', 25),
    ('GI effects; reduces absorption', 30), ('Fully hydrogenated fat', 36), ('Aluminum intake', 36),
    ('Added sugar; high intake linked', 28), ('Cola-type phosphate', 34), ('Processed fat blend', 30),
    ('Lung hazard when inhaled', 54), ('Limited to tonic levels', 42), ('Undisclosed mix of synthetic polymers', 32),
    ('Aspartame-derived sweetener', 48), ('Phosphate additive', 40), ('default score for the color', 60),
    ('Added sugar', 42), ('Chemically bleached flour', 42), ('default score for the high-intensity', 45),
    ('Observational link to cardiovascular events (Nature', 52), ('Added sugar; dose-dependent', 44),
    ('default score for the added sugar', 46), ('Undisclosed synthetic flavor', 48),
    ('Synthetic emulsifier or solvent', 58), ('High glycemic refined', 44), ('Regulators consider it safe; EFSA 2017', 60),
    ('Allergic reactions including anaphylaxis', 58), ('Liver injury case reports', 42), ('Caffeine source or glycyrrhizin', 52),
    ('Restructured fat', 46), ('Observational link to cardiovascular events (2024)', 58), ('Novel fat replacer', 45),
    ('Added sugar from a less refined', 52), ('default score for the preservative', 55), ('default score for the emulsifier', 58),
    ('Chelating preservative', 58), ('Sugar alcohol; laxative', 62), ('Dose-dependent stimulant', 58),
    ('Synthetic emulsifier; EFSA 2017 raised', 62), ('default score for the sugar alcohol', 60), ('Synthetic anti-foaming', 58),
    ('Animal fat high in saturated', 50), ('default score for the other additive', 55), ('default score for the flavor category', 60),
    ('default score for the oil / fat', 58), ('Refined oil; nutritional', 60), ('default score for the flavor enhancer', 62),
    ('High saturated fat', 56), ('Undisclosed composition; may include', 68), ('default score for the processing aid', 62),
    ('Refined grain', 62), ('default score for the refined', 62), ('Chemically or physically modified starch', 72),
    ('Anti-caking agent; EFSA noted', 66), ('Cellulose derivative', 74), ('Energy-drink active', 62),
    ('Natural source of free glutamate', 78), ('default score for the stimulant', 66), ('default score for the starch', 70),
    ('Preservative with low toxicity', 80), ('Natural color; occasional allergic', 72), ('Insect-derived glaze', 74),
    ('Low-calorie carbohydrate', 72), ('Highly processed protein', 72), ('Refined oil with a more stable', 72),
    ('default score for the thickener', 78), ('default score for the fiber', 80), ('Fermentation or plant gum', 86),
    ('Plant-derived sweetener; JECFA', 82), ('default score for the extract', 80), ('default score for the acid', 84),
    ('Low concern; saturated fat', 78), ('Plant-derived sweetener; limited data', 82), ('Humectant; low concern', 86),
    ('Fiber; low concern', 86), ('default score for the protein', 86), ('Plant-derived color', 92),
    ('default score for the vitamin', 90), ('Vitamin or mineral fortificant', 93), ('Low concern', 'KEEP'),
]
NOTE_RULES.sort(key=lambda kv: -len(kv[0]))

DYE = (L, 'Synthetic FD&C dye: trace benzidine-type contaminants (Red 40, Yellow 5, Yellow 6) or tumour signals in rodent studies (Blue 1, Blue 2, Green 3)')
# (regex on the lower-cased name, exclusion regex or None, (level, why)). First match wins.
ZERO_KEYWORDS = [
    (r'\b(sodium|potassium) nitr(ite|ate)\b|\bnitrites?\b', r'except|naturally', (C, 'Nitrite/nitrate: IARC Group 2A under nitrosation conditions')),
    (r'\bbha\b|butylated hydroxyanisole', None, (C, 'BHA: IARC Group 2B; NTP "reasonably anticipated to be a human carcinogen"')),
    (r'aspartame', None, (C, 'Aspartame: IARC Group 2B (2023)')),
    (r'titanium dioxide', None, (C, 'Titanium dioxide: IARC Group 2B (inhaled); EFSA could not rule out genotoxicity')),
    (r'\bred (no\.? ?|#)?3\b|erythrosine', None, (C, 'Red 3: thyroid tumours in rats; FDA revoked it under the Delaney Clause (2025)')),
    (r'bromate', r'un-? ?bromate|non-? ?bromate|never bromate|not bromate', (C, 'Potassium bromate: IARC Group 2B')),
    (r'\b(bacon|ham|salami|pepperoni|sausages?|hot dogs?|frankfurters?|chorizo|prosciutto|pancetta|jerky|corned beef|pastrami|bologna|mortadella)\b', r'flavo|type|seasoning|style|fresh ham|\bfat\b|gluten|vegan|veggie|vegetarian|plant|meatless|\bsoy|tofu|imitation', (C, 'Processed meat: IARC Group 1 (colorectal cancer)')),
    (r'\b(beef|pork|lamb|veal|mutton|venison|bison)\b', r'fat|tallow|lard|flavo|broth|stock|gelatin|collagen|extract|bouillon|base|casing|plasma|protein|powder|seasoning|type|bone|rennet|shortening|concentrate|demi|sugar', (C, 'Red meat: IARC Group 2A')),
    (r'\b(wine|beer|rum|whiskey|whisky|bourbon|brandy|vodka|liqueur|sherry|tequila|cognac|champagne|sake|marsala|kirsch|amaretto)( alcohol)?$', r'vinegar|root beer|ginger beer|flavo|non-?alcoholic|dealcoholi|alcohol-free|vanilla|chocolate|cocoa', (C, 'Alcoholic beverages: IARC Group 1 (cooking and trace amounts are far smaller)')),
    (r'\btalc\b', None, (C, 'Talc: IARC Group 2A (2024)')),
    (r'cyclamate', None, (C, 'Cyclamate: banned in the US since 1970 after bladder tumours in rats (IARC Group 3)')),
    (r'\bsmoke\b', r'smoke point|no smoke|smoke-free|tasteless smoke', (C, 'Smoke / smoke flavouring: EFSA could not rule out genotoxicity (2023); smoke carries PAHs')),
    (r'ginkgo', None, (C, 'Ginkgo biloba extract: IARC Group 2B')),
    (r'\baloe\b', r'flavo', (L, 'Aloe vera: whole-leaf extract is IARC Group 2B (purified inner gel is not classified)')),
    (r'\bkava\b', None, (C, 'Kava extract: IARC Group 2B')),
    (r'goldenseal', None, (C, 'Goldenseal root powder: IARC Group 2B')),
    (r'caramel colou?r|\be150[cd]\b', None, (L, 'Caramel colour: classes III and IV contain 4-MEI (IARC 2B)')),
    (r'celery (juice )?(powder|extract|concentrate)|cultured celery|celery juice|(nitrites?|nitrates?).*(except|naturally)|except (for )?(those|that) naturally|naturally occurr?ing in (celery|sea salt)', None, (L, 'Natural nitrite source: same nitrosamine chemistry as added nitrite when used for curing')),
    (r'\btbhq\b', None, (L, 'TBHQ: tumour findings in some rodent studies at high dose; NTP and EFSA concluded not carcinogenic')),
    (r'\bbht\b|butylated hydroxytoluene', None, (L, 'BHT: tumour promotion in some animal studies; IARC Group 3')),
    (r'propyl gallate', None, (L, 'Propyl gallate: suggestive tumour increases in an NTP rat study; not classified')),
    (r'mineral oil|petrolatum|paraffin', None, (L, 'Mineral oil: aromatic fraction (MOAH) may be genotoxic (EFSA 2023)')),
    (r'\b(red|yellow|blue|green|orange) ?(no\.? ?|#)?\d+\b|fd ?& ?c|tartrazine|allura|sunset yellow|brilliant blue|indigotine|indigo carmine|fast green', None, DYE),
    (r'artificial colou?r', None, (L, 'Unspecified synthetic colour: assumed to be an FD&C dye (contaminant or rodent tumour signals)')),
    (r'polysorbate', None, (L, 'Polysorbate: promoted colon tumours in a mouse study (2017); ethoxylated, may carry 1,4-dioxane (IARC 2B)')),
    (r'sucralose|splenda', None, (L, 'Sucralose: impurity sucralose-6-acetate genotoxic in vitro (2023); leukaemia signal in one mouse study')),
    (r'acesulfame', None, (L, 'Acesulfame K: cancer association in the NutriNet-Santé cohort (2022); observational')),
    (r'saccharin', None, (L, 'Saccharin: bladder tumours in rats; mechanism judged not relevant to humans, delisted 2000')),
    (r'benzoate|benzoic acid', None, (L, 'Benzoate can form benzene (IARC Group 1) with vitamin C in drinks')),
    (r'carr?a?g[e]+nan|carrageen', None, (L, 'Carrageenan: degraded form is IARC 2B; breast-cancer association in NutriNet-Santé (2024)')),
    (r'cellulose gum|carboxymethyl ?cellulose', None, (L, 'Cellulose gum (CMC): promoted colon tumours in a mouse study (2017)')),
    (r'\bpalm\b', r'hearts? of palm|palm sugar|date palm|palm fruit juice', (L, 'Palm oil: refining forms glycidyl esters (glycidol is IARC 2A), highest in palm oil')),
    (r'mono ?-? ?(and|&|-|,)? ?di-?glycerides|monoglycerides?|diglycerides?', r'tartaric|diacetyl', (L, 'Mono- and diglycerides: cancer association in the NutriNet-Santé cohort (2024); may carry glycidyl esters')),
    (r'hydroly[sz]ed (vegetable|soy|soya|corn|wheat gluten|wheat|plant) protein', r'non-? ?hydroly', (L, 'Acid-hydrolysed protein can contain 3-MCPD (IARC Group 2B)')),
    (r'azodicarbonamide', None, (L, 'Azodicarbonamide forms semicarbazide and urethane (IARC 2A) when baked')),
    (r'ethoxylated', None, (L, 'Ethoxylated: may carry 1,4-dioxane traces (IARC 2B)')),
    (r'pearlescent', None, (L, 'Pearlescent pigments are usually coated with titanium dioxide (IARC 2B)')),
]
ZERO_KEYWORDS = [(re.compile(a), re.compile(b) if b else None, c) for a, b, c in ZERO_KEYWORDS]

NEG = re.compile(r'^(no|not|non|never|without|free of|free from|does not|contains no|0%)\b|\b(free|no added)\b')

def rescore(name, note, old):
    """Return (score, carc, note)."""
    base = note.split(' (rated as the ingredient')[0]
    rule = next((v for k, v in NOTE_RULES if k in base), None)
    if isinstance(rule, tuple): return 0, rule[0], rule[1]
    low = name.lower()
    negated = bool(NEG.search(low))
    for rx, ex, (lvl, why) in ([] if negated else ZERO_KEYWORDS):
        if rx.search(low) and not (ex and ex.search(low)): return 0, lvl, why
    if rule == 'KEEP' or rule is None: return max(1, min(100, old)), 0, note
    return rule, 0, note

def tier_of(score, carc):
    if carc == C: return 'classified carcinogen'
    if carc == L: return 'cancer link'
    return 'high concern' if score < 25 else 'moderate concern' if score < 50 else 'limited concern' if score < 75 else 'low concern'

cats, notes, tiers = [], [], []
def idx(lst, v):
    if v not in lst: lst.append(v)
    return lst.index(v)

rows_out = []
by_name = {}
with SRC.open(newline='', encoding='utf-8', errors='replace') as f:
    reader = list(csv.DictReader(f))

changed = collections.Counter()
for r in reader:
    name = r['ingredient'].strip()
    if not name: continue
    spell = set()
    for s in (r['label_spellings'] or '').split('|'):
        n = norm(s)
        if len(n) >= 2 and n != norm(name): spell.add(n)
    for s in (r['also_known_as_off'] or '').split(','):
        n = norm(s)
        if len(n) >= 2 and n != norm(name): spell.add(n)
    old = int(r['score_0_100'] or 50)
    score, carc, note = rescore(name, r['evidence_note'], old)
    changed['zero_new' if score == 0 and old > 0 else 'zero_kept' if score == 0 else 'rated'] += 1
    row = [name, score, idx(tiers, tier_of(score, carc)), idx(cats, r['category']), idx(notes, note),
           1 if (r['rating_basis'] == 'specific' or carc) else 0, (r['e_number'] or '').strip(), sorted(spell), carc]
    rows_out.append(row)
    by_name[norm(name)] = row

folded = 0
for r in reader:
    t = norm(r['likely_misspelling_of'] or '')
    me = norm(r['ingredient'])
    if t and t in by_name and me in by_name and t != me:
        tgt = by_name[t]
        if me not in tgt[7]: tgt[7].append(me)
        folded += 1

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({'cats': cats, 'notes': notes, 'tiers': tiers, 'rows': rows_out}, ensure_ascii=False, separators=(',', ':')))
print(f'{len(rows_out)} rows, {folded} misspellings folded, {OUT.stat().st_size/1e6:.2f} MB -> {OUT}')
print(dict(changed), '| classified', sum(1 for r in rows_out if r[8] == 1), '| linked', sum(1 for r in rows_out if r[8] == 2))
if '--review' in sys.argv:
    for r in reader:
        s, c, n = rescore(r['ingredient'].strip(), r['evidence_note'], int(r['score_0_100'] or 50))
        base = r['evidence_note'].split(' (rated as')[0]
        rule = next((v for k, v in NOTE_RULES if k in base), None)
        if s == 0 and not isinstance(rule, tuple): print(f"  KW  {r['ingredient'][:46]:46} | was {r['score_0_100']:>3} | {n[:60]}")
