#!/usr/bin/env python3
"""Parse an Open Food Facts taxonomy file (additives.txt / ingredients.txt) into blocks.
Data: Open Food Facts, https://world.openfoodfacts.org — Open Database License (ODbL)."""
import re, unicodedata

def strip_accents(s: str) -> str:
    s = s.replace('ß', 'ss').replace('œ', 'oe').replace('æ', 'ae')
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def norm(s: str) -> str:
    s = strip_accents(s.lower())
    s = re.sub(r'[^a-z0-9&/\-\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip(' -')

def blocks(path):
    """Yield dicts {lang: [names]} for each taxonomy entry."""
    cur = {}
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.rstrip('\n')
        if not line.strip():
            if cur: yield cur
            cur = {}; continue
        if line.startswith('#') or line.startswith('<') or ':' not in line: continue
        lang, _, rest = line.partition(':')
        lang = lang.strip()
        if not re.fullmatch(r'[a-z]{2}', lang): continue          # skips properties like wikidata:en
        names = [n.strip() for n in rest.split(',') if n.strip()]
        cur.setdefault(lang, []).extend(names)
    if cur: yield cur
