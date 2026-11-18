#!/usr/bin/env python3
"""
Build public/data/synonyms.json: label words in other languages → the English name the scanner knows.

Source: the Open Food Facts taxonomies (additives.txt and ingredients.txt), Open Database License
(ODbL), https://github.com/openfoodfacts/openfoodfacts-server/tree/main/taxonomies
Download them once into data/off/ (git-ignored):

  mkdir -p data/off
  curl -sSL -o data/off/additives.txt   https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/additives.txt
  curl -sSL -o data/off/ingredients.txt https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/food/ingredients.txt

Then:  python3 -I scripts/build-synonyms.py [data/off]

Rules, so a translation can never make a score worse by accident:
  * a foreign name is kept only if its English counterpart is something the scanner already knows
    (a curated alias, an E-number we list, or a name in the extended ingredient list);
  * names that are also English words the scanner knows are skipped ("tomate" stays, "date" is skipped);
  * a foreign name that points to two different English targets is dropped as ambiguous.
"""
import json, re, subprocess, sys, tempfile, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from importlib.machinery import SourceFileLoader
off = SourceFileLoader('off_taxonomy', str(ROOT / 'scripts' / 'off-taxonomy.py')).load_module()

LANGS = ['fr', 'es', 'it', 'de', 'pt', 'nl']
src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'data' / 'off'
if not (src / 'additives.txt').exists():
    sys.exit(f'missing {src}/additives.txt — see the download commands at the top of this file')

# What the scanner already understands --------------------------------------------------------
with tempfile.TemporaryDirectory() as d:
    out = os.path.join(d, 'a.mjs')
    subprocess.run(['npx', 'esbuild', 'src/data/additives.ts', '--bundle', '--platform=node', '--format=esm',
                    f'--outfile={out}', '--log-level=error'], cwd=ROOT, check=True)
    r = subprocess.run(['node', '-e', f'import("{out}").then(m=>console.log(JSON.stringify(m.ADDITIVES.map(a=>[a.code||"",a.aliases]))))'],
                       capture_output=True, text=True, check=True)
curated = json.loads(r.stdout)
known = set()
for code, aliases in curated:
    if code: known.add(off.norm(code))
    for a in aliases: known.add(off.norm(a))
ds = json.loads((ROOT / 'public' / 'data' / 'ingredients.json').read_text())
dataset = set()
for row in ds['rows']:
    dataset.add(off.norm(row[0]))
    for sp in row[7] or []: dataset.add(sp)
english_words = known | dataset

def target_for(block):
    """Pick the English name to translate to: curated alias first, then the extended list."""
    en = [off.norm(n) for n in block.get('en', [])]
    for n in en:
        if n in known: return n
    for n in en:
        if n in dataset: return n
    return None

syn, clash = {}, set()
def add(foreign, target):
    k = off.norm(foreign)
    if not k or k == target or k in english_words: return
    if len(k) < 3 or re.fullmatch(r'[\d\s\-/&]+', k): return
    if k in syn and syn[k] != target: clash.add(k); return
    syn[k] = target

for fname in ('additives.txt', 'ingredients.txt'):
    for block in off.blocks(src / fname):
        t = target_for(block)
        if not t: continue
        for lang in LANGS:
            for name in block.get(lang, []):
                add(name, t)
for k in clash: syn.pop(k, None)

payload = {
    'source': 'Open Food Facts taxonomies, Open Database License (ODbL) — https://world.openfoodfacts.org',
    'langs': LANGS,
    'map': dict(sorted(syn.items())),
}
dest = ROOT / 'public' / 'data' / 'synonyms.json'
dest.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
print(f'{len(syn)} foreign names → English ({len(clash)} ambiguous dropped), {dest.stat().st_size/1e3:.0f} kB -> {dest}')
