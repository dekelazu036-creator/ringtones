"""Builds the static Discover pages from sounds/catalog.json:
   discover.html, sound/<slug>.html (one page per sound, for sharing and search engines),
   supabase/seed.sql (loads the official sounds into the database), and the sitemap.
Run after tools/make_sounds.py:  python3 tools/build_discover.py
"""
import html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://snipring.com'
cat = json.load(open(os.path.join(ROOT, 'sounds', 'catalog.json'), encoding='utf-8'))
E = lambda s: html.escape(s or '', quote=True)

TYPE = {'ring': ('רינגטון', 'Ringtone'), 'text': ('צליל הודעה', 'Text tone'), 'alarm': ('שעון מעורר', 'Alarm'), 'sfx': ('אפקט קולי', 'Sound effect'),
        'intro': ('פתיח', 'Intro'), 'outro': ('סגיר', 'Outro'), 'custom': ('קובץ שמע', 'Audio file')}
MOOD = {'calm': ('רגוע', 'Calm'), 'happy': ('שמח', 'Happy'), 'dark': ('אפל', 'Dark'), 'cinematic': ('קולנועי', 'Cinematic'), 'luxury': ('יוקרתי', 'Luxury'),
        'futuristic': ('עתידני', 'Futuristic'), 'funny': ('מצחיק', 'Funny'), 'energetic': ('אנרגטי', 'Energetic'), 'minimal': ('מינימליסטי', 'Minimal'), 'relaxing': ('מרגיע', 'Relaxing')}

def dur(ms):
    s = ms / 1000
    return f'{s:.1f} שנ׳' if s < 10 else f'{int(s // 60)}:{round(s % 60):02d}'

def ic(n, c=''):
    return f'<svg class="ic{(" " + c) if c else ""}" aria-hidden="true"><use href="/icons.svg#i-{n}"/></svg>'

UMAMI = '<script defer src="https://cloud.umami.is/script.js" data-website-id="db897ad6-80a9-43c7-9b29-d7474d5f4b73" data-domains="snipring.com,www.snipring.com"></script>'

def head(title, desc, url, extra=''):
    return f'''<!doctype html>
<html lang="he" dir="rtl" data-root="/">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#F4F6FA">
<link rel="icon" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<script>(()=>{{try{{const v=localStorage.getItem('snipring-theme');if(v==='light'||v==='dark')document.documentElement.dataset.theme=v;const l=localStorage.getItem('snipring-lang');if(l==='en'){{document.documentElement.lang='en';document.documentElement.dir='ltr'}}}}catch(e){{}}}})();</script>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/app.css">
<script src="/config.js"></script>
{UMAMI}
{extra}</head>'''

def shell_top(active):
    tabs = [('/', 'navCreate', 'יצירה', 'create'), ('/discover.html', 'navDiscover', 'גילוי', 'discover'), ('/#mine', 'navMine', 'הצלילים שלי', 'mine')]
    nav = ''.join(f'<a href="{h}" data-i18n="{k}"{" aria-current=\"page\"" if a == active else ""}>{l}</a>' for h, k, l, a in tabs)
    return f'''<a class="skip" href="#main" data-i18n="skip">דלגו לתוכן</a>
<div class="wrap">
  <header class="top">
    <a class="logo" href="/" aria-label="SnipRing" dir="ltr">Snip<span class="ring">Ring</span></a>
    <div class="hbtns">
      <button class="iconbtn" id="themeBtn" type="button">{ic('system')}</button>
      <button class="textbtn" id="lang" type="button">English</button>
    </div>
  </header>
  <nav class="tabs" data-i18n-aria="navAria" aria-label="ניווט ראשי">{nav}</nav>
'''

FOOT = '''  <footer class="sitefoot"><a href="/ringtone-iphone.html" data-i18n="guide">המדריך המלא</a><a href="/terms.html" data-i18n="terms">תנאי שימוש</a><a href="/privacy.html" data-i18n="privacy">מדיניות פרטיות</a><a href="/accessibility.html" data-i18n="aStatement">הצהרת נגישות</a><span dir="ltr">hello@snipring.com</span></footer>
</div>
<script src="/discover.js"></script>
</body>
</html>
'''

# ---------------------------------------------------------------- discover.html
static_list = '\n'.join(f'      <li class="scard static"><a class="stitle" href="/sound/{s["slug"]}.html">{E(s["title_he"])} · {E(s["title_en"])}</a><p class="smeta">{TYPE[s["type"]][0]} · {dur(s["duration_ms"])}</p></li>' for s in cat)
discover = head('גלו צלילים: רינגטונים, צלילי הודעה ושעונים מעוררים | SnipRing',
                'ספריית צלילים מקוריים של SnipRing: רינגטונים, צלילי הודעה, שעונים מעוררים ואפקטים. מקשיבים, מתאימים אישית ומורידים בחינם.',
                SITE + '/discover.html') + f'''
<body data-page="discover">
{shell_top('discover')}
  <main id="main" tabindex="-1" class="discover">
    <section class="card dhead">
      <h1 data-i18n="dH">גלו צלילים</h1>
      <p class="muted" data-i18n="dSub"></p>
      <form id="dSearchForm" class="dsearch" role="search">{ic('search')}<input class="input" type="search" id="dSearch" enterkeyhint="search" autocomplete="off" data-i18n-ph="searchPh" data-i18n-aria="searchAria"></form>
    </section>
    <div class="dfilters">
      <div class="pills" id="dCats" role="group" data-i18n-aria="catAria"></div>
      <div class="pills" id="dMoods" role="group" data-i18n-aria="moodAria"></div>
      <div class="dsel">
        <label class="field"><span class="lbl" data-i18n="sortL"></span><select class="input" id="dSort"><option value="trend" data-i18n="sTrend"></option><option value="new" data-i18n="sNew"></option><option value="pop" data-i18n="sPop"></option><option value="short" data-i18n="sShort"></option></select></label>
        <label class="field"><span class="lbl" data-i18n="durL"></span><select class="input" id="dDur"><option value="any" data-i18n="dAny"></option><option value="s" data-i18n="dS"></option><option value="m" data-i18n="dM"></option><option value="l" data-i18n="dL"></option></select></label>
      </div>
    </div>
    <p class="muted small" id="dCount" aria-live="polite"></p>
    <ul class="dgrid" id="dList">
{static_list}
    </ul>
    <div class="card dempty" id="dEmpty" hidden><p data-i18n="none"></p><button class="btn" id="dClear" type="button" data-i18n="clear"></button></div>
  </main>
{FOOT}'''
open(os.path.join(ROOT, 'discover.html'), 'w', encoding='utf-8').write(discover)

# ---------------------------------------------------------------- sound pages
os.makedirs(os.path.join(ROOT, 'sound'), exist_ok=True)
for s in cat:
    th, te = TYPE[s['type']]
    sec = s['duration_ms'] / 1000
    ld = {'@context': 'https://schema.org', '@type': 'AudioObject', 'name': s['title_en'], 'alternateName': s['title_he'],
          'description': s['description_en'], 'contentUrl': f"{SITE}/{s['audio_path']}", 'encodingFormat': 'audio/mpeg',
          'duration': f'PT{sec:.1f}S', 'genre': te, 'keywords': ', '.join(s['tags'] + s['moods']),
          'creator': {'@type': 'Organization', 'name': 'SnipRing', 'url': SITE}, 'isAccessibleForFree': True,
          'url': f"{SITE}/sound/{s['slug']}.html", 'inLanguage': ['he', 'en']}
    extra = '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>\n'
    moods = ''.join(f'<a class="chip" href="/discover.html?mood={m}" data-he="{MOOD[m][0]}" data-en="{MOOD[m][1]}">{MOOD[m][0]}</a>' for m in s['moods'] if m in MOOD)
    page = head(f"{s['title_he']} · {s['title_en']} | {th} להורדה | SnipRing",
                f"{s['description_he']} {th} מקורי של SnipRing, חינם להורדה ולהתאמה אישית.",
                f"{SITE}/sound/{s['slug']}.html", extra) + f'''
<body data-page="sound" data-sound="{s['slug']}">
{shell_top('discover')}
  <main id="main" tabindex="-1" class="spage">
    <a class="linkbtn back" href="/discover.html">{ic('chevron', 'sm back-ic')}<span data-i18n="back">לכל הצלילים</span></a>
    <article class="card sp">
      <p class="lbl" data-he="{th}" data-en="{te}">{th}</p>
      <h1 data-he="{E(s['title_he'])}" data-en="{E(s['title_en'])}">{E(s['title_he'])}</h1>
      <p class="spdesc" data-he="{E(s['description_he'])}" data-en="{E(s['description_en'])}">{E(s['description_he'])}</p>
      <div class="sphero">
        <button class="play" id="spPlay" type="button" aria-pressed="false" aria-label="השמע">{ic('play')}</button>
        <canvas class="spwave" id="spWave" aria-hidden="true"></canvas>
      </div>
      <dl class="spfacts">
        <div><dt data-i18n="creator">יוצר</dt><dd>SnipRing</dd></div>
        <div><dt data-i18n="duration">אורך</dt><dd class="num" dir="ltr" data-he="{dur(s['duration_ms'])}" data-en="{dur(s['duration_ms']).replace(' שנ׳', ' s')}">{dur(s['duration_ms'])}</dd></div>
        <div><dt data-i18n="category">קטגוריה</dt><dd data-he="{th}" data-en="{te}">{th}</dd></div>
      </dl>
      <p class="muted small" id="spUses" hidden></p>
      <div class="pills sptags">{moods}</div>
      <a class="btn primary lg block" id="spUse" href="/?sound={s['slug']}">{ic('sliders')}<span data-i18n="useBig">השתמש בצליל הזה</span></a>
      <p class="hint" data-i18n="useHint"></p>
      <div class="pair">
        <button class="btn spfav" id="spFav" type="button" aria-pressed="false">{ic('star')}<span data-i18n="cFav">מועדפים</span></button>
        <button class="btn" id="spShare" type="button">{ic('share')}<span data-i18n="share">שיתוף</span></button>
      </div>
      <p class="hint small" data-i18n="license"></p>
    </article>
    <section class="card">
      <h2 data-i18n="similar">צלילים דומים</h2>
      <ul class="dgrid" id="spSimilar"></ul>
    </section>
  </main>
{FOOT}'''
    open(os.path.join(ROOT, 'sound', s['slug'] + '.html'), 'w', encoding='utf-8').write(page)

# ---------------------------------------------------------------- seed.sql
def q(v): return "'" + str(v).replace("'", "''") + "'"
def arr(a): return "array[" + ','.join(q(x) for x in a) + "]::text[]" if a else "'{}'::text[]"
rows = []
for i, s in enumerate(cat):
    rows.append(f"({q(s['slug'])},{q(s['title_he'])},{q(s['title_en'])},{q(s['description_he'])},{q(s['description_en'])},{q(s['type'])}::sound_type,{s['duration_ms']},"
                f"{arr(s['moods'])},{arr(s['tags'])},'official'::sound_origin,'snipring-standard','public'::sound_visibility,'published'::sound_status,"
                f"{q(s['audio_path'])},{q(json.dumps(s['peaks']))}::jsonb,'not_needed',now() - interval '{len(cat) - i} minutes')")
seed = ('-- SnipRing official sounds. Generated by tools/build_discover.py; safe to re-run (updates existing rows, keeps counters).\n'
        'insert into public.sounds (slug,title_he,title_en,description_he,description_en,type,duration_ms,moods,tags,origin,license,visibility,status,audio_path,peaks,copyright_check,published_at) values\n'
        + ',\n'.join(rows) +
        '\non conflict (slug) do update set title_he=excluded.title_he,title_en=excluded.title_en,description_he=excluded.description_he,description_en=excluded.description_en,'
        'type=excluded.type,duration_ms=excluded.duration_ms,moods=excluded.moods,tags=excluded.tags,audio_path=excluded.audio_path,peaks=excluded.peaks,'
        'visibility=excluded.visibility,status=excluded.status;\n'
        "insert into public.sound_sources (sound_id, kind) select id, 'compose' from public.sounds where origin='official' on conflict do nothing;\n"
        f"select count(*) as official_sounds from public.sounds where origin='official';\n")
open(os.path.join(ROOT, 'supabase', 'seed.sql'), 'w', encoding='utf-8').write(seed)

# ---------------------------------------------------------------- sitemap
sm_path = os.path.join(ROOT, 'sitemap.xml'); sm = open(sm_path, encoding='utf-8').read()
sm = re.sub(r'\s*<!-- discover:start -->.*?<!-- discover:end -->', '', sm, flags=re.S)
urls = [f'{SITE}/discover.html'] + [f"{SITE}/sound/{s['slug']}.html" for s in cat]
block = '\n  <!-- discover:start -->\n' + '\n'.join(f'  <url><loc>{u}</loc></url>' for u in urls) + '\n  <!-- discover:end -->\n'
sm = sm.replace('</urlset>', block + '</urlset>')
open(sm_path, 'w', encoding='utf-8').write(sm)
print('discover.html +', len(cat), 'sound pages, seed.sql, sitemap updated')
