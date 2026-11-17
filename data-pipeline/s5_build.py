import pickle,collections,sys,re,json,csv,os
sys.path.insert(0,'/home/claude/scripts')
from classify import *
from parse import parse
C=Classifier(); R=C.R
P=pickle.load(open('/home/claude/data/products.pkl','rb'))
parsed=pickle.load(open('/home/claude/data/parsed.pkl','rb'))
extra=[]
if os.path.exists('/home/claude/data/extra_products.json'):
    extra=json.load(open('/home/claude/data/extra_products.json'))
    for e in extra:
        P.append((e.get('upc',''),'',e['brand'],e['brand'],'',e['product'],e.get('category',''),e.get('retrieved','2026-11'),e['ingredients']))
        parsed.append([n for n,d in parse(e['ingredients'])])
NEX=len(extra)
# ---- classify distinct tokens
freq=collections.Counter()
for toks in parsed:
    for t in set(toks): freq[t]+=1
CLS_DEF={'colour':60,'preservative':60,'antioxidant':75,'emulsifier':60,'thickener':75,'stabiliser':75,'gelling agent':75,'sweetener':50,'flavour enhancer':60,'acidity regulator':88,'acid':88,'raising agent':88,'anti-caking agent':70,'glazing agent':70,'humectant':75,'flour treatment agent':60,'firming agent':88,'sequestrant':75,'bulking agent':75,'carrier':75,'propellant':80,'packaging gas':95,'foaming agent':70,'anti-foaming agent':70,'emulsifying salt':60}
offcanon={}  # name -> dict
tok2={}      # token -> list of canon keys ('r',i) or ('o',name)
kind=collections.Counter(); unrev=collections.Counter(); cleanfreq=collections.Counter()
for tok,c in freq.items():
    hits,rest,neg=C.classify(tok)
    if hits: tok2[tok]=[('r',i,sub if sub else (R[i][0] if any(sn==R[i][0] for sn,_ in C.S.get(i,[])) else '')) for i,sub in hits]; kind['rule']+=c
    elif neg: kind['negated/claim']+=c
    elif FUNCTXT.search(norm(tok)): kind['function text']+=c
    elif C.is_clean(tok): kind['plain food']+=c; cleanfreq[tok]=c
    else:
        a=C.off_additive(tok)
        if a:
            nm=a['names'][1] if len(a['names'])>1 and a['names'][0].startswith('E') else a['names'][0]
            cl=[x.strip() for x in a['classes'].split(',') if x.strip()]
            sc=min([CLS_DEF.get(x,70) for x in cl] or [70])
            offcanon.setdefault(nm,{'e':a['e'],'cls':cl[0] if cl else 'other additive','score':sc,'names':a['names']})
            tok2[tok]=[('o',nm)]; kind['additive (class default)']+=c
        else: kind['unreviewed']+=c; unrev[tok]=c
_rs={}
for ks in tok2.values():
    for k in ks:
        if k[0]=='r': _rs[re.sub(r"[^a-z0-9]+","-",(k[2] or R[k[1]][0]).lower()).strip('-')]=k
for t,ks in list(tok2.items()):
    if ks[0][0]=='o':
        sl=re.sub(r"[^a-z0-9]+","-",ks[0][1].lower()).strip('-')
        if sl in _rs: tok2[t]=[_rs[sl]]; offcanon.pop(ks[0][1],None)
tot=sum(kind.values())
stats={k:round(100*v/tot,2) for k,v in kind.items()}
print(stats)
# ---- e-numbers for rules from OFF names
rule_e=collections.defaultdict(set); rule_off=collections.defaultdict(set)
for a in C.adds:
    if not a['e']: continue
    for n in a['names'][:6]:
        if re.match(r"^E ?\d",n): continue
        h,rest,neg=C.classify(n)
        if h and not re.search(r"[A-Z]{4}",rest): rule_e[('r',)+h[0]].add(a['e']); rule_off[('r',)+h[0]].add(n); break

# ---- research evidence, strict attach
D='/home/claude/research_notes/Food additive safety evidence 2026/'
ev=collections.defaultdict(list)
def prep(n):
    n=re.sub(r"\(.*?\)","",n.upper()); n=re.sub(r"\b(FD ?& ?C|D ?& ?C)\s*","",n)
    n=re.sub(r"\b(RED|YELLOW|BLUE|GREEN|ORANGE|VIOLET)\s*(?:NO\.?|NUMBER|#)?\s*(\d{1,2})\b",r"\1 \2",n); return n.strip()
for f in ['carcinogen_classifications','us_regulation','eu_efsa_status','health_evidence']:
    for r in json.load(open(D+f+'.json')):
        for n in [r['name']]+[x for x in (r.get('aliases') or []) if isinstance(x,str)][:4]:
            h,rest,neg=C.classify(prep(n))
            if h and not re.search(r"[A-Z]{4}",re.sub(r"\b(AND|THE|FOOD|GRADE|COLOU?R|ADDED|SALTS?|ACID|CLASS|SODIUM|POTASSIUM|CALCIUM|EXTRACT|ROOT|POWDER|MEAT|CURED|ADDITIVES?)\b","",rest)):
                ev[h[0][0]].append((f,r)); break
def pick(rows,key,order):
    for f in order:
        for ff,r in rows:
            v=r.get(key)
            if ff==f and v and str(v).lower() not in ('unknown','none','no',''): return str(v)
    for ff,r in rows:
        v=r.get(key)
        if v and str(v).lower()!='unknown': return str(v)
    return ''
def band(s): return 'suspected carcinogen (0)' if s==0 else 'high concern (1-25)' if s<=25 else 'moderate concern (26-50)' if s<=50 else 'limited concern (51-85)' if s<=85 else 'no specific concern (86-100)'
def slug(n): return re.sub(r"[^a-z0-9]+","-",n.lower()).strip('-')
# ---- per-canonical stats from products
canon_n=collections.Counter(); canon_var=collections.defaultdict(collections.Counter); canon_brand=collections.defaultdict(collections.Counter)
def cinfo(k):
    if k[0]=='r': n,cls,sc,rx,note=R[k[1]]; return (k[2] or (n+' (other)' if k[1] in C.S else n)),cls,sc
    o=offcanon[k[1]]; return k[1],o['cls'],o['score']
prod_rows=[]; prod_ids=[]
for p,toks in zip(P,parsed):
    seen={}; nun=0
    for t in toks:
        ks=tok2.get(t)
        if ks:
            for k in ks:
                seen.setdefault(k,t)
        elif t in unrev: nun+=1
    brand=(p[3] or p[2]).strip()
    for k,t in seen.items():
        canon_n[k]+=1; canon_brand[k][brand]+=1
    infos=sorted((cinfo(k)[2],cinfo(k)[0]) for k in seen)
    fl=[(s,n) for s,n in infos if s<=85]
    if fl:
        worst=fl[0][0]; n50=sum(1 for s,n in fl if s<=50)
        score=0 if worst==0 else max(1,worst-min(15,3*max(0,n50-1)))
    else: worst=100; score=100
    prod_ids.append([slug(n) for sc_,n in fl])
    prod_rows.append((p[0],p[1],p[2],p[3],p[5],p[6],p[7],score,fl[0][1] if fl else '',worst if fl else '',sum(1 for s,n in fl if s==0),sum(1 for s,n in fl if 0<s<=25),sum(1 for s,n in fl if 25<s<=50),sum(1 for s,n in fl if 50<s<=85),'; '.join(f"{n} [{s}]" for s,n in fl),nun,p[8]))
for t,ks in tok2.items():
    for k in ks: canon_var[k][t]+=freq[t]
# ---- write ingredient db
os.makedirs('/home/claude/out',exist_ok=True)
ING=[]
rkeys=sorted({k for ks in tok2.values() for k in ks if k[0]=='r'})
have={k[1] for k in rkeys}
for i in range(len(R)):
    if i not in have: rkeys.append(('r',i,''))
for k in sorted(rkeys):
    i=k[1]; name,cls,score,rx,note=R[i]; rows=ev.get(i,[]); nm=cinfo(k)[0]
    multi=len(C.S.get(i,[]))>1
    srcs=[]
    for f,r in rows:
        for u in (r.get('sources') or []):
            if u not in srcs: srcs.append(u)
    ING.append({'id':slug(nm),'name':nm,'group':name,'class':cls,'score':score,'tier':band(score),'flagged':score<=85,'rating_basis':'evidence table','evidence_note':note,
      'iarc_group':pick(rows,'iarc_group',['carcinogen_classifications']),'prop65':pick(rows,'prop65',['carcinogen_classifications']),'ntp_roc':pick(rows,'ntp_roc',['carcinogen_classifications']),
      'fda_status':pick(rows,'fda_status',['us_regulation','carcinogen_classifications']),'us_state_actions':pick(rows,'us_state_actions',['us_regulation']),
      'eu_status':pick(rows,'eu_status',['eu_efsa_status','carcinogen_classifications']),'efsa_note':pick(rows,'efsa_note',['eu_efsa_status']),
      'regulatory_fields_scope':('group-level: fields describe the group, check the specific substance' if multi else 'this ingredient') if rows else '',
      'research_checked_against_primary_source':any(r.get('verified') for f,r in rows),
      'e_numbers':sorted(rule_e.get(k,[])),'match_regex':rx.pattern,
      'aliases':sorted(set([t.title() for t,c in canon_var[k].most_common(25)]+sorted(rule_off.get(k,[]))[:15])),
      'label_variants':len(canon_var[k]),'products':canon_n[k],'top_brands':[b for b,c in canon_brand[k].most_common(8) if b],'sources':srcs[:8]})
for nm,o in offcanon.items():
    k=('o',nm)
    if not canon_var[k]: continue
    ING.append({'id':slug(nm),'name':nm,'group':'Other recognized additives','regulatory_fields_scope':'','class':o['cls'],'score':o['score'],'tier':band(o['score']),'flagged':o['score']<=85,'rating_basis':'additive class default (not individually reviewed)','evidence_note':'Recognized additive; scored by the default for its class, not individually reviewed',
      'iarc_group':'','prop65':'','ntp_roc':'','fda_status':'','us_state_actions':'','eu_status':'','efsa_note':'','research_checked_against_primary_source':False,'e_numbers':[o['e']] if o['e'] else [],'match_regex':'',
      'aliases':[n for n in o['names'][:12]],'label_variants':len(canon_var[k]),'products':canon_n[k],'top_brands':[b for b,c in canon_brand[k].most_common(8) if b],'sources':[]})
ING.sort(key=lambda d:(d['score'],-d['products']))
flag=[d for d in ING if d['flagged']]; rec=[d for d in ING if not d['flagged']]
json.dump({'generated':'2026-11-17','score_scale':'0-100, higher is better; 0 = carcinogen classification or removal on cancer grounds','ingredients':flag},open('/home/claude/out/ingredients_flagged.json','w'),indent=1)
cols=['id','name','group','class','score','tier','rating_basis','evidence_note','iarc_group','prop65','ntp_roc','fda_status','us_state_actions','eu_status','efsa_note','regulatory_fields_scope','research_checked_against_primary_source','e_numbers','products','label_variants','top_brands','aliases','sources','match_regex']
def wcsv(path,rows):
    with open(path,'w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(cols)
        for d in rows: w.writerow([' | '.join(map(str,d[c])) if isinstance(d[c],list) else d[c] for c in cols])
wcsv('/home/claude/out/ingredients_flagged.csv',flag)
wcsv('/home/claude/out/ingredients_recognized_no_concern.csv',rec)
# ---- label variants
with open('/home/claude/out/label_variants.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['label_text','products','lowest_score','maps_to'])
    for t,ks in sorted(tok2.items(),key=lambda x:-freq[x[0]]):
        inf=sorted((cinfo(k)[2],cinfo(k)[0]) for k in ks)
        w.writerow([t,freq[t],inf[0][0],' + '.join(f"{n} [{s}]" for s,n in inf)])
with open('/home/claude/out/plain_foods_not_flagged.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['label_text','products'])
    for t,c in cleanfreq.most_common():
        if c>=3: w.writerow([t,c])
with open('/home/claude/out/unreviewed_label_text.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['label_text','products'])
    for t,c in unrev.most_common():
        if c>=2: w.writerow([t,c])
pcols=['upc','fdc_id','brand_owner','brand_name','product_name','category','label_date','ingredient_score','worst_ingredient','worst_ingredient_score','n_zero','n_high','n_moderate','n_limited','flagged_ingredients','unreviewed_terms','ingredients']
with open('/home/claude/out/products.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(pcols); w.writerows(prod_rows)
pickle.dump((pcols,prod_rows),open('/home/claude/data/prod_rows.pkl','wb'))
pickle.dump(prod_ids,open('/home/claude/data/prod_ids.pkl','wb'))
json.dump(ING,open('/home/claude/out/ingredients_all.json','w'))
pickle.dump({'tok2':tok2,'offcanon':offcanon},open('/home/claude/data/tokmaps.pkl','wb'))
json.dump({'coverage_pct_of_label_appearances':stats,'products':len(P),'products_from_2026_label_research':NEX,'distinct_label_strings':len(freq),'label_strings_mapped':len(tok2),'flagged_ingredients':len(flag),'recognized_no_concern':len(rec),
 'tiers':collections.Counter(d['tier'] for d in flag),'products_by_score':{'0':sum(1 for r in prod_rows if r[7]==0),'1-25':sum(1 for r in prod_rows if 0<r[7]<=25),'26-50':sum(1 for r in prod_rows if 25<r[7]<=50),'51-85':sum(1 for r in prod_rows if 50<r[7]<=85),'86-100':sum(1 for r in prod_rows if r[7]>85)}},open('/home/claude/out/stats.json','w'),indent=1)
print(open('/home/claude/out/stats.json').read())
print('rules with research attached',len(ev),'of',len(R))
print('n groups',len(R)); print('TOP by products:',[(d['name'],d['score'],d['products']) for d in sorted(ING,key=lambda d:-d['products'])[:40]])
ids=collections.Counter(d['id'] for d in ING); print('dup ids',[i for i,c in ids.items() if c>1])
