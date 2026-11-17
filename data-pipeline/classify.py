import re,pickle,collections,sys,json
def load_rules(path='/home/claude/scripts/rules.txt'):
    R=[]
    for line in open(path,encoding='utf-8'):
        line=line.rstrip('\n')
        if not line.strip() or line.startswith('#'): continue
        parts=[p.strip() for p in line.split(' | ')]
        name,cls,score,note=parts[0],parts[1],int(parts[2]),parts[-1]
        rx=' | '.join(parts[3:-1])
        R.append((name,cls,score,re.compile(rx),note))
    return R
NEG=re.compile(r"\b(NO|FREE|WITHOUT|NOT|NON|ZERO|NEVER|UN|EXCEPT|UNBROMATED|UNBLEACHED|UNENRICHED|UNSWEETENED)\b|NATURALLY OCCURRING|^FREE |UNCURED|ARTIFICIAL INGREDIENTS|ADDED EXCEPT")
def norm(t):
    t=t.upper().replace('&',' AND ').replace('-',' ')
    return re.sub(r"\s+"," ",re.sub(r"[^A-Z0-9'%/. ]"," ",t)).strip(" .'/")
CLEAN=re.compile(r"\b(WATER|SALT|MILK|CREAM|BUTTER(FAT|MILK)?|CHEESE|EGGS?|YOLKS?|WHITES?|YOGURT|WHEY|LACTOSE|GHEE|KEFIR|CURD|WHEAT|FLOUR|OATS?|OATMEAL|RICE|CORN|MASA|MAIZE|BARLEY|RYE|SPELT|QUINOA|MILLET|SORGHUM|AMARANTH|BUCKWHEAT|TEFF|BRAN|GERM|GLUTEN|SEMOLINA|DURUM|FARINA|GRITS|POLENTA|STARCH|TAPIOCA|CASSAVA|ARROWROOT|POTATO(ES)?|YAMS?|BEANS?|PEAS?|LENTILS?|CHICKPEAS?|GARBANZO|SOY(BEANS?|A)?|TOFU|TEMPEH|EDAMAME|PEANUTS?|ALMONDS?|CASHEWS?|WALNUTS?|PECANS?|HAZELNUTS?|PISTACHIOS?|MACADAMIAS?|NUTS?|COCONUT|SEEDS?|SESAME|TAHINI|FLAX(SEED)?|CHIA|HEMP|SUNFLOWER|PUMPKIN|POPPY|QUINOA|COCOA|CACAO|CHOCOLATE|COFFEE|TEA|ESPRESSO|MATCHA|VANILLA|CINNAMON|PEPPERS?|PEPPERCORNS?|CHIL[IE]S?|CHILLI|JALAPENOS?|HABANERO|CHIPOTLE|CAYENNE|PAPRIKA|GARLIC|ONIONS?|SHALLOTS?|LEEKS?|SCALLIONS?|CHIVES?|GINGER|TURMERIC|CUMIN|CORIANDER|CILANTRO|PARSLEY|BASIL|OREGANO|THYME|ROSEMARY|SAGE|DILL|MINT|PEPPERMINT|SPEARMINT|MARJORAM|TARRAGON|BAY|FENNEL|ANISE|CARDAMOM|CLOVES?|NUTMEG|MACE|ALLSPICE|MUSTARD|HORSERADISH|WASABI|SAFFRON|SUMAC|SPICES?|HERBS?|SEASONINGS?|TOMATO(ES)?|CARROTS?|CELERY|SPINACH|KALE|BROCCOLI|CAULIFLOWER|CABBAGE|LETTUCE|CUCUMBERS?|PICKLES?|ZUCCHINI|SQUASH|EGGPLANT|MUSHROOMS?|OLIVES?|CAPERS?|ARTICHOKES?|ASPARAGUS|BEETS?|RADISH(ES)?|TURNIPS?|PARSNIPS?|OKRA|AVOCADOS?|VEGETABLES?|GREENS|SEAWEED|NORI|KELP|APPLES?|PEARS?|PEACH(ES)?|PLUMS?|PRUNES?|APRICOTS?|CHERR(Y|IES)|GRAPES?|RAISINS?|CURRANTS?|BERR(Y|IES)|STRAWBERR(Y|IES)|BLUEBERR(Y|IES)|RASPBERR(Y|IES)|BLACKBERR(Y|IES)|CRANBERR(Y|IES)|ELDERBERR(Y|IES)|ACAI|GOJI|BANANAS?|PLANTAINS?|ORANGES?|LEMONS?|LIMES?|GRAPEFRUIT|TANGERINES?|MANDARINS?|CITRUS|PINEAPPLES?|MANGO(ES)?|PAPAYA|GUAVA|PASSION ?FRUIT|KIWI|MELONS?|WATERMELON|CANTALOUPE|POMEGRANATE|FIGS?|DATES?|FRUITS?|JUICE|PUREE|PULP|PEEL|ZEST|VINEGAR|YEAST|SOURDOUGH|BEEF|PORK|CHICKEN|TURKEY|LAMB|VEAL|DUCK|BISON|VENISON|MEAT|FISH|SALMON|TUNA|COD|POLLOCK|TILAPIA|ANCHOV(Y|IES)|SARDINES?|SHRIMP|CRAB|LOBSTER|CLAMS?|OYSTERS?|MUSSELS?|SCALLOPS?|SQUID|BROTH|STOCK|BOUILLON|GELATIN|BREAD|BREADCRUMBS?|CRUMBS?|PASTA|NOODLES?|MACARONI|TORTILLA|CRACKERS?|COOKIES?|PRETZELS?|CHIPS?|GRANOLA|CEREAL|CRISPS?|WAFERS?|CONES?|DOUGH|CRUST|BATTER|BREADING|FILLING|SAUCE|PASTE|KETCHUP|MAYONNAISE|DRESSING|SALSA|PESTO|HUMMUS|RELISH|JAM|JELLY|PRESERVES|MISO|TAMARI|WORCESTERSHIRE|SRIRACHA|TAMARIND|KOMBU|KIMCHI|SAUERKRAUT|NECTAR|CIDER|MUST|EXTRACT|ESSENCE|OIL|POWDER|CORNSTARCH|MILKFAT|POPCORN|MALT|CORNMEAL|PARMESAN|CHEDDAR|MOZZARELLA|ROMANO|ASIAGO|RICOTTA|PROVOLONE|COLBY|SWISS|MONTEREY JACK|BIFIDUS|BIFIDUM|LACTIS|RHAMNOSUS|PARACASEI|ASPERGILLUS|PENICILLIUM|KOJI|RAPESEED|PEPITAS|FILBERTS|HALF AND HALF|SHEA|CASEIN|SODIUM CHLORIDE|CO2|HOPS|HIBISCUS|CHAMOMILE|LAVENDER|L (LEUCINE|ISOLEUCINE|VALINE|GLUTAMINE|LYSINE|TYROSINE|TRYPTOPHAN|METHIONINE)|GLYCINE|BROMELAIN|PAPAIN|CELLULASE|XYLANASE|PIMI?ENTOS?|CAPSICUM|OLEORESIN|CHARD|ROMAINE|ARUGULA|RADICCHIO|MIZUNA|TATSOI|FRISEE|ENDIVE|MACHE|WATERCRESS|BOK CHOY|TRITICALE|FARRO|COUSCOUS|PANKO|FENUGREEK|GALANGAL|CARAWAY|SAVORY|LEMONGRASS|TOMATILLOS?|RHUBARB|TARO|CAROB|ALFALFA|CHLORELLA|DULSE|NIGARI|BRINE|APPLESAUCE|SURIMI|CRABMEAT|HADDOCK|FLOUNDER|MACKEREL|MIREPOIX|GUACAMOLE|GRAVY|CROUTONS|CROISSANT|MEATBALLS|CAKE|CELERIAC|ROSE ?HIPS?|BUTTEROIL|SELENIUM|PHYLLOQUINONE|NICOTINAMIDE|GLUCONIC ACID|SUCCINATE|TRIGLYCERIDES|GRAINS?|BLEND|MIX|BASE|PIECES|FLAKES|GRANULES|BITS|CHUNKS|NIBS|MASS|SOLIDS|KOMBUCHA|CARBONATION|CARBON DIOXIDE|NITROGEN|OXYGEN|ICE|STEAM|AIR)\b")
FUNCTXT=re.compile(r"INHIBITOR|ANTI ?(CAKING|CAKE|STICKING|FOAMING)|^AS |^TO |^FOR |PRESERVATIVES?$|\\bAGENTS?$|ACIDIFIER|ACIDITY|^(DRIED|BONELESS|LIQUID|GRANULAR|DISTILLED|DEHYDRATED|ROASTED|WHOLE|REDUCED|CULTURED|HYDROLYZED|UNSALTED|SALTED|REFINED|GROUND|HOT|FORMED|ARTIFICIAL|MONO|METHYL|RED|BLUE|YELLOW|GREEN|BLACK|BROWN|ACIDS?|VIT|CONCENTRATE|FROM CONCENTRATE|PROTEIN|FATS?|INGREDIENTS|USA|U\\.S|LEAF|CANE|SODIUM|POTASSIUM|CALCIUM|MAGNESIUM|MICROBIAL|VEGAN|B\\d+|D\\d|LACTIC|ARABIC|SODA|OILS|GUMS)$|MAY CONTAIN|PROVIDES|CONTROLS|CERTIFIED|SUFFICIENT|INGREDIENTS MAY|PHENYLKETONURIC|ELECTROLYTES?( SOURCES?)?$|ENRICHMENT|LEAVENINGS?$|^STARTER$|FLOW (AID|AGENT)|PLANT DERIVED|VEGAN SOURCES|TRIPOLY|HEXAMETA")
def load_off_foods():
    S=set()
    for line in open('/home/claude/data/off_food_ingredients.txt',encoding='utf-8',errors='replace'):
        if line.startswith('en:'):
            for n in line[3:].split(','):
                n=norm(n)
                if n: S.add(n)
    return S
def load_off_additives():
    """returns list of dicts: e, names[], classes"""
    out=[];cur=None
    for line in open('/home/claude/data/off_additives.txt',encoding='utf-8',errors='replace'):
        line=line.rstrip('\n')
        if not line.strip():
            if cur and cur.get('names'): out.append(cur)
            cur=None; continue
        if line.startswith('#') or line.startswith('<') or line.startswith('synonyms') or line.startswith('stopwords'): continue
        if cur is None: cur={'names':[],'e':'','classes':'','efsa_risk':''}
        if line.startswith('en:') and not cur['names']:
            ns=[x.strip() for x in line[3:].split(',') if x.strip()]
            cur['names']=ns
        elif line.startswith('e_number:en:'): cur['e']='E'+line.split(':',2)[2].strip()
        elif line.startswith('additives_classes:en:'): cur['classes']=line.split(':',2)[2].strip().replace('en:','')
        elif line.startswith('efsa_evaluation_overexposure_risk:en:'): cur['efsa_risk']=line.split(':',2)[2].strip().replace('en:','')
    if cur and cur.get('names'): out.append(cur)
    return out
def load_splits(R,path='/home/claude/scripts/splits.txt'):
    idx={r[0]:i for i,r in enumerate(R)}; S={}
    for line in open(path,encoding='utf-8'):
        line=line.strip()
        if not line: continue
        parent,rest=line.split(' :: ',1)
        if parent not in idx: raise SystemExit('split parent not found: '+parent)
        subs=[]
        for part in rest.split(' ;; '):
            n,rx=part.split('=',1); subs.append((n.strip(),re.compile(rx.strip())))
        S[idx[parent]]=subs
    return S
class Classifier:
    def __init__(self):
        self.R=load_rules()
        self.S=load_splits(self.R)
        self.foods=load_off_foods()
        self.adds=load_off_additives()
        self.ealias={}
        for a in self.adds:
            for n in a['names']:
                self.ealias.setdefault(norm(n),a)
            if a['e']: self.ealias.setdefault(a['e'],a)
    def is_clean(self,tok):
        t=norm(tok)
        if t in self.foods or (t.endswith('S') and t[:-1] in self.foods) or (t.endswith('ES') and t[:-2] in self.foods): return True
        return bool(CLEAN.search(t))
    def off_additive(self,tok):
        t=norm(tok); t2=re.sub(r"^E (\d)",r"E\1",t)
        return self.ealias.get(t) or self.ealias.get(t2)
    def classify(self,tok):
        """returns list of rule indexes matched (priority order, text consumed)"""
        t=norm(tok)
        if NEG.search(t): return [],t,True
        t=re.sub(r'THIAMINE? (MONO ?)?NITRATE','THIAMINE',t)
        t=re.sub(r'\b((RED|YELLOW|BLUE|GREEN|ORANGE) \d+) (ALUMINUM )?LAKES?\b',r'\1',t)
        if re.match(r"^E ?\d{3,4}[A-Z]?$",t):
            a=self.ealias.get(t.replace(' ',''))
            if a: t=norm(a['names'][1] if len(a['names'])>1 else a['names'][0])+' '+t.replace(' ','')
        hits=[]; t0=t
        for i,(name,cls,score,rx,note) in enumerate(self.R):
            if hits and name.startswith('Color (type not stated)'): continue
            m=rx.search(t)
            if m:
                sub=''
                for sn,srx in self.S.get(i,[]):
                    if srx.search(t0): sub=sn; break
                hits.append((i,sub))
                t=rx.sub(' ',t); t=re.sub(r"\s+"," ",t).strip()
                if not re.search(r"[A-Z]{3}",t): break
        return hits,t,False
