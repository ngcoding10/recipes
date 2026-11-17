"""Export the ingredient database into static files for the recipe site.
Reads the build outputs from s5_build.py and writes into the site repo:
  src/data/ingredients.json       every scored ingredient (pages are generated from this)
  src/data/ingredients-lite.json  [id, name, score, class] for client-side lookups
  src/data/scoring.json           rules + splits + aliases so the site can score any label
  public/data/brands.json         brand index: [name, key, products, shard, avg score]
  public/data/p/<shard>.json      products, grouped by brand
  public/data/upc/<nnn>.json      barcode -> shard
"""
import json,pickle,re,collections,os,sys,shutil
sys.path.insert(0,'/home/claude/scripts')
from classify import Classifier,NEG,FUNCTXT,CLEAN,norm
SITE='/home/claude/recipes'
C=Classifier()
ING=json.load(open('/home/claude/out/ingredients_all.json'))
def slug(n): return re.sub(r"[^a-z0-9]+","-",n.lower()).strip('-')
def bkey(b): return re.sub(r"[^A-Z0-9]","",b.upper()) or 'UNBRANDED'
SMALL={'and','or','of','with','in','the','a','for','to','on'}
def smart_title(s):
    s=s.strip()
    letters=[c for c in s if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters)/len(letters)<0.8: return s
    out=[]
    for i,w in enumerate(re.split(r"(\s+|-|/)",s.lower())):
        if not w or re.fullmatch(r"\s+|-|/",w): out.append(w); continue
        if i>0 and w in SMALL: out.append(w); continue
        out.append(w[0].upper()+w[1:])
    return re.sub(r"'S\b","'s","".join(out))
# ---------- ingredients ----------
ids=[d['id'] for d in ING]; idx={i:n for n,i in enumerate(ids)}
assert len(ids)==len(set(ids))
pcols,rows=pickle.load(open('/home/claude/data/prod_rows.pkl','rb'))
pids=pickle.load(open('/home/claude/data/prod_ids.pkl','rb'))
assert len(rows)==len(pids)
extra=json.load(open('/home/claude/data/extra_products.json'))
extra_src={e['product']:e.get('source_url','') for e in extra}
brand_raw=collections.defaultdict(collections.Counter)
for r in rows:
    b=(r[3] or r[2]).strip(); brand_raw[bkey(b)][b]+=1
brand_name={k:smart_title(c.most_common(1)[0][0]) if k!='UNBRANDED' else 'Unbranded' for k,c in brand_raw.items()}
def brand_link(b): k=bkey(b); return [brand_name.get(k,smart_title(b)),k]
out=[]
for d in ING:
    e=dict(d)
    e['top_brands']=[brand_link(b) for b in d['top_brands']]
    e['aliases']=d['aliases'][:24]
    e.pop('match_regex',None); e.pop('flagged',None)
    e['checked']=e.pop('research_checked_against_primary_source')
    out.append(e)
json.dump(out,open(f'{SITE}/src/data/ingredients.json','w'),separators=(',',':'))
json.dump([[d['id'],d['name'],d['score'],d['class']] for d in ING],open(f'{SITE}/src/data/ingredients-lite.json','w'),separators=(',',':'))
# ---------- scoring rules ----------
rules=[]
for i,(name,cls,score,rx,note) in enumerate(C.R):
    subs=C.S.get(i,[])
    rules.append({'name':name,'cls':cls,'score':score,'rx':rx.pattern,'subs':[[n,r.pattern] for n,r in subs],'selfSub':any(n==name for n,_ in subs)})
tm=pickle.load(open('/home/claude/data/tokmaps.pkl','rb'))
off={}
for nm,o in tm['offcanon'].items():
    if slug(nm) not in idx: continue
    for a in o['names']:
        off[norm(a)]=slug(nm)
    if o['e']: off[o['e']]=slug(nm)
eexp={}
for a in C.adds:
    if a['e']:
        eexp.setdefault(a['e'],norm(a['names'][1] if len(a['names'])>1 else a['names'][0]))
import parse as PZ
parsecfg={k:getattr(PZ,k).pattern for k in ['PRE','ALLERG','LEAD','TRAIL','FUNC','KEEPAND']}
json.dump({'parse':parsecfg,'rules':rules,'neg':NEG.pattern,'functxt':FUNCTXT.pattern,'clean':CLEAN.pattern,'off':off,'eexp':eexp},open(f'{SITE}/src/data/scoring.json','w'),separators=(',',':'))
# ---------- products ----------
best={}
for r,ii in zip(rows,pids):
    b=(r[3] or r[2]).strip(); k=bkey(b)
    dk=(k,r[4].strip().upper(),r[16].strip().upper())
    is_extra=not r[1]
    o=best.get(dk)
    if o is None or (is_extra and o[2]==0) or (is_extra==bool(o[2]) and r[6]>o[0][6]):
        best[dk]=(r,ii,1 if is_extra else 0)
print('products',len(rows),'after exact dedupe',len(best))
by_brand=collections.defaultdict(list)
for (k,_,_),(r,ii,ex) in best.items(): by_brand[k].append((r,ii,ex))
# pack brands into shards of ~900 products
TARGET=900
order=sorted(by_brand,key=lambda k:-len(by_brand[k]))
shards=[];cur=[];size=0
for k in order:
    n=len(by_brand[k])
    if size and size+n>TARGET: shards.append(cur); cur=[];size=0
    cur.append(k); size+=n
if cur: shards.append(cur)
pd=f'{SITE}/public/data'
for sub in ('p','upc'):
    shutil.rmtree(f'{pd}/{sub}',ignore_errors=True); os.makedirs(f'{pd}/{sub}')
brands=[]; upcmap=collections.defaultdict(dict); maxsz=0; tot=0
for si,keys in enumerate(shards):
    P=[]
    for bi,k in enumerate(keys):
        L=sorted(by_brand[k],key=lambda x:(-x[2],x[0][7],x[0][4]))
        sc=[x[0][7] for x in L]
        brands.append([brand_name[k],k,len(L),si,round(sum(sc)/len(sc))])
        for r,ii,ex in L:
            upc=r[0].lstrip('0')
            name=smart_title(r[4]) or brand_name[k]
            src=extra_src.get(r[4],'') if ex else ''
            P.append([bi,upc,name,r[5],r[6][:7],r[7],[idx[i] for i in ii if i in idx],r[16].strip(),src])
            if upc and len(upc)>=6: upcmap[upc[-3:].zfill(3)][upc]=si
    s=json.dumps({'b':keys,'p':P},separators=(',',':'),ensure_ascii=False)
    open(f'{pd}/p/{si}.json','w',encoding='utf-8').write(s); maxsz=max(maxsz,len(s)); tot+=len(s)
for k,m in upcmap.items():
    json.dump(m,open(f'{pd}/upc/{k}.json','w'),separators=(',',':'))
brands.sort(key=lambda b:-b[2])
json.dump(brands,open(f'{pd}/brands.json','w'),separators=(',',':'),ensure_ascii=False)
json.dump({'products':len(best),'brands':len(brands),'ingredients':len(ING),'flagged':sum(1 for d in ING if d['score']<=85),'built':'2026-11-17'},open(f'{SITE}/src/data/stats.json','w'))
print('shards',len(shards),'max shard MB',maxsz/1e6,'total MB',tot/1e6,'brands',len(brands),'upc files',len(upcmap))
