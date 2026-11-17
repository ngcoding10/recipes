import pickle,re,csv,collections,json
pcols,rows=pickle.load(open('/home/claude/data/prod_rows.pkl','rb'))
txt=[(' '+(r[2]+' | '+r[3]+' | '+r[4]).upper()+' ') for r in rows]
brands=[]
for line in open('/home/claude/scripts/brands.txt',encoding='utf-8'):
    line=line.strip()
    if not line or line.startswith('#'): continue
    for b in line.split(';'):
        if b.strip(): brands.append(b.strip().split('|'))
seen=set(); B=[]
for b in brands:
    if b[0] not in seen: seen.add(b[0]); B.append(b)
out=[]
NEX=sum(1 for r in rows if not r[1])
for b in B:
    rx=re.compile(r"(?<![A-Z0-9])("+"|".join(re.escape(x) for x in b)+r")(?![A-Z0-9])")
    idx=[i for i,t in enumerate(txt) if any(x in t for x in b) and rx.search(t)]
    n=len(idx); n26=sum(1 for i in idx if not rows[i][1])
    yrs=[rows[i][6][:4] for i in idx if rows[i][1]]
    sc=[rows[i][7] for i in idx]
    out.append([b[0].title(),n,n26,max(yrs) if yrs else '',round(sum(sc)/n,1) if n else '',sum(1 for s in sc if s==0),'OK' if n>=5 else ('THIN' if n else 'MISSING')])
with open('/home/claude/out/brand_coverage.csv','w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['brand','products_in_database','of_which_2026_label_check','newest_usda_label_year','avg_ingredient_score','products_scoring_0','status']); w.writerows(sorted(out,key=lambda r:(r[6]!='MISSING',r[6]!='THIN',-r[1])))
print(len(B),'brands;',collections.Counter(r[6] for r in out))
print('MISSING:',[r[0] for r in out if r[6]=='MISSING'])
print('THIN:',[(r[0],r[1]) for r in out if r[6]=='THIN'])
print('STALE (newest <=2020):',[(r[0],r[3]) for r in out if r[3] and r[3]<='2020' and r[2]==0][:80])
