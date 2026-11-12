#!/usr/bin/env python3
"""
Compact data/flagged_ingredients_rated.csv (27k rated ingredients) into
public/data/ingredients.json for the label scanner.

    python3 scripts/build-ingredients.py

Output shape (kept small; the scanner lazy-loads it on first scan):
  { "cats": [...], "notes": [...], "tiers": [...],
    "rows": [[name, score, tierIdx, catIdx, noteIdx, specific(0|1), eNumber, [spellings...]], ...] }
"""
import csv, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'flagged_ingredients_rated.csv'
OUT = ROOT / 'public' / 'data' / 'ingredients.json'

def norm(s: str) -> str:
    s = s.lower().replace('â', '').replace(' ', ' ')
    s = re.sub(r'[^a-z0-9&/\-\s]', ' ', s)   # drop +, *, °, punctuation noise
    s = re.sub(r'\s+', ' ', s).strip(' -')
    return s

cats, notes, tiers = [], [], []
def idx(lst, v):
    if v not in lst: lst.append(v)
    return lst.index(v)

rows_out = []
by_name = {}
with SRC.open(newline='', encoding='utf-8', errors='replace') as f:
    reader = list(csv.DictReader(f))

# first pass: canonical rows
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
    row = [
        name,
        int(r['score_0_100'] or 50),
        idx(tiers, r['risk_tier']),
        idx(cats, r['category']),
        idx(notes, r['evidence_note']),
        1 if r['rating_basis'] == 'specific' else 0,
        (r['e_number'] or '').strip(),
        sorted(spell),
    ]
    rows_out.append(row)
    by_name[norm(name)] = row

# second pass: fold "likely misspelling" rows into their target as a spelling
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
