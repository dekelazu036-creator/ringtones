/* SnipRing Discover: gallery of ready-made sounds + individual sound pages.
   Data: sounds/catalog.json (official sounds, always available, works offline)
         + Supabase (live play/use counts, trending order, and later community sounds).
   No secrets here: the Supabase publishable key is public by design; access is limited by row-level security. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const CFG = Object.assign({ supabaseUrl: '', supabaseKey: '' }, window.SNIPRING_CONFIG || {});
const ROOT = document.documentElement.dataset.root || '/';
const OWNER = (() => { try { return localStorage.getItem('umami.disabled') === '1' } catch (e) { return false } })();
function track(n, d) { try { window.umami && window.umami.track(n, d) } catch (e) {} }

/* ---------- language ---------- */
let lang = (() => { try { const v = localStorage.getItem('snipring-lang'); if (v === 'he' || v === 'en') return v } catch (e) {} return /^he|^iw/i.test(navigator.language || '') ? 'he' : 'en' })();
const T = {
  he: {
    navCreate: 'יצירה', navDiscover: 'גילוי', navMine: 'הצלילים שלי', navAria: 'ניווט ראשי', skip: 'דלגו לתוכן',
    dH: 'גלו צלילים', dSub: 'רינגטונים, צלילי הודעה, שעונים מעוררים ואפקטים מקוריים של SnipRing. מקשיבים, בוחרים ומתאימים אישית.',
    searchPh: 'חפשו: שעון רגוע, התראה עתידנית, מצחיק…', searchAria: 'חיפוש צלילים',
    cAll: 'הכל', cRing: 'רינגטונים', cText: 'צלילי הודעה', cAlarm: 'שעונים מעוררים', cSfx: 'אפקטים', cIO: 'פתיחים וסיומים', cFav: 'מועדפים',
    catAria: 'קטגוריה', moodAria: 'אווירה', sortL: 'מיון', durL: 'אורך',
    sTrend: 'מומלצים', sNew: 'חדשים', sPop: 'הכי בשימוש', sShort: 'קצרים קודם',
    dAny: 'כל אורך', dS: 'קצר (עד 3 שנ׳)', dM: 'בינוני (3–15 שנ׳)', dL: 'ארוך (מעל 15 שנ׳)',
    count: '{n} צלילים', count1: 'צליל אחד', none: 'לא מצאנו צלילים כאלה. נסו מילה אחרת או נקו את הסינון.', clear: 'ניקוי סינון',
    use: 'השתמש', useAria: 'השתמש בצליל: {n}', play: 'השמע: {n}', pause: 'עצור: {n}', fav: 'הוספה למועדפים: {n}', unfav: 'הסרה מהמועדפים: {n}',
    uses: '{n} שימושים', uses1: 'שימוש אחד', by: 'SnipRing', sec: 'שנ׳',
    t_ring: 'רינגטון', t_text: 'צליל הודעה', t_alarm: 'שעון מעורר', t_sfx: 'אפקט קולי', t_intro: 'פתיח', t_outro: 'סגיר', t_custom: 'קובץ שמע',
    m_calm: 'רגוע', m_happy: 'שמח', m_dark: 'אפל', m_cinematic: 'קולנועי', m_luxury: 'יוקרתי', m_futuristic: 'עתידני', m_funny: 'מצחיק', m_energetic: 'אנרגטי', m_minimal: 'מינימליסטי', m_relaxing: 'מרגיע',
    share: 'שיתוף', copied: 'הקישור הועתק', similar: 'צלילים דומים', back: 'לכל הצלילים', creator: 'יוצר', duration: 'אורך', category: 'קטגוריה', tags: 'תגיות',
    useBig: 'השתמש בצליל הזה', useHint: 'הצליל ייפתח בעורך: אפשר לקצר, להוסיף אפקטים ולהוריד כרינגטון, כשעון או כצליל הודעה.',
    license: 'צליל מקורי של SnipRing. מותר לשימוש אישי, גם כרינגטון וגם בסרטונים שלכם.',
    report: 'דיווח על בעיה', langBtn: 'English', theme: 'ערכת צבעים', th_system: 'לפי המערכת', th_light: 'בהירה', th_dark: 'כהה',
    terms: 'תנאי שימוש', privacy: 'מדיניות פרטיות', aStatement: 'הצהרת נגישות', guide: 'המדריך המלא'
  },
  en: {
    navCreate: 'Create', navDiscover: 'Discover', navMine: 'My sounds', navAria: 'Main navigation', skip: 'Skip to content',
    dH: 'Discover sounds', dSub: 'Original SnipRing ringtones, text tones, alarms and effects. Listen, pick one and make it yours.',
    searchPh: 'Search: calm alarm, futuristic notification, funny…', searchAria: 'Search sounds',
    cAll: 'All', cRing: 'Ringtones', cText: 'Text tones', cAlarm: 'Alarms', cSfx: 'Effects', cIO: 'Intros & outros', cFav: 'Favourites',
    catAria: 'Category', moodAria: 'Mood', sortL: 'Sort', durL: 'Length',
    sTrend: 'Recommended', sNew: 'Newest', sPop: 'Most used', sShort: 'Shortest first',
    dAny: 'Any length', dS: 'Short (up to 3 s)', dM: 'Medium (3–15 s)', dL: 'Long (over 15 s)',
    count: '{n} sounds', count1: '1 sound', none: 'No sounds match. Try another word or clear the filters.', clear: 'Clear filters',
    use: 'Use', useAria: 'Use sound: {n}', play: 'Play: {n}', pause: 'Pause: {n}', fav: 'Add to favourites: {n}', unfav: 'Remove from favourites: {n}',
    uses: '{n} uses', uses1: '1 use', by: 'SnipRing', sec: 's',
    t_ring: 'Ringtone', t_text: 'Text tone', t_alarm: 'Alarm', t_sfx: 'Sound effect', t_intro: 'Intro', t_outro: 'Outro', t_custom: 'Audio file',
    m_calm: 'Calm', m_happy: 'Happy', m_dark: 'Dark', m_cinematic: 'Cinematic', m_luxury: 'Luxury', m_futuristic: 'Futuristic', m_funny: 'Funny', m_energetic: 'Energetic', m_minimal: 'Minimal', m_relaxing: 'Relaxing',
    share: 'Share', copied: 'Link copied', similar: 'Similar sounds', back: 'All sounds', creator: 'Creator', duration: 'Length', category: 'Category', tags: 'Tags',
    useBig: 'Use this sound', useHint: 'It opens in the editor: trim it, add effects, and download it as a ringtone, alarm or text tone.',
    license: 'An original SnipRing sound. Free for personal use, as a ringtone or in your own videos.',
    report: 'Report a problem', langBtn: 'עברית', theme: 'Colour theme', th_system: 'System', th_light: 'Light', th_dark: 'Dark',
    terms: 'Terms of Use', privacy: 'Privacy Policy', aStatement: 'Accessibility statement', guide: 'Full guide'
  }
};
const t = (k, n) => { let s = (T[lang] && T[lang][k]) || T.en[k] || k; if (n != null) s = s.replace('{n}', n); return s };
/* words people type, mapped to types and moods, in both languages */
const TYPE_WORDS = {
  ring: 'רינגטון רינגטונים צלצול צלצולים שיחה ringtone ringtones ring call', text: 'התראה התראות הודעה הודעות נוטיפיקציה צליל הודעה notification notifications text message sms alert',
  alarm: 'שעון מעורר שעונים השכמה בוקר להתעורר alarm alarms wake morning clock', sfx: 'אפקט אפקטים אפקט קולי sound effect effects sfx',
  intro: 'פתיח פתיחה intro opener opening', outro: 'סגיר סיום outro ending end', custom: 'קובץ שמע audio file'
};

function applyLang() {
  const he = lang === 'he', r = document.documentElement;
  r.lang = lang; r.dir = he ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n) });
  document.querySelectorAll('[data-i18n-aria]').forEach(e => e.setAttribute('aria-label', t(e.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-ph]').forEach(e => e.setAttribute('placeholder', t(e.dataset.i18nPh)));
  document.querySelectorAll('[data-he]').forEach(e => { e.textContent = he ? e.dataset.he : e.dataset.en });
  if ($('lang')) $('lang').textContent = t('langBtn');
  paintTheme();
}

/* ---------- theme (same storage key as the main app) ---------- */
const THEMES = ['system', 'light', 'dark'];
let theme = 'system'; try { theme = localStorage.getItem('snipring-theme') || 'system' } catch (e) {}
function paintTheme() {
  const r = document.documentElement; if (theme === 'system') delete r.dataset.theme; else r.dataset.theme = theme;
  const b = $('themeBtn'); if (!b) return;
  b.querySelector('use').setAttribute('href', ROOT + 'icons.svg#i-' + (theme === 'system' ? 'system' : theme === 'light' ? 'sun' : 'moon'));
  b.setAttribute('aria-label', t('theme') + ': ' + t('th_' + theme)); b.title = b.getAttribute('aria-label');
  document.querySelectorAll('canvas.swave,canvas.spwave').forEach(c => c._draw && c._draw());
}

/* ---------- data ---------- */
let SOUNDS = [], live = {}, trend = [];
const sb = (path, body) => fetch(CFG.supabaseUrl + path, {
  method: body ? 'POST' : 'GET', headers: Object.assign({ apikey: CFG.supabaseKey }, body ? { 'Content-Type': 'application/json' } : {}),
  body: body ? JSON.stringify(body) : undefined, keepalive: !!body
});
async function loadData() {
  const cat = await fetch(ROOT + 'sounds/catalog.json').then(r => r.json()).catch(() => []);
  SOUNDS = cat.map((s, i) => Object.assign({ order: i, owner: null }, s));
  if (!CFG.supabaseUrl) return;
  try {
    const [rows, tr] = await Promise.all([
      sb('/rest/v1/sounds?select=slug,title_he,title_en,description_he,description_en,type,duration_ms,moods,tags,origin,audio_path,peaks,plays,uses,favorites,published_at,owner_id&visibility=eq.public&limit=500').then(r => r.ok ? r.json() : []),
      sb('/rest/v1/rpc/trending_sounds', { p_limit: 100 }).then(r => r.ok ? r.json() : [])
    ]);
    rows.forEach(r => { live[r.slug] = r; if (!SOUNDS.some(s => s.slug === r.slug)) SOUNDS.push(Object.assign({ order: SOUNDS.length, owner: r.owner_id }, r)) });
    trend = tr.map(r => r.slug);
  } catch (e) { /* offline or not configured: the official catalog still works */ }
}
const uses = s => (live[s.slug] && live[s.slug].uses) || 0;
const playedThisSession = new Set();
function bump(slug, kind) {
  if (!CFG.supabaseUrl || OWNER) return;
  if (kind === 'play') { if (playedThisSession.has(slug)) return; playedThisSession.add(slug) }
  try { sb('/rest/v1/rpc/bump_sound', { p_slug: slug, p_kind: kind }).catch(() => {}) } catch (e) {}
}

/* ---------- favourites (on this device until accounts exist) ---------- */
let favs = new Set(); try { favs = new Set(JSON.parse(localStorage.getItem('snipring-favs') || '[]')) } catch (e) {}
function toggleFav(slug) { favs.has(slug) ? favs.delete(slug) : favs.add(slug); try { localStorage.setItem('snipring-favs', JSON.stringify([...favs])) } catch (e) {} track('sound_favorite', { on: favs.has(slug) ? 'yes' : 'no' }) }

/* ---------- formatting ---------- */
const title = s => lang === 'he' ? s.title_he : s.title_en;
const desc = s => lang === 'he' ? s.description_he : s.description_en;
function dur(ms) { const sec = ms / 1000; if (sec < 10) return sec.toFixed(1) + ' ' + t('sec'); const m = Math.floor(sec / 60), r = Math.round(sec % 60); return m + ':' + String(r).padStart(2, '0') }
const usesText = n => n === 1 ? t('uses1') : t('uses', n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US'));
const icon = (n, c) => '<svg class="ic' + (c ? ' ' + c : '') + '" aria-hidden="true"><use href="' + ROOT + 'icons.svg#i-' + n + '"/></svg>';

/* ---------- waveform from stored peaks ---------- */
function waveCanvas(c, peaks, getProgress) {
  const draw = () => {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; if (!w) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement), acc = cs.getPropertyValue('--accent').trim(), base = cs.getPropertyValue('--wave').trim();
    const n = peaks.length, bw = w / n, p = getProgress ? getProgress() : 0;
    for (let i = 0; i < n; i++) {
      const v = Math.max(.06, peaks[i]), bh = v * (h - 2);
      g.fillStyle = (i + .5) / n <= p ? acc : base;
      g.fillRect(i * bw + bw * .18, (h - bh) / 2, Math.max(1, bw * .64), bh);
    }
  };
  c._draw = draw; draw();
  return draw;
}

/* ---------- one player for the whole page ---------- */
const audio = new Audio(); audio.preload = 'none';
let current = null, raf = 0;
function setPlayUI(slug, on) {
  document.querySelectorAll('[data-play="' + slug + '"]').forEach(b => {
    b.querySelector('use').setAttribute('href', ROOT + 'icons.svg#i-' + (on ? 'pause' : 'play'));
    b.setAttribute('aria-pressed', String(on));
    const s = SOUNDS.find(x => x.slug === slug); if (s) b.setAttribute('aria-label', t(on ? 'pause' : 'play', title(s)));
  });
}
function progressLoop() {
  cancelAnimationFrame(raf);
  const step = () => { document.querySelectorAll('[data-wave="' + current + '"]').forEach(c => c._draw && c._draw()); if (!audio.paused) raf = requestAnimationFrame(step) };
  step();
}
function toggle(s) {
  if (current === s.slug && !audio.paused) { audio.pause(); return }
  if (current !== s.slug) {
    if (current) { setPlayUI(current, false); const old = current; current = null; document.querySelectorAll('[data-wave="' + old + '"]').forEach(c => c._draw && c._draw()) }
    current = s.slug; audio.src = /^https?:/.test(s.audio_path) ? s.audio_path : ROOT + s.audio_path;
  }
  audio.play().then(() => { bump(s.slug, 'play'); track('sound_played', { slug: s.slug, type: s.type }) }).catch(() => {});
}
audio.addEventListener('play', () => { if (current) { setPlayUI(current, true); progressLoop() } });
audio.addEventListener('pause', () => { if (current) setPlayUI(current, false) });
audio.addEventListener('ended', () => { if (current) { setPlayUI(current, false); const c = current; document.querySelectorAll('[data-wave="' + c + '"]').forEach(x => x._draw && x._draw()) } });
const progOf = slug => () => (current === slug && audio.duration) ? audio.currentTime / audio.duration : 0;

/* ---------- a sound card (used by the gallery and by "similar sounds") ---------- */
function card(s) {
  const li = document.createElement('li'); li.className = 'scard';
  const n = title(s), u = uses(s);
  li.innerHTML =
    '<button class="splay" type="button" data-play="' + s.slug + '" aria-pressed="false">' + icon('play') + '</button>' +
    '<a class="stitle" href="' + ROOT + 'sound/' + s.slug + '.html"><bdi></bdi></a>' +
    '<p class="smeta"><span></span><span class="dot" aria-hidden="true">·</span><span class="num" dir="ltr"></span><span class="dot" aria-hidden="true">·</span><span>' + t('by') + '</span>' + (u ? '<span class="dot" aria-hidden="true">·</span><span class="suses"></span>' : '') + '</p>' +
    '<button class="iconbtn sm sfav" type="button" aria-pressed="false">' + icon('star') + '</button>' +
    '<canvas class="swave" data-wave="' + s.slug + '" aria-hidden="true"></canvas>' +
    '<a class="btn primary suse" href="' + ROOT + '?sound=' + s.slug + '">' + t('use') + '</a>';
  li.querySelector('bdi').textContent = n;
  const sp = li.querySelectorAll('.smeta span'); sp[0].textContent = t('t_' + s.type); sp[2].textContent = dur(s.duration_ms);
  if (u) li.querySelector('.suses').textContent = usesText(u);
  const pb = li.querySelector('.splay'); pb.setAttribute('aria-label', t('play', n)); pb.addEventListener('click', () => toggle(s));
  const fb = li.querySelector('.sfav'), paintFav = () => { const on = favs.has(s.slug); fb.setAttribute('aria-pressed', String(on)); fb.classList.toggle('on', on); fb.setAttribute('aria-label', t(on ? 'unfav' : 'fav', n)) };
  paintFav(); fb.addEventListener('click', () => { toggleFav(s.slug); paintFav(); if (state.cat === 'fav') render() });
  li.querySelector('.suse').setAttribute('aria-label', t('useAria', n));
  li.querySelector('.suse').addEventListener('click', () => track('sound_use_clicked', { slug: s.slug, type: s.type, where: document.body.dataset.page }));
  requestAnimationFrame(() => waveCanvas(li.querySelector('canvas'), s.peaks || [], progOf(s.slug)));
  if (current === s.slug && !audio.paused) setTimeout(() => setPlayUI(s.slug, true));
  return li;
}

/* ---------- gallery ---------- */
const CATS = [['all', 'cAll', () => true], ['ring', 'cRing', s => s.type === 'ring'], ['text', 'cText', s => s.type === 'text'], ['alarm', 'cAlarm', s => s.type === 'alarm'],
  ['sfx', 'cSfx', s => s.type === 'sfx'], ['io', 'cIO', s => s.type === 'intro' || s.type === 'outro'], ['fav', 'cFav', s => favs.has(s.slug)]];
const state = { q: '', cat: 'all', mood: '', sort: 'trend', dur: 'any' };
function readURL() { const q = new URLSearchParams(location.search); state.q = q.get('q') || ''; state.cat = CATS.some(c => c[0] === q.get('cat')) ? q.get('cat') : 'all'; state.mood = q.get('mood') || '' }
function writeURL() {
  const q = new URLSearchParams(); if (state.q) q.set('q', state.q); if (state.cat !== 'all') q.set('cat', state.cat); if (state.mood) q.set('mood', state.mood);
  try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')) } catch (e) {}
}
const norm = x => (x || '').toLowerCase().normalize('NFKD').replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ');
function hay(s) {
  return norm([s.title_he, s.title_en, s.description_he, s.description_en, (s.tags || []).join(' '), (s.moods || []).map(m => T.he['m_' + m] + ' ' + T.en['m_' + m] + ' ' + m).join(' '),
    TYPE_WORDS[s.type] || '', T.he['t_' + s.type], T.en['t_' + s.type]].join(' '));
}
function score(s, q) {
  const words = norm(q).split(/\s+/).filter(w => w.length > 1); if (!words.length) return 1;
  const h = hay(s); let sc = 0;
  for (const w of words) {
    if (h.includes(w)) sc += norm(title(s)).includes(w) ? 3 : 2;
    else if (/^[הובלמשכ]/.test(w) && w.length > 3 && h.includes(w.slice(1))) sc += 1.5; // Hebrew prefixes: "לבוקר" → "בוקר"
  }
  return sc;
}
function render() {
  const list = $('dList'); if (!list) return;
  const catFn = CATS.find(c => c[0] === state.cat)[2];
  let rows = SOUNDS.filter(catFn).filter(s => !state.mood || (s.moods || []).includes(state.mood))
    .filter(s => state.dur === 'any' || (state.dur === 's' ? s.duration_ms <= 3000 : state.dur === 'm' ? s.duration_ms > 3000 && s.duration_ms <= 15000 : s.duration_ms > 15000))
    .map(s => ({ s, sc: score(s, state.q) })).filter(x => x.sc > 0);
  const tr = s => { const i = trend.indexOf(s.slug); return i < 0 ? 1e6 + s.order : i };
  rows.sort((a, b) => (b.sc - a.sc) ||
    (state.sort === 'new' ? (Date.parse(b.s.published_at || 0) - Date.parse(a.s.published_at || 0)) || (b.s.order - a.s.order)
      : state.sort === 'pop' ? (uses(b.s) - uses(a.s)) || (a.s.order - b.s.order)
      : state.sort === 'short' ? a.s.duration_ms - b.s.duration_ms
      : (tr(a.s) - tr(b.s))));
  list.textContent = ''; rows.forEach(x => list.appendChild(card(x.s)));
  $('dCount').textContent = rows.length === 1 ? t('count1') : t('count', rows.length);
  $('dEmpty').hidden = !!rows.length;
  renderPills(); writeURL();
}
function pill(label, on, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label; b.classList.toggle('sel-on', on); b.setAttribute('aria-pressed', String(on)); b.addEventListener('click', fn); return b }
function renderPills() {
  const c = $('dCats'); c.textContent = '';
  CATS.forEach(([k, l, fn]) => { if (k === 'fav' && !favs.size) return; if (k !== 'all' && k !== 'fav' && !SOUNDS.some(fn)) return; c.appendChild(pill(t(l), state.cat === k, () => { state.cat = k; render(); track('discover_filter', { cat: k }) })) });
  const m = $('dMoods'); m.textContent = '';
  const moods = [...new Set(SOUNDS.flatMap(s => s.moods || []))].filter(x => T.en['m_' + x]);
  moods.forEach(x => m.appendChild(pill(t('m_' + x), state.mood === x, () => { state.mood = state.mood === x ? '' : x; render(); track('discover_filter', { mood: x }) })));
}
function initGallery() {
  readURL();
  const inp = $('dSearch'); inp.value = state.q;
  let deb = 0; inp.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.q = inp.value.trim(); render(); if (state.q.length > 2) track('discover_search', { q: state.q.slice(0, 40) }) }, 180) });
  $('dSearchForm').addEventListener('submit', e => { e.preventDefault(); inp.blur() });
  $('dSort').addEventListener('change', e => { state.sort = e.target.value; render() });
  $('dDur').addEventListener('change', e => { state.dur = e.target.value; render() });
  $('dClear').addEventListener('click', () => { state.q = ''; inp.value = ''; state.cat = 'all'; state.mood = ''; state.dur = 'any'; $('dDur').value = 'any'; render() });
  render();
  track('discover_viewed');
}

/* ---------- single sound page ---------- */
function initSoundPage(slug) {
  const s = SOUNDS.find(x => x.slug === slug); if (!s) return;
  const pb = $('spPlay'); pb.dataset.play = slug; pb.addEventListener('click', () => toggle(s)); pb.setAttribute('aria-label', t('play', title(s)));
  const c = $('spWave'); c.dataset.wave = slug; waveCanvas(c, s.peaks || [], progOf(slug));
  c.addEventListener('click', e => { if (current !== slug) { toggle(s); return } const r = c.getBoundingClientRect(); let p = (e.clientX - r.left) / r.width; if (audio.duration) audio.currentTime = p * audio.duration });
  const u = uses(s); $('spUses').hidden = !u; if (u) $('spUses').textContent = usesText(u);
  const fb = $('spFav'), paint = () => { const on = favs.has(slug); fb.setAttribute('aria-pressed', String(on)); fb.classList.toggle('on', on); fb.setAttribute('aria-label', t(on ? 'unfav' : 'fav', title(s))) };
  paint(); fb.addEventListener('click', () => { toggleFav(slug); paint() });
  $('spShare').addEventListener('click', async () => {
    const url = 'https://snipring.com/sound/' + slug + '.html', text = title(s) + ' · SnipRing';
    track('share_clicked', { where: 'sound_page', slug });
    if (navigator.share) { try { await navigator.share({ title: text, url }) } catch (e) {} return }
    try { await navigator.clipboard.writeText(url); const b = $('spShare'); const old = b.querySelector('span').textContent; b.querySelector('span').textContent = t('copied'); setTimeout(() => b.querySelector('span').textContent = old, 1800) } catch (e) { prompt('', url) }
  });
  $('spUse').addEventListener('click', () => track('sound_use_clicked', { slug, type: s.type, where: 'sound_page' }));
  renderSimilar(s);
  track('sound_page_viewed', { slug, type: s.type });
}
function renderSimilar(s) {
  const sim = $('spSimilar'); if (!sim) return; sim.textContent = '';
  $('spPlay').setAttribute('aria-label', t(current === s.slug && !audio.paused ? 'pause' : 'play', title(s)));
  const u = uses(s); if (u) $('spUses').textContent = usesText(u);
  const scoreSim = x => (x.type === s.type ? 2 : 0) + (x.moods || []).filter(m => (s.moods || []).includes(m)).length + (x.tags || []).filter(m => (s.tags || []).includes(m)).length * .5;
  SOUNDS.filter(x => x.slug !== s.slug).map(x => ({ x, v: scoreSim(x) })).filter(o => o.v > 0).sort((a, b) => b.v - a.v).slice(0, 4).forEach(o => sim.appendChild(card(o.x)));
}

/* ---------- boot ---------- */
function shell() {
  applyLang();
  $('lang') && $('lang').addEventListener('click', () => {
    lang = lang === 'he' ? 'en' : 'he'; try { localStorage.setItem('snipring-lang', lang) } catch (e) {}
    applyLang(); if ($('dList')) render(); if ($('spSimilar')) { const s = SOUNDS.find(x => x.slug === document.body.dataset.sound); if (s) renderSimilar(s) } track('language_switched', { to: lang });
  });
  $('themeBtn') && $('themeBtn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; try { theme === 'system' ? localStorage.removeItem('snipring-theme') : localStorage.setItem('snipring-theme', theme) } catch (e) {} paintTheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => theme === 'system' && paintTheme());
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => document.querySelectorAll('canvas.swave,canvas.spwave').forEach(c => c._draw && c._draw()), 120) });
}
shell();
loadData().then(() => { if ($('dList')) initGallery(); if (document.body.dataset.sound) initSoundPage(document.body.dataset.sound) });
})();
