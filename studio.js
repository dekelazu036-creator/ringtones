/* SnipRing Sound Studio: a small multi-layer editor that runs entirely on the device.
   Up to 3 layers of clips. Each clip: trim, move, split, duplicate, volume, fades, speed, repeat, reverse, effect, normalise.
   Projects and their audio are saved on this device (IndexedDB "snipring-studio"); finished sounds go to "My sounds". */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const ROOT = '/';
const CFG = Object.assign({}, window.SNIPRING_CONFIG || {});
function track(n, d) { try { window.umami && window.umami.track(n, d) } catch (e) {} }

/* ---------------------------------------------------------------- language */
let lang = (() => { try { const v = localStorage.getItem('snipring-lang'); if (v === 'he' || v === 'en') return v } catch (e) {} return /^he|^iw/i.test(navigator.language || '') ? 'he' : 'en' })();
const T = {
  he: {
    navCreate: 'יצירה', navDiscover: 'גילוי', navMine: 'הצלילים שלי', navAria: 'ניווט ראשי', skip: 'דלגו לתוכן', langBtn: 'English',
    theme: 'ערכת צבעים', th_system: 'לפי המערכת', th_light: 'בהירה', th_dark: 'כהה',
    h1: 'סטודיו צליל', sub: 'מחברים כמה צלילים לצליל אחד משלכם: חותכים, מסדרים בשכבות, מוסיפים אפקטים ומורידים.',
    projName: 'שם הפרויקט', untitled: 'צליל חדש', projects: 'הפרויקטים שלי', newProj: 'פרויקט חדש', open: 'פתח', del: 'מחק', delQ: 'למחוק את הפרויקט "{n}"?', noProj: 'עדיין אין פרויקטים שמורים.',
    play: 'נגן', stop: 'עצור', undo: 'בטל', redo: 'בצע שוב', zoomIn: 'הגדלה', zoomOut: 'הקטנה', toStart: 'להתחלה',
    layer: 'שכבה {n}', add: 'הוסף צליל', addH: 'הוספת צליל', addTo: 'יתווסף לשכבה {n}, במיקום של סמן הניגון.',
    fromFile: 'שיר או סרטון מהמכשיר', fromRec: 'הקלטה', fromMine: 'מהצלילים שלי', fromDisc: 'מספריית הצלילים', close: 'סגור',
    empty: 'הסטודיו ריק. הוסיפו צליל ראשון: שיר, סרטון, הקלטה או צליל מהספרייה.',
    clipH: 'הקטע שנבחר', noSel: 'לחצו על קטע בציר הזמן כדי לערוך אותו.',
    split: 'פצל בסמן', dup: 'שכפל', remove: 'מחק', up: 'שכבה למעלה', down: 'שכבה למטה', join: 'הצמד לקטע הקודם',
    vol: 'עוצמה', fin: 'כניסה הדרגתית', fout: 'יציאה הדרגתית', speed: 'מהירות וגובה צליל', loop: 'חזרה', fx: 'אפקט', rev: 'הפוך (מהסוף להתחלה)', norm: 'השווה עוצמה לקטע',
    fine: 'כוונון מדויק', pos: 'מיקום', trimS: 'תחילת הקטע', trimE: 'סוף הקטע', normal: 'רגיל', off: 'בלי',
    fx_none: 'בלי', fx_echo: 'הד', fx_robot: 'רובוט', fx_phone: 'רדיו', fx_bass: 'בס', fx_bit: '8־ביט',
    sec: 'שנ׳', len: 'אורך', total: 'אורך כולל',
    exportBtn: 'צור צליל', exportH: 'יצוא הצליל', type: 'מה יוצרים?', t_ring: 'רינגטון', t_text: 'צליל הודעה', t_alarm: 'שעון מעורר', t_sfx: 'אפקט קולי', t_custom: 'קובץ שמע',
    capNote: 'הצליל ארוך מ־{n} שניות, ולכן ייחתך ל־{n} שניות עם דעיכה בסוף.', masterNorm: 'השווה עוצמה לכל הצליל', create: 'צור MP3', fileName: 'שם הקובץ',
    encoding: 'מכין MP3…', ready: 'הצליל מוכן ונשמר ב"הצלילים שלי".', dl: 'הורד MP3', share: 'שתף או שמור', setRt: 'הגדר כרינגטון', openEditor: 'פתח ביוצר הרינגטונים',
    rtHint: 'באייפון: לחצו "הגדר כרינגטון" ובחרו "שימוש כצלצול". באנדרואיד: הורידו ובחרו בהגדרות ← צלילים.',
    recStart: 'התחל הקלטה', recStop: 'עצור והוסף', recOn: 'מקליט…', recNo: 'הדפדפן לא מאפשר הקלטה.', recDenied: 'אין הרשאה למיקרופון. אפשר לאשר בהגדרות הדפדפן.', recShort: 'ההקלטה קצרה מדי.',
    loading: 'טוען…', openFail: 'לא הצלחנו לפתוח את הקובץ.', saved: 'נשמר', tooLong: 'הפרויקט מוגבל ל־5 דקות.', nothing: 'אין עדיין מה ליצור. הוסיפו צליל.',
    selClip: 'קטע: {n}. חצים: הזזה, Shift+חצים: הזזה בשנייה, Delete: מחיקה.', fileTypes: 'MP3 · M4A · WAV · וידאו',
    terms: 'תנאי שימוש', privacy: 'מדיניות פרטיות', aStatement: 'הצהרת נגישות', guide: 'המדריך המלא'
  },
  en: {
    navCreate: 'Create', navDiscover: 'Discover', navMine: 'My sounds', navAria: 'Main navigation', skip: 'Skip to content', langBtn: 'עברית',
    theme: 'Colour theme', th_system: 'System', th_light: 'Light', th_dark: 'Dark',
    h1: 'Sound Studio', sub: 'Combine sounds into one of your own: trim, layer, add effects and download.',
    projName: 'Project name', untitled: 'New sound', projects: 'My projects', newProj: 'New project', open: 'Open', del: 'Delete', delQ: 'Delete the project "{n}"?', noProj: 'No saved projects yet.',
    play: 'Play', stop: 'Stop', undo: 'Undo', redo: 'Redo', zoomIn: 'Zoom in', zoomOut: 'Zoom out', toStart: 'Back to start',
    layer: 'Layer {n}', add: 'Add sound', addH: 'Add a sound', addTo: 'It goes on layer {n}, at the playhead.',
    fromFile: 'Song or video from your device', fromRec: 'Record', fromMine: 'From My sounds', fromDisc: 'From the sound library', close: 'Close',
    empty: 'The studio is empty. Add a first sound: a song, a video, a recording or a sound from the library.',
    clipH: 'Selected clip', noSel: 'Tap a clip on the timeline to edit it.',
    split: 'Split at playhead', dup: 'Duplicate', remove: 'Delete', up: 'Layer up', down: 'Layer down', join: 'Snap to previous clip',
    vol: 'Volume', fin: 'Fade in', fout: 'Fade out', speed: 'Speed and pitch', loop: 'Repeat', fx: 'Effect', rev: 'Reverse (play backwards)', norm: 'Even out this clip',
    fine: 'Fine-tune', pos: 'Position', trimS: 'Clip start', trimE: 'Clip end', normal: 'Normal', off: 'Off',
    fx_none: 'None', fx_echo: 'Echo', fx_robot: 'Robot', fx_phone: 'Radio', fx_bass: 'Bass', fx_bit: '8-bit',
    sec: 's', len: 'Length', total: 'Total length',
    exportBtn: 'Create sound', exportH: 'Export your sound', type: 'What are you making?', t_ring: 'Ringtone', t_text: 'Text tone', t_alarm: 'Alarm', t_sfx: 'Sound effect', t_custom: 'Audio file',
    capNote: 'The sound is longer than {n} seconds, so it will be cut to {n} seconds with a fade at the end.', masterNorm: 'Even out the whole sound', create: 'Create MP3', fileName: 'File name',
    encoding: 'Preparing MP3…', ready: 'Your sound is ready and saved in "My sounds".', dl: 'Download MP3', share: 'Share or save', setRt: 'Set as ringtone', openEditor: 'Open in the ringtone maker',
    rtHint: 'On iPhone: tap "Set as ringtone" and choose "Use as Ringtone". On Android: download it, then pick it in Settings → Sound.',
    recStart: 'Start recording', recStop: 'Stop and add', recOn: 'Recording…', recNo: 'This browser cannot record.', recDenied: 'No microphone permission. You can allow it in the browser settings.', recShort: 'The recording is too short.',
    loading: 'Loading…', openFail: 'Could not open that file.', saved: 'Saved', tooLong: 'Projects are limited to 5 minutes.', nothing: 'Nothing to create yet. Add a sound.',
    selClip: 'Clip: {n}. Arrows: move, Shift+arrows: move by a second, Delete: remove.', fileTypes: 'MP3 · M4A · WAV · video',
    terms: 'Terms of Use', privacy: 'Privacy Policy', aStatement: 'Accessibility statement', guide: 'Full guide'
  }
};
const t = (k, n) => { let s = (T[lang] && T[lang][k]) || T.en[k] || k; if (n != null) s = s.split('{n}').join(n); return s };
function applyLang() {
  const he = lang === 'he', r = document.documentElement; r.lang = lang; r.dir = he ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n) });
  document.querySelectorAll('[data-i18n-aria]').forEach(e => e.setAttribute('aria-label', t(e.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = t(e.dataset.i18nTitle); e.setAttribute('aria-label', e.title) });
  $('lang').textContent = t('langBtn'); paintTheme(); if (P) { renderAll() }
}
const THEMES = ['system', 'light', 'dark']; let theme = 'system'; try { theme = localStorage.getItem('snipring-theme') || 'system' } catch (e) {}
function paintTheme() {
  const r = document.documentElement; if (theme === 'system') delete r.dataset.theme; else r.dataset.theme = theme;
  const b = $('themeBtn'); b.querySelector('use').setAttribute('href', ROOT + 'icons.svg#i-' + (theme === 'system' ? 'system' : theme === 'light' ? 'sun' : 'moon'));
  b.setAttribute('aria-label', t('theme') + ': ' + t('th_' + theme)); b.title = b.getAttribute('aria-label');
  if (P) drawWaves();
}

/* ---------------------------------------------------------------- audio basics */
let actx = null;
const AC = () => { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx };
const MAXLEN = 300, LAYERS = 3;
function decode(ab) { const c = AC(); return new Promise((res, rej) => { const p = c.decodeAudioData(ab.slice(0), res, rej); if (p && p.then) p.then(res, rej) }) }
function toChannels(buf) { const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L; return { sr: buf.sampleRate, ch: [new Float32Array(L), new Float32Array(R)], dur: buf.duration } }
function mp3(chL, chR, sr, kbps) {
  const enc = new lamejs.Mp3Encoder(2, sr, kbps || 192), B = 1152, out = [];
  const i16 = a => { const r = new Int16Array(a.length); for (let i = 0; i < a.length; i++) r[i] = Math.max(-1, Math.min(1, a[i])) * 32767; return r };
  const L = i16(chL), R = i16(chR);
  for (let o = 0; o < L.length; o += B) { const b = enc.encodeBuffer(L.subarray(o, o + B), R.subarray(o, o + B)); if (b.length) out.push(new Uint8Array(b)) }
  const f = enc.flush(); if (f.length) out.push(new Uint8Array(f));
  const len = out.reduce((s, a) => s + a.length, 0), res = new Uint8Array(len); let p = 0; for (const a of out) { res.set(a, p); p += a.length } return res;
}
function id3(title) {
  const u = []; for (const ch of title) { const c = ch.codePointAt(0); if (c > 0xffff) { const v = c - 0x10000; u.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)) } else u.push(c) }
  const body = new Uint8Array(1 + 2 + u.length * 2 + 2); body[0] = 1; body[1] = 0xff; body[2] = 0xfe; u.forEach((c, i) => { body[3 + i * 2] = c & 255; body[4 + i * 2] = c >> 8 });
  const frame = new Uint8Array(10 + body.length); frame.set([84, 73, 84, 50], 0); const n = body.length; frame.set([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], 4); frame.set(body, 10);
  const size = frame.length, tag = new Uint8Array(10 + size); tag.set([73, 68, 51, 3, 0, 0], 0); tag.set([(size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127], 6); tag.set(frame, 10); return tag;
}
function peaksOf(ch, n) { const step = Math.max(1, Math.floor(ch.length / n)), out = new Float32Array(n); for (let i = 0; i < n; i++) { let m = 0; const a = i * step, b = Math.min(ch.length, a + step); for (let j = a; j < b; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v } out[i] = m } return out }

/* ---------------------------------------------------------------- storage */
function openDB(name, ver, up) { return new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open(name, ver); r.onupgradeneeded = () => up(r.result); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
const sdb = () => openDB('snipring-studio', 1, d => { d.createObjectStore('projects', { keyPath: 'id' }); d.createObjectStore('sources', { keyPath: 'id' }) });
const mdb = () => openDB('snipring', 1, d => { if (!d.objectStoreNames.contains('rings')) d.createObjectStore('rings', { keyPath: 'id' }) });
async function idb(dbp, store, mode, fn) { const d = await dbp(); return new Promise((res, rej) => { const tx = d.transaction(store, mode), st = tx.objectStore(store), r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error) }) }

/* ---------------------------------------------------------------- state */
// sources: id -> {id, name, from, sr, ch:[L,R], dur, peaks}
const SRC = new Map();
let P = null;                // project: {id, name, tracks:[[clip]], updated}
let sel = null;              // selected clip id
let layer = 0;               // layer new sounds go to
let playhead = 0, pps = 40;  // seconds, pixels per second
let undoS = [], redoS = [];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clipLen = c => Math.max(.01, (c.out - c.in) / c.speed * c.loop);
const allClips = () => P.tracks.flatMap((tr, li) => tr.map(c => ({ c, li })));
const findClip = id => { for (let li = 0; li < P.tracks.length; li++) { const i = P.tracks[li].findIndex(c => c.id === id); if (i >= 0) return { c: P.tracks[li][i], li, i } } return null };
const projLen = () => Math.max(0, ...allClips().map(({ c }) => c.start + clipLen(c)));
function newProject() { return { id: uid(), name: t('untitled'), tracks: [[], [], []], updated: Date.now() } }

function snapshot() { return JSON.stringify(P) }
function change(fn, label) {
  undoS.push(snapshot()); if (undoS.length > 50) undoS.shift(); redoS = [];
  fn(); P.updated = Date.now(); invalidateMix(); renderAll(); save(); if (label) track('studio_edit', { op: label });
}
function undo() { if (!undoS.length) return; redoS.push(snapshot()); P = JSON.parse(undoS.pop()); if (sel && !findClip(sel)) sel = null; invalidateMix(); renderAll(); save() }
function redo() { if (!redoS.length) return; undoS.push(snapshot()); P = JSON.parse(redoS.pop()); if (sel && !findClip(sel)) sel = null; invalidateMix(); renderAll(); save() }

let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => { try { await idb(sdb, 'projects', 'readwrite', st => st.put(JSON.parse(snapshot()))); localStorage.setItem('snipring-studio-last', P.id); $('saveSt').textContent = t('saved') } catch (e) {} }, 400);
}
async function storeSource(s, bytes) { try { await idb(sdb, 'sources', 'readwrite', st => st.put({ id: s.id, name: s.name, from: s.from, bytes })) } catch (e) {} }
async function loadSourceIds(ids) {
  for (const id of ids) {
    if (SRC.has(id)) continue;
    try { const r = await idb(sdb, 'sources', 'readonly', st => st.get(id)); if (!r) continue; const buf = await decode(r.bytes); addSource(Object.assign(toChannels(buf), { id, name: r.name, from: r.from })) } catch (e) {}
  }
}
function addSource(s) { s.peaks = peaksOf(s.ch[0], Math.min(4000, Math.max(200, Math.round(s.dur * 60)))); SRC.set(s.id, s); return s }

/* ---------------------------------------------------------------- render a clip / the mix */
const clipCache = new Map();
function fxApply(x, fx, sr) {
  const n = x.length;
  if (fx === 'robot') { for (let i = 0; i < n; i++) x[i] *= 1.5 * Math.sin(2 * Math.PI * 62 * i / sr) }
  else if (fx === 'echo') { const d = Math.floor(.23 * sr); for (let i = d; i < n; i++) x[i] += .48 * x[i - d]; for (let i = 0; i < n; i++) x[i] *= .72 }
  else if (fx === 'bit') { const hold = 6; let h = 0; for (let i = 0; i < n; i++) { if (i % hold === 0) h = Math.round(x[i] * 12) / 12; x[i] = h } }
  else if (fx === 'bass') { const al = 1 - Math.exp(-2 * Math.PI * 150 / sr); let lp = 0; for (let i = 0; i < n; i++) { lp += al * (x[i] - lp); x[i] = .7 * (x[i] + 1.8 * lp) } }
  else if (fx === 'phone') { const ah = 1 - Math.exp(-2 * Math.PI * 450 / sr), al = 1 - Math.exp(-2 * Math.PI * 2800 / sr); let l1 = 0, l2 = 0; for (let i = 0; i < n; i++) { l1 += ah * (x[i] - l1); const hp = x[i] - l1; l2 += al * (hp - l2); x[i] = Math.tanh(l2 * 2.4) * .8 } }
}
function renderClip(c) {
  const key = JSON.stringify([c.src, c.in, c.out, c.speed, c.loop, c.rev, c.fx, c.gain, c.fin, c.fout, c.norm]);
  if (clipCache.has(key)) return clipCache.get(key);
  const s = SRC.get(c.src); if (!s) return null;
  const sr = s.sr, a = Math.max(0, Math.floor(c.in * sr)), b = Math.min(s.ch[0].length, Math.floor(c.out * sr)), seg = Math.max(1, b - a);
  const n1 = Math.max(1, Math.floor(seg / c.speed)), n = n1 * c.loop, out = [new Float32Array(n), new Float32Array(n)];
  for (let k = 0; k < 2; k++) {
    const src = s.ch[k], o = out[k];
    for (let i = 0; i < n1; i++) { const p = i * c.speed, q = c.rev ? b - 1 - p : a + p, q0 = Math.floor(q), f = q - q0; o[i] = (src[q0] || 0) * (1 - f) + (src[q0 + 1] || 0) * f }
    for (let r = 1; r < c.loop; r++) o.copyWithin(r * n1, 0, n1);
    if (c.fx && c.fx !== 'none') fxApply(o, c.fx, sr);
  }
  let g = c.gain;
  if (c.norm) { let pk = 0; for (const o of out) for (let i = 0; i < n; i++) { const v = Math.abs(o[i]); if (v > pk) pk = v } if (pk > 1e-4) g *= .9 / pk }
  const fi = Math.floor(Math.min(c.fin, n / sr / 2) * sr), fo = Math.floor(Math.min(c.fout, n / sr / 2) * sr);
  for (const o of out) for (let i = 0; i < n; i++) { let e = g; if (i < fi) e *= i / fi; if (i > n - fo) e *= (n - i) / fo; o[i] *= e }
  const r = { ch: out, n, sr }; clipCache.set(key, r);
  if (clipCache.size > 60) clipCache.delete(clipCache.keys().next().value);
  return r;
}
let mixCache = null;
function invalidateMix() { mixCache = null }
function mix(opts) {
  if (mixCache && !opts) return mixCache;
  const sr = AC().sampleRate, len = Math.min(MAXLEN, projLen()), n = Math.max(1, Math.ceil(len * sr)), L = new Float32Array(n), R = new Float32Array(n);
  for (const { c } of allClips()) {
    const r = renderClip(c); if (!r) continue;
    const off = Math.floor(c.start * sr), m = Math.min(r.n, n - off);
    for (let i = 0; i < m; i++) { L[off + i] += r.ch[0][i]; R[off + i] += r.ch[1][i] }
  }
  let pk = 0; for (let i = 0; i < n; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (v > pk) pk = v }
  if (opts && opts.normalize && pk > 1e-4) { const g = .92 / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g } }
  else if (pk > .98) { for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i]); R[i] = Math.tanh(R[i]) } } // soft limit instead of clipping
  const res = { L, R, n, sr }; if (!opts) mixCache = res; return res;
}

/* ---------------------------------------------------------------- transport */
let player = null, t0 = 0, from = 0, raf = 0;
function isPlaying() { return !!player }
function play() {
  if (!allClips().length) return;
  const m = mix(), c = AC(), buf = c.createBuffer(2, m.n, m.sr); buf.copyToChannel(m.L, 0); buf.copyToChannel(m.R, 1);
  if (playhead >= m.n / m.sr - .05) playhead = 0;
  player = c.createBufferSource(); player.buffer = buf; player.connect(c.destination);
  from = playhead; t0 = c.currentTime + .03; player.start(t0, from);
  const me = player; player.onended = () => { if (player === me) { player = null; paintTransport() } };
  paintTransport(); loop(); track('studio_play');
}
function stop() { if (player) { try { player.stop() } catch (e) {} playhead = Math.min(projLen(), from + Math.max(0, AC().currentTime - t0)); player = null } paintTransport(); placePlayhead() }
function loop() { cancelAnimationFrame(raf); const step = () => { if (!player) return; playhead = from + Math.max(0, AC().currentTime - t0); placePlayhead(); raf = requestAnimationFrame(step) }; step() }
function paintTransport() {
  const on = isPlaying(); $('playIc').setAttribute('href', ROOT + 'icons.svg#i-' + (on ? 'pause' : 'play'));
  $('playBtn').setAttribute('aria-label', t(on ? 'stop' : 'play')); $('playBtn').setAttribute('aria-pressed', String(on));
}
// any edit while playing restarts playback from the same spot, so you hear the change
function restartIfPlaying() { if (isPlaying()) { stop(); play() } }
const fmt = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1) };

/* ---------------------------------------------------------------- timeline */
const viewLen = () => Math.max(10, projLen() + 4);
function renderTimeline() {
  const tl = $('tl'), inner = $('tlInner'), w = Math.ceil(viewLen() * pps);
  inner.style.width = w + 'px';
  // ruler
  const ru = $('ruler'); ru.textContent = '';
  const stepS = pps > 120 ? .5 : pps > 50 ? 1 : pps > 20 ? 2 : pps > 8 ? 5 : 10;
  for (let s = 0; s <= viewLen(); s += stepS) { const d = document.createElement('span'); d.style.left = (s * pps) + 'px'; d.textContent = fmt(s).replace(/\.0$/, ''); ru.appendChild(d) }
  // lanes
  const lanes = $('lanes'); lanes.textContent = '';
  P.tracks.forEach((tr, li) => {
    const lane = document.createElement('div'); lane.className = 'lane' + (li === layer ? ' cur' : ''); lane.dataset.li = li;
    lane.setAttribute('role', 'group'); lane.setAttribute('aria-label', t('layer', li + 1));
    const tag = document.createElement('span'); tag.className = 'lanetag'; tag.textContent = t('layer', li + 1); lane.appendChild(tag);
    tr.forEach(c => {
      const s = SRC.get(c.src), el = document.createElement('div'); el.className = 'clip' + (c.id === sel ? ' sel' : '') + (s ? '' : ' missing');
      el.dataset.id = c.id; el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-pressed', String(c.id === sel));
      el.setAttribute('aria-label', t('selClip', (s ? s.name : '?') + ', ' + fmt(c.start) + ' – ' + fmt(c.start + clipLen(c))));
      el.style.left = (c.start * pps) + 'px'; el.style.width = Math.max(6, clipLen(c) * pps) + 'px';
      el.innerHTML = '<canvas aria-hidden="true"></canvas><span class="cname"></span>' + (c.id === sel ? '<span class="h hl" data-h="l" aria-hidden="true"></span><span class="h hr" data-h="r" aria-hidden="true"></span>' : '');
      el.querySelector('.cname').textContent = (s ? s.name : '…') + (c.loop > 1 ? ' ×' + c.loop : '') + (c.speed !== 1 ? ' ' + c.speed + '×' : '');
      lane.appendChild(el);
    });
    lanes.appendChild(lane);
  });
  $('ph').style.height = '100%'; placePlayhead(); drawWaves();
  $('emptyNote').hidden = !!allClips().length;
  $('tLen').textContent = fmt(projLen());
}
function drawWaves() {
  const cs = getComputedStyle(document.documentElement), col = cs.getPropertyValue('--accent').trim(), dpr = window.devicePixelRatio || 1;
  document.querySelectorAll('#lanes .clip').forEach(el => {
    const f = findClip(el.dataset.id); if (!f) return; const c = f.c, s = SRC.get(c.src); if (!s) return;
    const cv = el.querySelector('canvas'), w = el.clientWidth, h = el.clientHeight; if (!w) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.fillStyle = col; g.globalAlpha = .55;
    const pp = s.peaks, per = s.dur / pp.length, segW = (c.out - c.in) / c.speed * pps;
    for (let x = 0; x < w; x += 2) {
      const tt = (x % Math.max(1, segW)) / pps * c.speed, srcT = c.rev ? c.out - tt : c.in + tt, i = Math.floor(srcT / per);
      const v = Math.min(1, (pp[i] || 0) * Math.max(.2, c.gain) * 1.1), bh = Math.max(1, v * (h - 18));
      g.fillRect(x, (h - bh) / 2 + 6, 1.4, bh);
    }
  });
}
function placePlayhead() { $('ph').style.left = (playhead * pps) + 'px'; $('tNow').textContent = fmt(playhead); paintClipButtons() }
function timeAt(e) { const r = $('tlInner').getBoundingClientRect(); return Math.max(0, (e.clientX - r.left) / pps) }

// pointer: tap empty space = move playhead; drag clip = move (also to another layer); drag handles = trim
let drag = null;
function onDown(e) {
  if (e.button > 0) return;
  const clipEl = e.target.closest('.clip'), lane = e.target.closest('.lane');
  if (!clipEl) { if (isPlaying()) stop(); playhead = Math.min(timeAt(e), Math.max(projLen(), 0)); if (lane) { layer = +lane.dataset.li; } sel = null; renderAll(); return }
  const f = findClip(clipEl.dataset.id); if (!f) return;
  if (sel !== f.c.id) { sel = f.c.id; layer = f.li; renderAll(); }
  const h = e.target.dataset && e.target.dataset.h;
  drag = { id: f.c.id, mode: h === 'l' ? 'trimL' : h === 'r' ? 'trimR' : 'move', x0: e.clientX, y0: e.clientY, orig: Object.assign({}, f.c), li0: f.li, moved: false, snap: snapshot() };
  try { $('tl').setPointerCapture(e.pointerId) } catch (err) {}
  e.preventDefault();
}
function snapTo(v, id, len) {
  const pts = [0, playhead]; allClips().forEach(({ c }) => { if (c.id !== id) { pts.push(c.start, c.start + clipLen(c)) } });
  const tol = 8 / pps;
  for (const p of pts) { if (Math.abs(v - p) < tol) return p; if (len != null && Math.abs(v + len - p) < tol) return p - len }
  return Math.round(v * 100) / 100;
}
function onMove(e) {
  if (!drag) return; const dx = (e.clientX - drag.x0) / pps;
  if (!drag.moved && Math.abs(e.clientX - drag.x0) < 4 && Math.abs(e.clientY - drag.y0) < 6) return;
  drag.moved = true; const f = findClip(drag.id); if (!f) return; const c = f.c, o = drag.orig, s = SRC.get(c.src), dur = s ? s.dur : o.out;
  if (drag.mode === 'move') {
    c.start = Math.max(0, snapTo(o.start + dx, c.id, clipLen(c)));
    const el = document.elementFromPoint(e.clientX, e.clientY), lane = el && el.closest && el.closest('.lane');
    if (lane && +lane.dataset.li !== f.li) { P.tracks[f.li].splice(f.i, 1); P.tracks[+lane.dataset.li].push(c); layer = +lane.dataset.li }
  } else if (drag.mode === 'trimL') {
    const d = Math.max(-o.in / o.speed, Math.min(dx, (o.out - o.in) / o.speed - .05));
    c.in = o.in + d * o.speed; c.start = Math.max(0, o.start + d * (o.loop > 1 ? 1 : 1));
  } else {
    const d = Math.min((dur - o.out) / o.speed, Math.max(dx / o.loop, -((o.out - o.in) / o.speed - .05)));
    c.out = o.out + d * o.speed;
  }
  invalidateMix(); renderTimeline(); renderPanel();
}
function onUp() {
  if (!drag) return; const d = drag; drag = null;
  if (d.moved) { undoS.push(d.snap); redoS = []; P.updated = Date.now(); save(); restartIfPlaying(); track('studio_edit', { op: d.mode }) }
}

/* ---------------------------------------------------------------- clip panel */
const SPEEDS = [.5, .75, 1, 1.25, 1.5, 2], LOOPS = [1, 2, 3, 4], FXS = ['none', 'echo', 'robot', 'phone', 'bass', 'bit'];
function chips(box, values, cur, label, onPick) {
  box.textContent = '';
  values.forEach(v => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label(v); const on = v === cur; b.classList.toggle('sel-on', on); b.setAttribute('aria-pressed', String(on)); b.addEventListener('click', () => onPick(v)); box.appendChild(b) });
}
function edit(fn, label) { const f = findClip(sel); if (!f) return; change(() => fn(f.c, f), label); restartIfPlaying() }
function renderPanel() {
  const f = sel && findClip(sel); $('panel').hidden = !f; $('noSel').hidden = !!f; if (!f) return;
  const c = f.c, s = SRC.get(c.src);
  $('pName').textContent = s ? s.name : '…'; $('pLen').textContent = fmt(clipLen(c));
  $('vol').value = Math.round(c.gain * 100); $('volV').textContent = Math.round(c.gain * 100) + '%';
  $('fin').value = c.fin; $('finV').textContent = c.fin.toFixed(1) + ' ' + t('sec');
  $('fout').value = c.fout; $('foutV').textContent = c.fout.toFixed(1) + ' ' + t('sec');
  $('fin').max = $('fout').max = Math.max(.1, Math.min(10, clipLen(c) / 2)).toFixed(1);
  $('rev').checked = !!c.rev; $('norm').checked = !!c.norm;
  chips($('speeds'), SPEEDS, c.speed, v => v === 1 ? t('normal') : v + '×', v => edit(c => { c.speed = v }, 'speed'));
  chips($('loops'), LOOPS, c.loop, v => v === 1 ? t('off') : v + '×', v => edit(c => { c.loop = v }, 'loop'));
  chips($('fxs'), FXS, c.fx || 'none', v => t('fx_' + v), v => edit(c => { c.fx = v }, 'fx'));
  $('posV').textContent = fmt(c.start); $('inV').textContent = fmt(c.in); $('outV').textContent = fmt(c.out);
  $('upBtn').disabled = f.li === 0; $('downBtn').disabled = f.li === LAYERS - 1;
  paintClipButtons();
}
function paintClipButtons() { const f = sel && findClip(sel); if (!f) return; const c = f.c; $('splitBtn').disabled = !(playhead > c.start + .02 && playhead < c.start + clipLen(c) - .02) }

/* ---------------------------------------------------------------- adding sounds */
function placeNew(s) {
  const len = s.dur; let li = layer;
  // if the chosen layer is busy at the playhead, use the first free layer
  const busy = l => P.tracks[l].some(c => playhead < c.start + clipLen(c) && playhead + len > c.start);
  if (busy(li)) { const free = [0, 1, 2].find(l => !busy(l)); if (free != null) li = free }
  const c = { id: uid(), src: s.id, start: Math.round(playhead * 100) / 100, in: 0, out: Math.min(s.dur, MAXLEN), gain: 1, fin: 0, fout: 0, speed: 1, loop: 1, rev: false, fx: 'none', norm: false };
  change(() => { P.tracks[li].push(c); sel = c.id; layer = li }, 'add');
  fitIfNeeded();
}
async function addBytes(bytes, name, from) {
  say(t('loading'));
  try {
    const buf = await decode(bytes); const s = addSource(Object.assign(toChannels(buf), { id: uid(), name: (name || '').slice(0, 40) || t('untitled'), from }));
    await storeSource(s, bytes); closeDlg($('addDlg')); placeNew(s); say(''); track('studio_add', { from, seconds: Math.round(s.dur) });
  } catch (e) { say(t('openFail')); track('studio_add_failed', { from }) }
}
function fitIfNeeded() { const w = $('tl').clientWidth || 320; if (projLen() * pps > w * .95 || projLen() * pps < w * .3) { pps = Math.max(8, Math.min(200, (w * .9) / Math.max(4, projLen()))); renderTimeline() } }
// recording (raw samples: reliable on iPhone)
let rec = null;
async function recStart() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('recSt').textContent = t('recNo'); return }
  const c = AC(); let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }) } catch (e) { $('recSt').textContent = t('recDenied'); return }
  try { await c.resume() } catch (e) {}
  const srcN = c.createMediaStreamSource(stream), proc = c.createScriptProcessor(4096, 1, 1), mute = c.createGain(); mute.gain.value = 0;
  const chunks = []; let level = 0;
  proc.onaudioprocess = e => { if (!rec) return; const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); let pk = 0; for (let i = 0; i < d.length; i += 8) pk = Math.max(pk, Math.abs(d[i])); level = pk };
  srcN.connect(proc); proc.connect(mute); mute.connect(c.destination);
  rec = { stream, srcN, proc, mute, chunks, sr: c.sampleRate, t0: performance.now(), lv: () => level };
  $('recGo').setAttribute('aria-pressed', 'true'); $('recGoL').textContent = t('recStop'); $('recSt').textContent = t('recOn');
  const tick = () => { if (!rec) return; const el = (performance.now() - rec.t0) / 1000; $('recT').textContent = fmt(el).replace(/\.\d$/, ''); $('recLv').style.transform = 'scaleX(' + Math.min(1, rec.lv() * 1.6) + ')'; if (el >= 120) { recStop(); return } requestAnimationFrame(tick) }; tick();
  track('studio_rec_started');
}
function recStop() {
  const r = rec; if (!r) return; rec = null;
  try { r.srcN.disconnect(); r.proc.disconnect(); r.mute.disconnect() } catch (e) {} r.proc.onaudioprocess = null; r.stream.getTracks().forEach(x => x.stop());
  $('recGo').setAttribute('aria-pressed', 'false'); $('recGoL').textContent = t('recStart'); $('recLv').style.transform = 'scaleX(0)';
  const total = r.chunks.reduce((s, a) => s + a.length, 0); if (total < r.sr * .3) { $('recSt').textContent = t('recShort'); return }
  const skip = Math.min(Math.floor(r.sr * .05), total - 1), n = total - skip, mono = new Float32Array(n); let o = -skip;
  for (const ch of r.chunks) for (let i = 0; i < ch.length; i++, o++) if (o >= 0) mono[o] = ch[i];
  let pk = 0; for (const v of mono) pk = Math.max(pk, Math.abs(v)); const g = pk > 0 ? Math.min(8, .9 / pk) : 1; for (let i = 0; i < n; i++) mono[i] *= g;
  const d = new Date(), name = (lang === 'he' ? 'הקלטה ' : 'Recording ') + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  const bytes = mp3(mono, mono, r.sr, 160).buffer;
  const s = addSource({ id: uid(), name, from: 'record', sr: r.sr, ch: [mono, mono], dur: n / r.sr });
  storeSource(s, bytes); $('recSt').textContent = ''; closeDlg($('addDlg')); placeNew(s); track('studio_add', { from: 'record', seconds: Math.round(s.dur) });
}
async function listMine() {
  const box = $('mineList'); box.textContent = '';
  let rows = []; try { rows = await idb(mdb, 'rings', 'readonly', st => st.getAll()) || [] } catch (e) {}
  rows.sort((a, b) => b.id - a.id);
  if (!rows.length) { box.innerHTML = '<li class="muted small">—</li>'; return }
  rows.slice(0, 30).forEach(r => {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'btn pick';
    b.innerHTML = '<span class="pn"><bdi></bdi></span><span class="num small muted" dir="ltr"></span>'; b.querySelector('bdi').textContent = r.name; b.querySelector('.num').textContent = (r.secs || 0).toFixed(1) + ' ' + t('sec');
    b.addEventListener('click', async () => { const ab = r.data ? r.data.slice(0) : await (r.blob || new Blob()).arrayBuffer(); addBytes(ab, r.name, r.origin || 'mine') });
    li.appendChild(b); box.appendChild(li);
  });
}
let catalog = null;
async function listDisc() {
  const box = $('discList'); box.textContent = '';
  if (!catalog) catalog = await fetch(ROOT + 'sounds/catalog.json').then(r => r.json()).catch(() => []);
  catalog.forEach(s => {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'btn pick';
    b.innerHTML = '<span class="pn"><bdi></bdi></span><span class="num small muted" dir="ltr"></span>'; b.querySelector('bdi').textContent = lang === 'he' ? s.title_he : s.title_en; b.querySelector('.num').textContent = (s.duration_ms / 1000).toFixed(1) + ' ' + t('sec');
    b.addEventListener('click', async () => { try { const ab = await fetch(ROOT + s.audio_path).then(r => r.arrayBuffer()); addBytes(ab, lang === 'he' ? s.title_he : s.title_en, 'discover') } catch (e) { say(t('openFail')) } });
    li.appendChild(b); box.appendChild(li);
  });
}

/* ---------------------------------------------------------------- export */
const CAPS = { ring: 29.5, text: 10, alarm: 29.5, sfx: 15, custom: 300 };
let exType = 'ring', ready = null, readyUrl = null;
function renderExport() {
  chips($('exTypes'), Object.keys(CAPS), exType, v => t('t_' + v), v => { exType = v; renderExport() });
  const L = projLen(), cap = CAPS[exType]; $('exCap').hidden = L <= cap; $('exCap').textContent = t('capNote', cap);
  $('exLen').textContent = fmt(Math.min(L, cap));
}
async function doExport() {
  if (!allClips().length) { say(t('nothing')); return }
  stop(); const btn = $('exGo'); btn.disabled = true; btn.classList.add('loading'); $('exSt').textContent = t('encoding');
  await new Promise(r => setTimeout(r, 30));
  try {
    const m = mix({ normalize: $('exNorm').checked }), cap = CAPS[exType], n = Math.min(m.n, Math.floor(cap * m.sr));
    let L = m.L.subarray(0, n), R = m.R.subarray(0, n);
    if (m.n > n) { L = L.slice(); R = R.slice(); const fo = Math.floor(Math.min(1.5, cap / 5) * m.sr); for (let i = 0; i < fo; i++) { const e = i / fo; L[n - 1 - i] *= e; R[n - 1 - i] *= e } }
    const title = ($('exName').value.trim() || P.name || t('untitled')).replace(/[\\/*?"<>|%]/g, '').slice(0, 40) || t('untitled');
    const bytes = mp3(L, R, m.sr, 192), file = new File([id3(title), bytes], title.replace(/:/g, '.') + '.mp3', { type: 'audio/mpeg' });
    ready = file; if (readyUrl) URL.revokeObjectURL(readyUrl); readyUrl = URL.createObjectURL(file);
    const a = $('exDl'); a.href = readyUrl; a.download = file.name;
    const phone = exType === 'ring' || exType === 'text' || exType === 'alarm', canShare = !!navigator.share;
    $('exDone').hidden = false; $('exShare').hidden = !canShare; $('exShareL').textContent = t(phone && /iPhone|iPad/.test(navigator.userAgent) ? 'setRt' : 'share');
    $('exRt').hidden = !phone;
    // save to "My sounds" (same store the main app uses)
    try {
      const origins = [...new Set(allClips().map(({ c }) => (SRC.get(c.src) || {}).from).filter(Boolean))];
      const data = await file.arrayBuffer();
      await idb(mdb, 'rings', 'readwrite', st => st.put({ id: Date.now(), name: title, secs: Math.round(n / m.sr * 10) / 10, data, type: exType, fav: false, origin: 'studio', sources: origins, used: Date.now() }));
    } catch (e) {}
    $('exSt').textContent = t('ready');
    track('ringtone_created', { mode: exType, seconds: Math.round(n / m.sr), from: 'studio', clips: allClips().length });
  } catch (e) { $('exSt').textContent = t('openFail') }
  finally { btn.disabled = false; btn.classList.remove('loading') }
}

/* ---------------------------------------------------------------- dialogs, projects */
function openDlg(d) { d.showModal ? d.showModal() : d.setAttribute('open', '') }
function closeDlg(d) { if (d.open) d.close ? d.close() : d.removeAttribute('open') }
async function listProjects() {
  const box = $('projList'); box.textContent = '';
  let rows = []; try { rows = await idb(sdb, 'projects', 'readonly', st => st.getAll()) || [] } catch (e) {}
  rows.sort((a, b) => b.updated - a.updated); $('noProj').hidden = !!rows.length;
  rows.forEach(p => {
    const li = document.createElement('li'); li.className = 'projrow';
    const nm = document.createElement('span'); nm.className = 'pn'; nm.innerHTML = '<bdi></bdi><small class="muted"></small>'; nm.querySelector('bdi').textContent = p.name;
    nm.querySelector('small').textContent = new Date(p.updated).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US') + ' · ' + p.tracks.flat().length;
    const o = document.createElement('button'); o.type = 'button'; o.className = 'btn'; o.textContent = t('open'); o.addEventListener('click', () => { closeDlg($('projDlg')); openProject(p) });
    const d = document.createElement('button'); d.type = 'button'; d.className = 'iconbtn sm'; d.setAttribute('aria-label', t('del') + ': ' + p.name); d.innerHTML = '<svg class="ic sm" aria-hidden="true"><use href="' + ROOT + 'icons.svg#i-trash"/></svg>';
    d.addEventListener('click', async () => { if (!confirm(t('delQ', p.name))) return; try { await idb(sdb, 'projects', 'readwrite', st => st.delete(p.id)) } catch (e) {} if (P && P.id === p.id) openProject(newProject()); listProjects() });
    li.append(nm, o, d); box.appendChild(li);
  });
}
async function openProject(p) {
  stop(); P = p; sel = null; layer = 0; playhead = 0; undoS = []; redoS = []; invalidateMix();
  while (P.tracks.length < LAYERS) P.tracks.push([]);
  say(t('loading')); await loadSourceIds([...new Set(P.tracks.flat().map(c => c.src))]); say('');
  $('projName').value = P.name; $('exName').value = P.name; pps = 40; renderAll(); fitIfNeeded(); save();
}
function say(s) { $('status').textContent = s }

/* ---------------------------------------------------------------- render everything */
function renderAll() { renderTimeline(); renderPanel(); paintTransport(); $('undoBtn').disabled = !undoS.length; $('redoBtn').disabled = !redoS.length }

/* ---------------------------------------------------------------- wiring */
function wire() {
  $('lang').addEventListener('click', () => { lang = lang === 'he' ? 'en' : 'he'; try { localStorage.setItem('snipring-lang', lang) } catch (e) {} applyLang() });
  $('themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; try { theme === 'system' ? localStorage.removeItem('snipring-theme') : localStorage.setItem('snipring-theme', theme) } catch (e) {} paintTheme() });
  $('playBtn').addEventListener('click', () => isPlaying() ? stop() : play());
  $('startBtn').addEventListener('click', () => { const was = isPlaying(); stop(); playhead = 0; placePlayhead(); if (was) play() });
  $('undoBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo);
  $('zIn').addEventListener('click', () => { pps = Math.min(400, pps * 1.6); renderTimeline() });
  $('zOut').addEventListener('click', () => { pps = Math.max(6, pps / 1.6); renderTimeline() });
  const tl = $('tl'); tl.addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  tl.addEventListener('keydown', e => {
    const f = sel && findClip(sel); if (!f) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : .1); edit(c => { c.start = Math.max(0, Math.round((c.start + d) * 100) / 100) }, 'nudge') }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $('delBtn').click() }
  });
  tl.addEventListener('focusin', e => { const el = e.target.closest('.clip'); if (el && sel !== el.dataset.id) { sel = el.dataset.id; renderPanel(); document.querySelectorAll('#lanes .clip').forEach(x => { x.classList.toggle('sel', x.dataset.id === sel); x.setAttribute('aria-pressed', String(x.dataset.id === sel)) }) } });
  $('projName').addEventListener('input', () => { P.name = $('projName').value.trim() || t('untitled'); $('exName').value = P.name; save() });
  // add
  $('addBtn').addEventListener('click', () => { $('addTo').textContent = t('addTo', layer + 1); openDlg($('addDlg')); listMine(); listDisc() });
  $('emptyAdd').addEventListener('click', () => $('addBtn').click());
  $('addFile').addEventListener('change', async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; addBytes(await f.arrayBuffer(), f.name.replace(/\.[^.]+$/, ''), /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name) ? 'video' : 'file') });
  $('recGo').addEventListener('click', () => rec ? recStop() : recStart());
  $('addDlg').addEventListener('close', () => { if (rec) { const r = rec; rec = null; try { r.stream.getTracks().forEach(x => x.stop()) } catch (e) {} } });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDlg(b.closest('dialog'))));
  // clip actions
  $('splitBtn').addEventListener('click', () => edit((c, f) => {
    const at = playhead - c.start, segLen = (c.out - c.in) / c.speed; if (c.loop > 1) { c.loop = 1 }
    const off = Math.min(at, segLen) * c.speed, cut = c.rev ? c.out - off : c.in + off;
    const b = Object.assign({}, c, { id: uid(), start: playhead, fin: 0 });
    if (c.rev) { b.out = cut; c.in = cut } else { b.in = cut; c.out = cut } c.fout = 0;
    P.tracks[f.li].push(b); sel = b.id;
  }, 'split'));
  $('dupBtn').addEventListener('click', () => edit((c, f) => { const b = Object.assign({}, c, { id: uid(), start: Math.round((c.start + clipLen(c)) * 100) / 100 }); P.tracks[f.li].push(b); sel = b.id }, 'duplicate'));
  $('delBtn').addEventListener('click', () => edit((c, f) => { P.tracks[f.li].splice(f.i, 1); sel = null }, 'delete'));
  $('upBtn').addEventListener('click', () => edit((c, f) => { if (f.li === 0) return; P.tracks[f.li].splice(f.i, 1); P.tracks[f.li - 1].push(c); layer = f.li - 1 }, 'layer'));
  $('downBtn').addEventListener('click', () => edit((c, f) => { if (f.li >= LAYERS - 1) return; P.tracks[f.li].splice(f.i, 1); P.tracks[f.li + 1].push(c); layer = f.li + 1 }, 'layer'));
  $('joinBtn').addEventListener('click', () => edit((c, f) => { const prev = P.tracks[f.li].filter(x => x.id !== c.id && x.start <= c.start).sort((a, b) => (b.start + clipLen(b)) - (a.start + clipLen(a)))[0]; c.start = prev ? Math.round((prev.start + clipLen(prev)) * 1000) / 1000 : 0 }, 'join'));
  // sliders: preview live, one undo step per gesture
  [['vol', (c, v) => { c.gain = v / 100 }], ['fin', (c, v) => { c.fin = v }], ['fout', (c, v) => { c.fout = v }]].forEach(([id, set]) => {
    const el = $(id); let snap = null;
    el.addEventListener('pointerdown', () => { snap = snapshot() }); el.addEventListener('keydown', () => { if (!snap) snap = snapshot() });
    el.addEventListener('input', () => { const f = findClip(sel); if (!f) return; set(f.c, +el.value); invalidateMix(); renderPanel(); drawWaves() });
    el.addEventListener('change', () => { undoS.push(snap || snapshot()); snap = null; redoS = []; save(); restartIfPlaying(); renderAll() });
  });
  $('rev').addEventListener('change', () => edit(c => { c.rev = $('rev').checked }, 'reverse'));
  $('norm').addEventListener('change', () => edit(c => { c.norm = $('norm').checked }, 'normalize'));
  document.querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', () => edit(c => {
    const [k, d] = b.dataset.nudge.split(':'), v = +d, s = SRC.get(c.src), dur = s ? s.dur : c.out;
    if (k === 'pos') c.start = Math.max(0, Math.round((c.start + v) * 100) / 100);
    if (k === 'in') c.in = Math.max(0, Math.min(c.out - .05, Math.round((c.in + v) * 100) / 100));
    if (k === 'out') c.out = Math.min(dur, Math.max(c.in + .05, Math.round((c.out + v) * 100) / 100));
  }, 'nudge')));
  // projects
  $('projBtn').addEventListener('click', () => { openDlg($('projDlg')); listProjects() });
  $('newProj').addEventListener('click', () => { closeDlg($('projDlg')); openProject(newProject()); track('studio_new_project') });
  // export
  $('exportBtn').addEventListener('click', () => { if (!allClips().length) { say(t('nothing')); return } $('exDone').hidden = true; $('exSt').textContent = ''; renderExport(); openDlg($('exDlg')) });
  $('exGo').addEventListener('click', doExport);
  $('exDl').addEventListener('click', () => track('export_completed', { method: 'download', mode: exType, from: 'studio' }));
  $('exShare').addEventListener('click', async () => { if (!ready) return; try { await navigator.share({ files: [ready] }); track('export_completed', { method: 'share', mode: exType, from: 'studio' }) } catch (e) {} });
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { renderTimeline() }, 150) });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => theme === 'system' && paintTheme());
}

/* ---------------------------------------------------------------- boot */
async function boot() {
  applyLang(); wire();
  const q = new URLSearchParams(location.search);
  let p = null; const last = (() => { try { return localStorage.getItem('snipring-studio-last') } catch (e) { return null } })();
  if (!q.has('sound') && !q.has('mine') && !q.has('new') && last) { try { p = await idb(sdb, 'projects', 'readonly', st => st.get(last)) } catch (e) {} }
  await openProject(p || newProject());
  try { history.replaceState(null, '', location.pathname) } catch (e) {}
  // open with a sound: /studio.html?sound=<slug> (Discover) or ?mine=<id> (My sounds)
  if (q.get('sound') && /^[a-z0-9-]{3,80}$/.test(q.get('sound'))) {
    try { const cat = await fetch(ROOT + 'sounds/catalog.json').then(r => r.json()); const s = cat.find(x => x.slug === q.get('sound')); if (s) addBytes(await fetch(ROOT + s.audio_path).then(r => r.arrayBuffer()), lang === 'he' ? s.title_he : s.title_en, 'discover') } catch (e) { say(t('openFail')) }
  } else if (q.get('mine')) {
    try { const r = await idb(mdb, 'rings', 'readonly', st => st.get(+q.get('mine'))); if (r) addBytes(r.data ? r.data.slice(0) : await r.blob.arrayBuffer(), r.name, r.origin || 'mine') } catch (e) { say(t('openFail')) }
  }
  track('studio_opened');
}
boot();
})();
