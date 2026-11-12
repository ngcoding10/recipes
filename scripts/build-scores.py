#!/usr/bin/env python3
"""
Per-ingredient scores for the curated database (src/data/additives.ts).

Rule (set by the site owner, deliberately strict):
  0        = any cancer link at all. Two strengths, both score 0:
             C "classified": IARC Group 1/2A/2B, NTP, EU CLP carcinogen, or banned on cancer grounds
             L "linked":     carcinogenic contaminant or breakdown product, tumour findings in
                             animal studies, or a cancer association in a human cohort study
  1..100   = everything else, judged on the remaining evidence (hormone activity, gut effects,
             allergy, heart/metabolic links, regulatory restrictions, how well studied it is).
General diet effects (sugar, fat, salt, calories) are not treated as cancer links.

Edit the tables below and run:  python3 scripts/build-scores.py
It writes src/data/scores.ts and fails if any entry is missing or matched twice.
"""
import json, subprocess, sys, tempfile, os
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

ZERO = r"""
C|Potassium bromate|IARC Group 2B; banned in the EU, UK and Canada
C|Titanium dioxide (in food)|IARC Group 2B (inhaled); EFSA could not rule out genotoxicity
C|Erythrosine (Red 3)|Thyroid tumours in rats; FDA revoked it under the Delaney Clause (2025)
C|Citrus Red 2|IARC Group 2B
C|Sodium nitrite|Nitrite: IARC Group 2A (forms nitrosamines); processed meat is Group 1
C|Potassium nitrite|Nitrite: IARC Group 2A (forms nitrosamines)
C|Sodium nitrate|Ingested nitrate: IARC Group 2A under nitrosation conditions
C|Potassium nitrate|Ingested nitrate: IARC Group 2A under nitrosation conditions
L|Celery powder|Natural nitrite source: same nitrosamine chemistry as added nitrite
C|BHA|IARC Group 2B; NTP "reasonably anticipated to be a human carcinogen"
L|Azodicarbonamide|Forms semicarbazide and urethane (IARC 2A) when baked
C|Smoke flavouring|EFSA could not rule out genotoxicity (2023); EU phase-out
L|Biphenyl|Sodium o-phenylphenate is IARC Group 2B; bladder tumours in rats
L|Hexamethylenetetramine|Releases formaldehyde (IARC Group 1)
L|Tartrazine|May contain trace benzidine-type contaminants (known carcinogens); the dye itself is not classified
L|Sunset yellow|May contain trace benzidine-type contaminants; adrenal tumour signal in one rat study
L|Allura red|May contain trace benzidine-type contaminants (known carcinogens); the dye itself is not classified
L|Brilliant blue|Kidney tumour signal in one unpublished mouse study; regulators judged it not carcinogenic
L|Indigo carmine|Brain tumour signal in male rats in one study; FDA judged it not conclusive
L|Fast green|Bladder and testis tumour signal in male rats; FDA judged it not conclusive
L|Orange B|Can contain 2-naphthylamine, a known bladder carcinogen; FDA proposed a ban in 1978
C|Caramel IV (|Contains 4-methylimidazole (IARC Group 2B); California Prop 65
L|Caramel III (|Contains 4-methylimidazole (IARC Group 2B) at lower levels than Caramel IV
L|Vegetable carbon|Can carry polycyclic aromatic hydrocarbons; EFSA asked for contamination data
C|Aspartame$|IARC Group 2B (2023)
C|Aspartame-acesulfame|Contains aspartame: IARC Group 2B (2023)
C|Cyclamate|Banned in the US since 1970 after bladder tumours in rats (IARC Group 3)
L|Saccharin|Bladder tumours in rats; mechanism later judged not relevant to humans, delisted 2000
L|Acesulfame K|Cancer association in the NutriNet-Santé cohort (2022); observational
L|Sucralose|Impurity sucralose-6-acetate was genotoxic in vitro (2023); leukaemia signal in one mouse study
L|Sodium benzoate|Can form benzene (IARC Group 1) with vitamin C in drinks
L|Benzoic acid|Can form benzene (IARC Group 1) with vitamin C in drinks
L|Propyl gallate|Suggestive tumour increases in an NTP rat study; not classified
L|TBHQ|Tumour findings in some rodent studies at high dose; NTP and EFSA concluded not carcinogenic
L|BHT|Tumour promotion in some animal studies; IARC Group 3
L|Ethoxyquin|Impurity p-phenetidine is a possible mutagen (EFSA 2015); EU suspended it
L|Hydrolysed vegetable protein|Acid hydrolysis forms 3-MCPD (IARC Group 2B)
C|Alcohol (in food)|Alcoholic beverages: IARC Group 1 (trace carrier amounts are far smaller)
L|Carrageenan|Degraded form (poligeenan) is IARC 2B; breast-cancer association in NutriNet-Santé (2024)
L|Processed Eucheuma|Semi-refined carrageenan; degraded carrageenan is IARC 2B
L|Polysorbate 80|Promoted colon tumours in a mouse study (2017); ethoxylated, may carry 1,4-dioxane (IARC 2B)
L|Polysorbates 20|Ethoxylated: may carry 1,4-dioxane and ethylene oxide traces (IARC 2B / 1)
L|Carboxymethylcellulose|Promoted colon tumours in a mouse study (2017)
L|Mono- and diglycerides|Cancer association in the NutriNet-Santé cohort (2024); may carry glycidyl esters
L|Ethoxylated mono-|Ethoxylated: may carry 1,4-dioxane traces (IARC 2B)
C|Talc (in food)|IARC Group 2A (2024)
L|Microcrystalline / paraffin wax|Aromatic mineral-oil fraction (MOAH) may be genotoxic (EFSA 2023)
L|Palm oil|Refining forms glycidyl esters (glycidol is IARC 2A), highest in palm oil
C|Processed meat|IARC Group 1 (colorectal cancer)
C|Red meat|IARC Group 2A
C|Formaldehyde$|IARC Group 1
L|Formaldehyde-releasing|Release formaldehyde (IARC Group 1) into the product
L|Triclosan|Liver tumour promotion in mice (PNAS 2014)
L|Oxybenzone|Equivocal thyroid tumour evidence in an NTP rat study (2020)
C|Benzophenone$|IARC Group 2B; NTP
L|Octocrylene|Breaks down into benzophenone (IARC 2B) as the product ages
C|Titanium dioxide (cosmetic)|IARC Group 2B (inhaled particles: sprays and loose powders)
C|Methyleugenol|IARC Group 2A (2023)
C|Safrole|IARC Group 2B
L|Estragole|Genotoxic liver carcinogen in rodents (EFSA); not yet classified by IARC
L|Coumarin|Liver and lung tumours in rodents at high dose (NTP); IARC Group 3
L|Synthetic musks|Musk xylene is an EU category 2 carcinogen
L|Hydroquinone|Kidney tumours in rats (NTP "some evidence"); IARC Group 3
C|Lead acetate|Inorganic lead: IARC Group 2A
C|Dibutyl phthalate|IARC Group 2B (2026); toxic to reproduction
C|Dimethyltolylamine|N,N-dimethyl-p-toluidine: IARC Group 2B
C|Melamine|IARC Group 2B
L|Kojic acid|Thyroid and liver tumours in mice; IARC Group 3
L|Retinyl palmitate|Sped up skin tumours with UV light in an NTP mouse study (2012)
C|Cocamide DEA|IARC Group 2B; California Prop 65
L|Ethanolamines|Can form nitrosamines such as NDELA (IARC 2B)
L|Ethoxylated surfactants|Ethoxylation can leave 1,4-dioxane (IARC 2B) and ethylene oxide (Group 1) traces
L|Cyclopentasiloxane|Uterine tumours in rats in a two-year inhalation study
L|Petrolatum|Unrefined grades carry PAHs; untreated mineral oils are IARC Group 1
C|Talc (cosmetic)|IARC Group 2A (2024)
C|PFAS|PFOA is IARC Group 1, PFOS Group 2B
L|Microplastics|Can carry residual monomers such as acrylamide and styrene (IARC 2A)
C|Carbon black|IARC Group 2B (inhaled)
C|Coal tar|IARC Group 1
L|Benzoyl peroxide (acne)|Can break down into benzene (IARC Group 1) when stored warm
C|Benzene|IARC Group 1
C|1,4-Dioxane|IARC Group 2B
C|Ethylene oxide|IARC Group 1
C|Acrylamide|IARC Group 2A
C|Furan|IARC Group 2B
C|Benzo[a]pyrene|IARC Group 1
C|Nitrosamines|IARC Group 2A (NDMA) and 2B (NDELA)
C|3-MCPD|Glycidol IARC 2A; 3-MCPD 2B
C|Aflatoxins|IARC Group 1
C|Phthalates|IARC Group 2B (DEHP, BBP, DINP)
C|Vinyl chloride|IARC Group 1
C|Styrene|IARC Group 2A
C|Acrylonitrile|IARC Group 1 (2024)
C|Trichloroethylene|IARC Group 1
C|Tetrachloroethylene|IARC Group 2A
C|Dichloromethane|IARC Group 2A
C|Chloroform|IARC Group 2B
C|Carbon tetrachloride|IARC Group 2B
C|Naphthalene|IARC Group 2B
C|Chlorinated flame retardants|TCPP: IARC Group 2A (2026)
C|Brominated flame retardants|TBBPA: IARC Group 2A
C|Glyphosate|IARC Group 2A
C|Atrazine|IARC Group 2A (2025)
C|Alachlor|IARC Group 2A (2025)
C|Vinclozolin|IARC Group 2B (2025)
C|Chlorpyrifos|Malathion and diazinon: IARC Group 2A
C|MTBE|IARC Group 2B (2025)
C|Butyraldehyde|IARC Group 2B (2026)
C|Acetaldehyde|IARC Group 2B; Group 1 with alcohol
C|Heavy metals|Arsenic, cadmium, chromium VI, nickel compounds: IARC Group 1; lead 2A
C|Pentachlorophenol|IARC Group 1
C|Silica, crystalline|IARC Group 1 (inhaled)
C|Asbestos|IARC Group 1
"""

SCORES = r"""
3|Partially hydrogenated oil
5|Brominated vegetable oil
14|Propylparaben (food)
45|Methylparaben (food)
10|Boric acid
20|Quinoline yellow
20|Carmoisine
20|Ponceau 4R
32|Green S
30|Brilliant black
30|Brown HT
32|Lithol rubine
72|Caramel II (
86|Plain caramel
50|Canthaxanthin
45|Aluminium (colour)
52|Silver / gold leaf
58|Carmine
72|Annatto
92|Curcumin
96|Riboflavin
93|Chlorophyll
93|Beta-carotene
93|Paprika extract
93|Lycopene
86|Apocarotenal
93|Lutein
96|Beetroot red
96|Anthocyanins
96|Saffron
93|Calcium carbonate
88|Iron oxides
50|Neotame
50|Advantame
76|Neohesperidine
84|Steviol glycosides
85|Thaumatin
84|Monk fruit
80|Allulose
64|Sorbitol
58|Maltitol
64|Mannitol
64|Lactitol
52|Erythritol
58|Xylitol
28|High-fructose corn syrup
42|Dextrose
44|Sugar
44|Maltodextrin
86|Sorbic acid
86|Potassium sorbate
55|Calcium sorbate
46|Sulphites
82|Natamycin
90|Nisin
60|Dimethyl dicarbonate
82|Ethyl lauroyl arginate
62|Propionates
96|Lactic acid
96|Citric acid
96|Malic
96|Tartaric acid
90|Adipic acid
97|Acetic acid
98|Ascorbic acid
88|Erythorbates
98|Tocopherols
24|Octyl / dodecyl gallate
58|Calcium disodium EDTA
93|Rosemary extract
60|Monosodium glutamate
62|Disodium guanylate
80|Yeast extract
48|Artificial flavour
70|Natural flavour
58|Caffeine
86|Cellulose$
80|Methylcellulose
64|Ammonium phosphatides
54|DATEM
62|Sodium / calcium stearoyl lactylate
62|PGPR
76|Polyglycerol esters
60|Propylene glycol esters
60|Sorbitan esters
78|Sucrose esters
62|Sucrose acetate isobutyrate
60|Glycerol ester of wood rosin
93|Lecithin
88|Guar gum
88|Xanthan gum
90|Locust bean gum
95|Pectin
93|Agar
88|Gellan gum
92|Gum arabic
88|Tragacanth
74|Konjac
90|Alginate
64|Propylene glycol alginate
78|Modified starch
75|Polydextrose
60|Polyvinylpyrrolidone
78|Polyvinyl alcohol
88|Gelatin
88|Glycerol$
60|Propylene glycol$
34|Phosphoric acid
40|Phosphate additives
34|Sodium aluminium phosphate
50|Aluminium sulphates
80|Ferrocyanides
66|Silicon dioxide
86|Calcium / magnesium silicate
88|Stearic acid
96|Sodium bicarbonate
90|Baking powder
90|Calcium / magnesium / potassium chloride
88|Hydroxides
90|Sulphate salts
88|Hydrochloric
60|Stannous chloride
90|Gluconates
62|4-Hexylresorcinol
60|Dimethylpolysiloxane
88|Waxes
50|Hydrogenated poly-1-decene
85|L-cysteine
50|Benzoyl peroxide (flour
99|Packaging gases
85|Propellants
82|Quillaia
90|Lysozyme
86|Triethyl citrate
78|Benzyl alcohol
78|Salt
90|Potassium iodate
36|Fully hydrogenated
90|Whey
85|Soy protein
68|Enriched
20|Methylisothiazolinone
30|Parabens (long-chain)
56|Parabens (short-chain)
60|Phenoxyethanol
20|Triclocarban
55|Chlorphenesin
50|Iodopropynyl
86|Mild preservatives
34|Homosalate
45|Octinoxate
40|Isoamyl p-methoxycinnamate
55|Octisalate
10|4-Methylbenzylidene camphor
45|PABA
88|Zinc oxide
80|Avobenzone
8|Lilial
15|HICC
60|Fragrance allergens
50|Parfum
55|Diethyl phthalate
2|Mercury compounds
20|p-Phenylenediamine
35|Resorcinol
24|Toluene
30|Triphenyl phosphate
8|TPO
45|HEMA
25|Glyoxylic acid
55|Theophylline
45|Pentetic acid
80|Alpha-hydroxy
50|Hydrogen peroxide
55|Sodium lauryl sulfate
86|Mild surfactants
20|Cyclotetrasiloxane
78|Dimethicone
65|Lanolin
78|Alcohol denat
88|Butylene glycol
50|Aluminium salts
42|Coal-tar / D&C dyes
85|Mica
50|Nanomaterials
88|Hydroxyapatite
60|Essential oils
95|Common safe cosmetic bases
8|Bisphenol A
40|Hexane
"""

def names():
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, 'a.mjs')
        subprocess.run(['npx', 'esbuild', 'src/data/additives.ts', '--bundle', '--platform=node', '--format=esm', f'--outfile={out}', '--log-level=error'], cwd=ROOT, check=True)
        r = subprocess.run(['node', '-e', f"import('{out}').then(m=>console.log(JSON.stringify(m.ADDITIVES.map(a=>a.name))))"], cwd=ROOT, check=True, capture_output=True, text=True)
        return json.loads(r.stdout)

ALL = names()
result = {}
def find(key):
    exact = key.endswith('$'); k = key.rstrip('$')
    hits = [n for n in ALL if (n == k if exact else n.startswith(k))]
    if len(hits) != 1: sys.exit(f'key {key!r} matched {len(hits)} entries: {hits}')
    if hits[0] in result: sys.exit(f'{hits[0]!r} scored twice')
    return hits[0]

for line in ZERO.strip().splitlines():
    lvl, key, why = line.split('|', 2)
    result[find(key)] = [0, 'classified' if lvl == 'C' else 'linked', why]
for line in SCORES.strip().splitlines():
    sc, key = line.split('|', 1)
    assert 1 <= int(sc) <= 100
    result[find(key)] = [int(sc)]
missing = [n for n in ALL if n not in result]
if missing: sys.exit('no score for: ' + '; '.join(missing))

ts = ['// GENERATED by scripts/build-scores.py — edit the tables there, not this file.',
      "export type CarcLevel = 'classified' | 'linked';",
      'export const SCORES: Record<string, [number] | [0, CarcLevel, string]> = {']
for n in ALL: ts.append(f'  {json.dumps(n, ensure_ascii=False)}: {json.dumps(result[n], ensure_ascii=False)},')
ts.append('};\n')
(ROOT / 'src' / 'data' / 'scores.ts').write_text('\n'.join(ts))
z = sum(1 for v in result.values() if v[0] == 0)
print(f'{len(ALL)} entries scored: {z} at 0 ({sum(1 for v in result.values() if len(v)>1 and v[1]=="classified")} classified, {sum(1 for v in result.values() if len(v)>1 and v[1]=="linked")} linked), {len(ALL)-z} rated 1-100')
