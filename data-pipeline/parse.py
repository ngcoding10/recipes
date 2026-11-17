import re
PRE=re.compile(r"^(INGREDIENTS?( LIST)?|INGREDIENTES)\s*[:;\-]?\s*")
ALLERG=re.compile(r"^(MAY CONTAINS?|CONTAINS?:|CONTAINS? (?!\d|LESS|ONE |TWO |2|1|UP TO|NO MORE|AT MOST|EACH|OR LESS|[A-Z ]*PERCENT)|ALLERGENS?|ALLERGY|MANUFACTURED|PRODUCED (IN|ON)|PROCESSED (IN|ON)|MADE (IN|ON) |PACKAGED|PACKED (IN|ON)|DISTRIBUTED|WARNING|NOT A SIGNIFICANT|PRODUCT OF|GLUTEN FREE|KEEP |STORE |REFRIGERATE|SEE |BEST |\*+ ?(ORGANIC|CERTIFIED|ADDS|NOT ))")
LEAD=re.compile(r"^(?:(?:AND/OR|AND|OR|WITH|PLUS|ALSO|INCLUDING|INCLUDES|CONTAINS?|CONTAINING|MADE (?:FROM|WITH|OF)|PREPARED WITH|CONSISTING OF|A BLEND OF|BLEND OF|ONE OR MORE OF(?: THE FOLLOWING)?|THE FOLLOWING|EACH OF(?: THE FOLLOWING)?|(?:LESS THAN|NO MORE THAN|NOT MORE THAN|UP TO|AT MOST)? ?(?:\d+(?:[.,/]\d+)?|ONE|TWO|ONE HALF OF ONE) ?(?:%|PERCENT)(?: OR LESS)?(?: OF)?(?: EACH)?(?: THE FOLLOWING)?(?: OF)?|OR LESS OF|LESS THAN|OF|EACH|TRACE OF|A TRACE OF|ADDED|ORGANIC|CERTIFIED ORGANIC|NON ?GMO|FRESH|PASTEURIZED|PURE|RAW|NATURAL(?=LY)?(?! FLAV)(?! SMOKE)(?! AND)(?! COLOR)(?! SWEET)(?! CASING)(?! CARAMEL))\b[\s:\-]*)+")
TRAIL=re.compile(r"(?:\s+(?:AND|OR|ADDED)|\s*(?:\d+(?:[.,]\d+)?\s?%|\*+|†+|‡+|\(\s*\)|\.+|:))+$")
FUNC=re.compile(r"^(?:(?:AN? |AS AN? |AS |ADDED (?:AS|TO|FOR) (?:AN? )?|USED (?:AS|TO|FOR) (?:AN? )?|TO |FOR |FOR ADDED )(?:NATURAL )?(?:PRESERV\w*|PROTECT\w*|PROMOTE\w*|RETAIN\w*|MAINTAIN\w*|HELP\w*|PREVENT\w*|ENSURE\w*|IMPROVE\w*|ENHANCE\w*|EMULSIF\w*|STABILI\w*|THICKEN\w*|COLOU?R\w*|FRESHNESS|FLAVOU?R(?:ING)?S?(?: ENHANCER)?|ANTI ?OXIDANTS?|ANTI ?CAKING(?: AGENT)?|ACIDULANTS?|ACIDITY REGULATORS?|FIRMING AGENT|LEAVENING|SWEETENERS?|SWEETNESS|HUMECTANTS?|TEXTURE|TARTNESS|TENDERNESS|MOISTURE|FREE FLOWING|PROCESSING AID|DOUGH CONDITIONERS?|NUTRIENTS?|BINDER|WHITENER|SOLVENT|QUALITY|CAKING|SEPARATION)(?: \w+){0,5}|ADDS? (?:A )?(?:TRIVIAL|NEGLIGIBLE|DIETARILY INSIGNIFICANT) .*|(?:NATURAL )?(?:PRESERVATIVES?|EMULSIFIERS?|STABILI[ZS]ERS?|THICKENERS?|ANTI ?OXIDANTS?|ANTI ?CAKING(?: AGENTS?)?|ACIDULANTS?|ACIDITY REGULATORS?|FIRMING AGENTS?|HUMECTANTS?|PROCESSING AIDS?|DOUGH CONDITIONERS?|FRESHNESS|LEAVENING|VITAMINS AND MINERALS|VITAMINS|MINERALS))$")
KEEPAND=re.compile(r"MONO|GLYCERIDE|FLAVOR|HALF AND HALF|VITAMIN|COLOR|\\bOILS?\\b|COOKIES AND|SWEET AND|MAC AND|SALT AND VINEGAR|AND/OR|FRUIT AND VEG|HERBS AND|SPICES AND|CULTURE|ENZYME|PEPPER|B AND J|M AND M")
def clean(t):
    t=t.strip(" \t\r\n,;:.-*_/\\'\"#")
    for _ in range(3):
        t2=LEAD.sub("",t); t2=TRAIL.sub("",t2).strip(" ,;:.-*_/\\'\"#")
        if t2==t: break
        t=t2
    return re.sub(r"\s+"," ",t)
def split_top(s):
    out=[];depth=0;cur=[]
    for ch in s:
        if ch in "([{": depth+=1;cur.append(ch)
        elif ch in ")]}": depth=max(0,depth-1);cur.append(ch)
        elif ch in ",;" and depth==0: out.append("".join(cur));cur=[]
        else: cur.append(ch)
    out.append("".join(cur)); return out
def toks(s,depth=0,acc=None):
    if acc is None: acc=[]
    for piece in split_top(s):
        piece=piece.strip()
        if not piece: continue
        m=re.search(r"[(\[{]",piece)
        if m:
            head=piece[:m.start()]
            # matching close
            d=0;end=len(piece)
            for i in range(m.start(),len(piece)):
                if piece[i] in "([{": d+=1
                elif piece[i] in ")]}":
                    d-=1
                    if d==0: end=i;break
            inner=piece[m.start()+1:end]; tail=piece[end+1:]
            h=clean(head+" "+ (tail if not re.search(r"[(\[{]",tail) else ""))
            if h: acc.append((h,depth))
            if depth<4: toks(inner,depth+1,acc)
            if re.search(r"[(\[{]",tail) and depth<4: toks(tail,depth,acc)
        else:
            h=clean(piece.replace(")","").replace("]","").replace("}",""))
            if h: acc.append((h,depth))
    return acc
def parse(text):
    t=text.upper().replace("\u00ae","").replace("\u2122","").replace("&AMP;","&")
    t=re.sub(r"[\u2018\u2019`]","'",t); t=re.sub(r"\s+"," ",t)
    t=re.sub(r"\b(FD ?(&|AND) ?C|D ?& ?C|FDC|F\.D\. ?(&|AND) ?C\.?)\s*","",t)
    t=re.sub(r"\b(RED|YELLOW|BLUE|GREEN|ORANGE|VIOLET)\s*(?:NO\.?|NUMBER|#)?\s*(\d{1,2})\b",r"\1 \2",t)
    t=PRE.sub("",t.strip())
    # sentences: cut allergen / boilerplate statements
    sents=re.split(r"(?<=[A-Z0-9\)\]\*])\.\s+(?=[A-Z\*])",t)
    keep=[]
    for si,s in enumerate(sents):
        s2=PRE.sub("",s.strip())
        if si>0 and ALLERG.match(s2): continue
        if si==0: s2=re.sub(r"^CONTAINS?:?\s+","",s2)
        keep.append(s2)
    res=[];seen=set()
    for s in keep:
        for name,d in toks(s):
            name=re.sub(r"\s*&\s*"," AND ",name)
            if " AND " in name and not KEEPAND.search(name):
                parts=[clean(p) for p in name.split(" AND ")]
            else: parts=[name]
            for name in parts:
              if d>0 and re.match(r"^(NATURAL )?(COLOU?R(S|ING|ANT)?|FLAVOU?R ENHANCER|SWEETENER)$",name): continue
              if len(name)<2 or len(name)>160 or FUNC.match(name) or not re.search(r"[A-Z]",name): continue
              pass
              if name not in seen: seen.add(name);res.append((name,d))
    return res
if __name__=="__main__":
    for s in ["INGREDIENTS: ENRICHED FLOUR (WHEAT FLOUR, NIACIN, REDUCED IRON), SUGAR, CONTAINS 2% OR LESS OF: SALT, SOY LECITHIN (EMULSIFIER), RED 40 LAKE, BHT (TO PRESERVE FRESHNESS), NATURAL AND ARTIFICIAL FLAVORS. CONTAINS: WHEAT, SOY.",
      "Organic Cane Sugar*, Citric Acid; less than 1% of: Sodium Benzoate (preservative), Yellow 5. *Organic","MILK CHOCOLATE [SUGAR, COCOA BUTTER, MILK, SOY LECITHIN (AN EMULSIFIER), PGPR], PEANUTS, DEXTROSE, TBHQ AND CITRIC ACID (TO MAINTAIN FRESHNESS)"]:
        print(parse(s))
