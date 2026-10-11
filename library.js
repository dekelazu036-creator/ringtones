/* SnipRing My Library (Phase 1B M2). Cloud copies of sounds, saved only when the person asks (D1).
   - The browser never touches Storage: uploads/downloads go through the library-* Edge Functions,
     list/delete/usage through the three granted RPCs and the RLS-limited library_items view (D4).
   - Local sounds (IndexedDB 'snipring' v1 / 'rings') are never deleted or changed here, except the
     optional cloudCopy field (D11): {id, sha, uid}. uid keeps a copy made by account A from showing as
     saved while account B is signed in.
   - Upload queue per user: IndexedDB 'snipring-cloud-<uid>' / 'jobs', one worker per user (Web Lock),
     aborted when the signed-in user changes. client_key makes every retry idempotent on the server. */
(function () {
'use strict';
var CFG = window.SNIPRING_CONFIG || {}, A = CFG.auth || {};
var owner = false; try { owner = localStorage.getItem('umami.disabled') === '1' } catch (e) {}
var beta = false; try { beta = localStorage.getItem('snipring-beta') === '1' } catch (e) {}
var ON = !!A.enabled || owner || beta;
var $ = function (id) { return document.getElementById(id) };
var MAX_BYTES = 10 * 1024 * 1024;
var TYPES = ['ring', 'text', 'alarm', 'sfx', 'intro', 'outro', 'custom'];
var ORIGINS = ['file', 'video', 'record', 'generated', 'discover', 'demo', 'mine', 'studio'];

/* ---------------------------------------------------------------- language */
var T = {
  he: {
    skip: 'דלגו לתוכן', back: 'חזרה ליצירה', loading: 'טוען…',
    offH: 'הספרייה בענן עוד לא פתוחה', offP: 'בינתיים כל הצלילים שלכם נשמרים בטלפון הזה, בחינם ובלי הרשמה.', toCreate: 'ליצירת צליל',
    outH: 'הספרייה שלכם בענן', outP: 'התחברו כדי לשמור צלילים בענן ולפתוח אותם בכל מכשיר. הצלילים בטלפון נשארים בדיוק כמו שהם.', signIn: 'התחברות',
    h: 'הספרייה שלי', signedAs: 'מחוברים בתור {n}',
    notOnList: 'הספרייה בענן פתוחה כרגע רק לבודקי בטא. יש לכם קוד הזמנה? הקלידו אותו כאן.', inviteL: 'קוד הזמנה', inviteGo: 'הצטרפות', inviteOk: 'הצטרפתם לבטא! עכשיו אפשר לשמור צלילים בענן.', inviteBad: 'קוד ההזמנה לא תקף או שכבר נוצל.', inviteRate: 'יותר מדי ניסיונות. נסו שוב בעוד שעה.',
    closed: 'שמירה חדשה בענן מושהית כרגע. אפשר להאזין, להוריד ולמחוק.',
    usage: '{i} מתוך {mi} צלילים · {b} מתוך {mb} MB',
    cloudH: 'בענן', cloudEmpty: 'עוד אין צלילים בענן. בחרו צליל מהרשימה למטה ולחצו "שמירה בענן".',
    localH: 'בטלפון הזה', localP: 'הצלילים שיצרתם במכשיר. שום דבר לא עולה לענן בלי שתבחרו.', localEmpty: 'אין עדיין צלילים בטלפון הזה.',
    play: 'השמעה', stop: 'עצירה', download: 'הורדה', del: 'מחיקה מהענן', restore: 'שמירה בטלפון', save: 'שמירה בענן', retry: 'נסו שוב',
    saved: 'שמור בענן', queued: 'ממתין…', uploading: 'מעלה…', failed: 'השמירה נכשלה', onDevice: 'כבר בטלפון',
    saveQH: 'לשמור את "{n}" בענן?', saveQP: 'עותק של הקובץ יישמר בחשבון שלכם בשרתי SnipRing באירופה, ורק אתם תוכלו לגשת אליו. הצליל בטלפון נשאר כמו שהוא.', saveQY: 'שמירה בענן',
    delQH: 'למחוק את "{n}" מהענן?', delQP: 'העותק בענן יימחק לצמיתות ואי אפשר לשחזר אותו. עותקים שנשמרו בטלפונים לא נמחקים.', delQY: 'מחיקה', cancel: 'ביטול',
    restored: '"{n}" נשמר בטלפון הזה.', deleted: '"{n}" נמחק מהענן.', done: '"{n}" נשמר בענן.', dup: 'הצליל הזה כבר שמור בענן.',
    e_net: 'אין חיבור. נסו שוב בעוד רגע.', e_auth: 'פג תוקף ההתחברות. התחברו שוב.', e_generic: 'משהו השתבש. נסו שוב.',
    e_not_enabled: 'החשבון שלכם עוד לא ברשימת הבטא.', e_quota_items: 'הגעתם למספר הצלילים המרבי בענן. מחקו צליל כדי לפנות מקום.',
    e_quota_bytes: 'נגמר המקום בספרייה. מחקו צליל כדי לפנות מקום.', e_quota_physical: 'נגמר המקום בספרייה. מחקו צליל ונסו שוב בעוד כמה דקות.',
    e_file_too_large: 'הקובץ גדול מ־10 MB.', e_not_mp3: 'אפשר לשמור בענן רק קובצי MP3 תקינים.', e_bad_duration: 'אורך הצליל לא נתמך (עד 5 דקות).',
    e_rate_limited: 'שמרתם הרבה צלילים בשעה האחרונה. נסו שוב מאוחר יותר.', e_too_many_uploads: 'יש כבר כמה שמירות בדרך. נסו שוב בעוד רגע.',
    e_reservations_closed: 'שמירה חדשה בענן מושהית כרגע.', e_stopped: 'שמירה בענן מושהית כרגע.', e_service_full: 'השירות מלא כרגע. נסו שוב מאוחר יותר.',
    e_not_found: 'הצליל לא נמצא. אולי הוא נמחק ממכשיר אחר.',
    privacy: 'הספרייה פרטית: רק אתם רואים את הצלילים שלכם.', privacyLink: 'פרטיות', termsLink: 'תנאי שימוש', aStatement: 'הצהרת נגישות'
  },
  en: {
    skip: 'Skip to content', back: 'Back to Create', loading: 'Loading…',
    offH: 'The cloud library is not open yet', offP: 'For now every sound you make is kept on this phone, free and with no sign-up.', toCreate: 'Make a sound',
    outH: 'Your cloud library', outP: 'Sign in to keep sounds in the cloud and open them on any device. The sounds on this phone stay exactly as they are.', signIn: 'Sign in',
    h: 'My Library', signedAs: 'Signed in as {n}',
    notOnList: 'The cloud library is open to beta testers only for now. Have an invite code? Type it here.', inviteL: 'Invite code', inviteGo: 'Join', inviteOk: 'You joined the beta! You can now save sounds to the cloud.', inviteBad: 'This invite code is not valid or was already used.', inviteRate: 'Too many tries. Please try again in an hour.',
    closed: 'New cloud saves are paused right now. You can still play, download and delete.',
    usage: '{i} of {mi} sounds · {b} of {mb} MB',
    cloudH: 'In the cloud', cloudEmpty: 'No sounds in the cloud yet. Pick one below and tap "Save to cloud".',
    localH: 'On this phone', localP: 'Sounds you made on this device. Nothing goes to the cloud unless you choose it.', localEmpty: 'No sounds on this phone yet.',
    play: 'Play', stop: 'Stop', download: 'Download', del: 'Delete from cloud', restore: 'Save to this phone', save: 'Save to cloud', retry: 'Try again',
    saved: 'Saved in the cloud', queued: 'Waiting…', uploading: 'Uploading…', failed: 'Save failed', onDevice: 'On this phone',
    saveQH: 'Save "{n}" to the cloud?', saveQP: 'A copy of the file is stored in your account on SnipRing servers in Europe, and only you can access it. The sound on this phone stays as it is.', saveQY: 'Save to cloud',
    delQH: 'Delete "{n}" from the cloud?', delQP: 'The cloud copy is deleted for good and cannot be restored. Copies saved on phones are not deleted.', delQY: 'Delete', cancel: 'Cancel',
    restored: '"{n}" is saved on this phone.', deleted: '"{n}" was deleted from the cloud.', done: '"{n}" is saved in the cloud.', dup: 'This sound is already in the cloud.',
    e_net: 'No connection. Try again in a moment.', e_auth: 'Your sign-in expired. Please sign in again.', e_generic: 'Something went wrong. Please try again.',
    e_not_enabled: 'Your account is not on the beta list yet.', e_quota_items: 'You reached the maximum number of cloud sounds. Delete one to make room.',
    e_quota_bytes: 'Your library is full. Delete a sound to make room.', e_quota_physical: 'Your library is full. Delete a sound and try again in a few minutes.',
    e_file_too_large: 'The file is larger than 10 MB.', e_not_mp3: 'Only valid MP3 files can be saved to the cloud.', e_bad_duration: 'This length is not supported (up to 5 minutes).',
    e_rate_limited: 'You saved a lot in the last hour. Try again later.', e_too_many_uploads: 'A few saves are already on their way. Try again in a moment.',
    e_reservations_closed: 'New cloud saves are paused right now.', e_stopped: 'Cloud saving is paused right now.', e_service_full: 'The service is full right now. Try again later.',
    e_not_found: 'That sound was not found. It may have been deleted on another device.',
    privacy: 'Your library is private: only you can see your sounds.', privacyLink: 'Privacy', termsLink: 'Terms', aStatement: 'Accessibility'
  }
};
var lang = document.documentElement.lang === 'en' ? 'en' : 'he';
try { var sl = localStorage.getItem('snipring-lang'); if (sl === 'he' || sl === 'en') lang = sl; else if (!/^he|^iw/i.test(navigator.language || '')) lang = 'en' } catch (e) {}
function t(k, v) { var s = (T[lang][k] != null ? T[lang][k] : T.en[k]) || k; if (v) Object.keys(v).forEach(function (n) { s = s.split('{' + n + '}').join(v[n]) }); return s }
function applyLang() {
  var r = document.documentElement; r.lang = lang; r.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')) });
  $('lang').textContent = lang === 'he' ? 'English' : 'עברית';
  document.title = 'SnipRing · ' + t('h');
}

/* ---------------------------------------------------------------- analytics: event names and counts only, never names, ids or emails */
function track(n, d) { try { if (!owner && window.umami && umami.track) umami.track(n, Object.assign({ tier: 'free' }, d || {})) } catch (e) {} }

/* ---------------------------------------------------------------- ui helpers */
var VIEWS = ['vOff', 'vBusy', 'vOut', 'vMain'];
function show(v) { VIEWS.forEach(function (id) { $(id).hidden = id !== v }) }
function say(k, v, err) { var m = $('msg'); m.textContent = k ? t(k, v) : ''; m.classList.toggle('err', !!err) }
function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }
function icon(id) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic sm'); s.setAttribute('aria-hidden', 'true'); var u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '/icons.svg#' + id); s.appendChild(u); return s }
function btn(label, ic, cls) { var b = el('button', 'btn' + (cls ? ' ' + cls : '')); b.type = 'button'; if (ic) b.appendChild(icon(ic)); b.appendChild(el('span', '', label)); return b }
function fmtSecs(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') }
function fmtMB(b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) }
function ask(h, p, yes, danger) {
  return new Promise(function (res) {
    var d = $('confirm'); $('cfH').textContent = h; $('cfP').textContent = p; $('cfYes').textContent = yes; $('cfNo').textContent = t('cancel');
    $('cfYes').classList.toggle('danger', !!danger);
    d.returnValue = ''; d.onclose = function () { res(d.returnValue === 'yes') }; d.showModal(); $('cfNo').focus();
  });
}

/* ---------------------------------------------------------------- local sounds (same database as index.html / studio.js; structure unchanged) */
function idbOpen(name, store, key) {
  return new Promise(function (res, rej) {
    if (!window.indexedDB) return rej(new Error('no idb'));
    var r = indexedDB.open(name, 1);
    r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store, { keyPath: key }) };
    r.onsuccess = function () { res(r.result) }; r.onerror = function () { rej(r.error) }; r.onblocked = function () { rej(new Error('blocked')) };
  });
}
function idbDo(dbp, store, mode, fn) {
  return dbp.then(function (d) { return new Promise(function (res, rej) { var tx = d.transaction(store, mode), out = fn(tx.objectStore(store)); tx.oncomplete = function () { res(out && out.result) }; tx.onerror = function () { rej(tx.error) } }) });
}
var ringsDB = null;
function rings(mode, fn) { if (!ringsDB) ringsDB = idbOpen('snipring', 'rings', 'id'); return idbDo(ringsDB, 'rings', mode, fn) }
function loadLocal() { return rings('readonly', function (s) { return s.getAll() }).then(function (a) { return (a || []).sort(function (x, y) { return y.id - x.id }) }).catch(function () { return [] }) }
/* read-modify-write in one transaction so a concurrent edit in another tab is not lost */
function patchLocal(id, fn) {
  return rings('readwrite', function (s) { var g = s.get(id); g.onsuccess = function () { var r = g.result; if (r && fn(r) !== false) s.put(r) }; return g });
}
function localBytes(r) { return r.data ? Promise.resolve(r.data) : r.blob ? r.blob.arrayBuffer() : Promise.reject(new Error('no data')) }

/* ---------------------------------------------------------------- server */
var sb = null, user = null, session = null, gen = 0, ctl = null;
function client() {
  if (!sb) sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return sb;
}
function token() { return client().auth.getSession().then(function (r) { var s = r.data && r.data.session; if (!s) throw { code: 'unauthorized', status: 401 }; return s.access_token }) }
function api(path, init) {
  var signal = ctl && ctl.signal;
  return token().then(function (tok) {
    var h = Object.assign({ apikey: CFG.supabaseKey, authorization: 'Bearer ' + tok }, init.headers || {});
    return fetch(CFG.supabaseUrl + path, Object.assign({}, init, { headers: h, signal: signal, cache: 'no-store' }));
  }).then(function (res) {
    return res.text().then(function (txt) {
      var j = null; try { j = txt ? JSON.parse(txt) : null } catch (e) {}
      if (!res.ok) throw { status: res.status, code: (j && (j.error || j.code)) || 'http_' + res.status, retryable: !!(j && j.retryable) };
      return j;
    });
  }, function (e) { if (e && e.name === 'AbortError') throw e; if (e && e.status) throw e; throw { code: 'network', retryable: true } });
}
function rpc(fn, args) { return api('/rest/v1/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}) }) }
function fnCall(fn, body, headers) { return api('/functions/v1/' + fn, { method: 'POST', headers: headers, body: body }) }
function errMsg(e) {
  if (!e) return 'e_generic';
  if (e.status === 401 || e.code === 'unauthorized') return 'e_auth';
  if (e.code === 'network') return 'e_net';
  return T.en['e_' + e.code] ? 'e_' + e.code : 'e_generic';
}
function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function sha256(buf) { return crypto.subtle.digest('SHA-256', buf).then(function (h) { return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0') }).join('') }) }
function uuid() { if (crypto.randomUUID) return crypto.randomUUID(); var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128; var h = Array.from(b).map(function (x) { return x.toString(16).padStart(2, '0') }).join(''); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20) }

/* ---------------------------------------------------------------- state */
var cloud = [], local = [], usage = null, jobs = {}, queueDB = null;
function jobsDo(mode, fn) { return idbDo(queueDB, 'jobs', mode, fn) }
function putJob(j) { jobs[j.ringId] = j; return jobsDo('readwrite', function (s) { return s.put(j) }).catch(function () {}) }
function dropJob(id) { delete jobs[id]; return jobsDo('readwrite', function (s) { return s.delete(id) }).catch(function () {}) }

function refresh() {
  var my = gen;
  return Promise.all([
    rpc('library_usage').catch(function (e) { return null }),
    api('/rest/v1/library_items?select=id,name,type,duration_ms,size_bytes,origin,created_at&order=created_at.desc', { method: 'GET' }).catch(function (e) { if (errMsg(e) === 'e_auth') throw e; say(errMsg(e), null, true); return null }),
    loadLocal()
  ]).then(function (r) {
    if (my !== gen) return;
    usage = r[0]; if (r[1]) cloud = r[1]; local = r[2];
    render();
  });
}

/* ---------------------------------------------------------------- upload queue */
function enqueue(rec) {
  var j = { ringId: rec.id, client_key: uuid(), state: 'queued', error: '', at: Date.now() };
  return putJob(j).then(function () { render(); work() });
}
var working = false;
function work() {
  if (working || !user) return;
  var my = gen, uid = user.id;
  var run = function () {
    working = true;
    var next = function () {
      if (my !== gen) return Promise.resolve();
      var j = Object.keys(jobs).map(function (k) { return jobs[k] }).filter(function (x) { return x.state === 'queued' || x.state === 'uploading' }).sort(function (a, b) { return a.at - b.at })[0];
      if (!j) return Promise.resolve();
      return upload(j, my).then(next);
    };
    return next().catch(function () {}).then(function () { working = false; if (my === gen) refresh() });
  };
  if (navigator.locks && navigator.locks.request) navigator.locks.request('snipring-upload-' + uid, run).catch(function () { working = false });
  else run();
}
function upload(j, my) {
  var rec = local.filter(function (r) { return r.id === j.ringId })[0];
  if (!rec) return dropJob(j.ringId);
  j.state = 'uploading'; putJob(j); render();
  var bytes, sha;
  return localBytes(rec).then(function (b) {
    bytes = b; if (b.byteLength > MAX_BYTES) throw { code: 'file_too_large' };
    return sha256(b);
  }).then(function (h) {
    sha = h;
    var meta = { client_key: j.client_key, type: TYPES.indexOf(rec.type) >= 0 ? rec.type : 'ring', origin: ORIGINS.indexOf(rec.origin) >= 0 ? rec.origin : 'mine', name: String(rec.name || 'SnipRing').slice(0, 200) };
    return fnCall('library-upload', bytes, { 'content-type': 'audio/mpeg', 'x-library-meta': b64url(JSON.stringify(meta)) });
  }).then(function (r) {
    if (my !== gen) return;
    var uid = user.id;
    return patchLocal(rec.id, function (x) { x.cloudCopy = { id: r.id, sha: sha, uid: uid } }).then(function () {
      track('cloud_save_completed', { result: r.status === 'duplicate' ? 'duplicate' : 'ready' });
      say(r.status === 'duplicate' ? 'dup' : 'done', { n: rec.name });
      return dropJob(j.ringId);
    });
  }).catch(function (e) {
    if (e && e.name === 'AbortError') return;         // account changed: the job stays queued for its own user
    if (my !== gen) return;
    if (e.code === 'job_closed' || e.code === 'expired') { j.client_key = uuid(); j.state = 'queued'; j.tries = (j.tries || 0) + 1; if (j.tries < 3) return putJob(j) }
    if (e.retryable && (j.tries || 0) < 3) { j.tries = (j.tries || 0) + 1; j.state = 'queued'; return putJob(j).then(function () { return new Promise(function (r) { setTimeout(r, 2000 * j.tries) }) }) }
    j.state = 'failed'; j.error = errMsg(e); track('cloud_save_failed', { reason: e.code || 'unknown' });
    say(j.error, null, true); if (j.error === 'e_auth') signedOutView();
    return putJob(j);
  });
}
/* after a crash or reload: ask the server what happened to jobs that were mid-upload (same client_key = no duplicate) */
function resume() {
  var mid = Object.keys(jobs).map(function (k) { return jobs[k] }).filter(function (j) { return j.state === 'uploading' });
  if (!mid.length) return Promise.resolve();
  return rpc('library_job_status', { p_client_keys: mid.map(function (j) { return j.client_key }) }).then(function (rows) {
    (rows || []).forEach(function (r) { var j = mid.filter(function (x) { return x.client_key === r.client_key })[0]; if (j) j.serverState = r.state });
    mid.forEach(function (j) { if (j.serverState !== 'ready') { j.state = 'queued'; putJob(j) } });
  }).catch(function () {});
}

/* ---------------------------------------------------------------- actions */
var audio = null, playing = null;
function stopAudio() { if (audio) { audio.pause(); audio.src = ''; audio = null } playing = null }
function signedUrl(item) { return fnCall('library-download', JSON.stringify({ id: item.id }), { 'content-type': 'application/json' }).then(function (r) { return r.url }) }
function onPlay(item, b) {
  if (playing === item.id) { stopAudio(); render(); return }
  stopAudio(); b.disabled = true;
  signedUrl(item).then(function (u) {
    audio = new Audio(u); playing = item.id; audio.onended = function () { stopAudio(); render() };
    return audio.play();
  }).catch(function (e) { stopAudio(); say(errMsg(e), null, true) }).then(render);
}
function onDownload(item, b) {
  b.disabled = true;
  signedUrl(item).then(function (u) { var a = document.createElement('a'); a.href = u; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); track('cloud_download') })
    .catch(function (e) { say(errMsg(e), null, true) }).then(function () { b.disabled = false });
}
function onRestore(item, b) {
  b.disabled = true;
  var uid = user.id;
  signedUrl(item).then(function (u) { return fetch(u, { cache: 'no-store' }) }).then(function (r) { if (!r.ok) throw { code: 'not_found' }; return r.arrayBuffer() })
    .then(function (data) {
      return sha256(data).then(function (sha) {
        var rec = { id: Date.now(), name: item.name, secs: Math.round((item.duration_ms || 0) / 100) / 10, data: data, type: item.type, fav: false, origin: item.origin || 'mine', used: Date.now(), cloudCopy: { id: item.id, sha: sha, uid: uid } };
        return rings('readwrite', function (s) { return s.put(rec) });
      });
    }).then(function () { track('cloud_restore'); say('restored', { n: item.name }); return refresh() })
    .catch(function (e) { say(errMsg(e), null, true); b.disabled = false });
}
function onDelete(item) {
  ask(t('delQH', { n: item.name }), t('delQP'), t('delQY'), true).then(function (yes) {
    if (!yes) return;
    if (playing === item.id) stopAudio();
    return rpc('library_delete', { p_id: item.id }).then(function () {
      // the local copies stay; only the "saved in cloud" mark is removed
      return loadLocal().then(function (all) { return Promise.all(all.filter(function (r) { return r.cloudCopy && r.cloudCopy.id === item.id }).map(function (r) { return patchLocal(r.id, function (x) { delete x.cloudCopy }) })) });
    }).then(function () { track('cloud_delete'); say('deleted', { n: item.name }); return refresh() })
      .catch(function (e) { say(errMsg(e), null, true) });
  });
}
function onSave(rec) {
  ask(t('saveQH', { n: rec.name }), t('saveQP'), t('saveQY')).then(function (yes) { if (yes) { say(''); track('cloud_save_started'); enqueue(rec) } });
}

/* ---------------------------------------------------------------- render */
function render() {
  var u = usage, canSave = !!(u && u.enabled && u.uploads_open);
  $('notOnList').hidden = !(u && !u.enabled);
  $('closed').hidden = !(u && u.enabled && !u.uploads_open);
  $('usage').hidden = !(u && u.enabled);
  if (u && u.enabled) {
    $('usageTxt').textContent = t('usage', { i: u.items, mi: u.max_items, b: fmtMB(u.bytes), mb: Math.round(u.max_bytes / 1048576) });
    $('usageBar').style.width = Math.min(100, Math.max(u.items / u.max_items, u.bytes / u.max_bytes) * 100) + '%';
  }
  var cl = $('cloudList'); cl.textContent = '';
  $('cloudEmpty').hidden = cloud.length > 0;
  var localByCloud = {}; local.forEach(function (r) { if (r.cloudCopy && r.cloudCopy.uid === user.id) localByCloud[r.cloudCopy.id] = true });
  cloud.forEach(function (it) {
    var li = el('li', 'lib-item'), top = el('div', 'lib-top');
    var p = el('button', 'lib-play'); p.type = 'button'; p.setAttribute('aria-label', t(playing === it.id ? 'stop' : 'play') + ': ' + it.name); p.appendChild(icon(playing === it.id ? 'i-pause' : 'i-play'));
    p.addEventListener('click', function () { onPlay(it, p) });
    var nm = el('div', 'lib-name'); nm.appendChild(el('bdi', '', it.name)); nm.appendChild(el('small', 'num', fmtSecs((it.duration_ms || 0) / 1000) + ' · ' + fmtMB(it.size_bytes || 0) + ' MB'));
    top.appendChild(p); top.appendChild(nm);
    var acts = el('div', 'lib-acts');
    var d = btn(t('download'), 'i-download'); d.addEventListener('click', function () { onDownload(it, d) }); acts.appendChild(d);
    if (localByCloud[it.id]) { var s = el('span', 'lib-state'); s.appendChild(icon('i-check')); s.appendChild(el('span', '', t('onDevice'))); acts.appendChild(s) }
    else { var r = btn(t('restore'), 'i-phone'); r.addEventListener('click', function () { onRestore(it, r) }); acts.appendChild(r) }
    var x = btn(t('del'), 'i-trash', 'danger'); x.addEventListener('click', function () { onDelete(it) }); acts.appendChild(x);
    li.appendChild(top); li.appendChild(acts); cl.appendChild(li);
  });
  var ll = $('localList'); ll.textContent = '';
  $('localEmpty').hidden = local.length > 0;
  var inCloud = {}; cloud.forEach(function (c) { inCloud[c.id] = true });
  local.forEach(function (r) {
    var li = el('li', 'lib-item'), top = el('div', 'lib-top'), nm = el('div', 'lib-name');
    nm.appendChild(el('bdi', '', r.name)); nm.appendChild(el('small', 'num', fmtSecs(r.secs)));
    top.appendChild(nm);
    var j = jobs[r.id], cc = r.cloudCopy && r.cloudCopy.uid === user.id && inCloud[r.cloudCopy.id];
    if (cc) { var s = el('span', 'lib-state'); s.appendChild(icon('i-check')); s.appendChild(el('span', '', t('saved'))); top.appendChild(s) }
    else if (j && j.state !== 'failed') { top.appendChild(el('span', 'lib-state wait', t(j.state === 'uploading' ? 'uploading' : 'queued'))) }
    else {
      if (j) top.appendChild(el('span', 'lib-state err', t('failed')));
      var b = btn(j ? t('retry') : t('save'), 'i-cloud'); b.disabled = !canSave;
      b.addEventListener('click', function () { if (j) { dropJob(r.id).then(function () { enqueue(r) }) } else onSave(r) });
      top.appendChild(b);
    }
    li.appendChild(top);
    if (j && j.state === 'failed' && j.error) li.appendChild(el('small', 'lib-state err', t(j.error)));
    ll.appendChild(li);
  });
}

/* ---------------------------------------------------------------- sessions */
function signedOutView() { gen++; if (ctl) ctl.abort(); ctl = null; stopAudio(); user = null; cloud = []; jobs = {}; show('vOut') }
/* private beta: redeem an invite (from an invite link, or typed in the notice) */
function redeem(code) {
  return rpc('beta_redeem', { p_code: code }).then(function (v) {
    if (v === 'ok' || v === 'already') { say('inviteOk'); track('beta_joined', { result: v }) }
    else say(v === 'rate_limited' ? 'inviteRate' : 'inviteBad', null, true);
    if (v !== 'rate_limited') { try { localStorage.removeItem('snipring-invite') } catch (e) {} }
    return v;
  });
}
function pendingInvite() { try { return localStorage.getItem('snipring-invite') || '' } catch (e) { return '' } }
function startFor(u) {
  if (user && user.id === u.id) return;
  gen++; if (ctl) ctl.abort(); ctl = new AbortController(); stopAudio();
  user = u; cloud = []; jobs = {}; usage = null; say('');
  $('who').textContent = t('signedAs', { n: u.email || '' });
  show('vBusy');
  var my = gen;
  queueDB = idbOpen('snipring-cloud-' + u.id, 'jobs', 'ringId');
  jobsDo('readonly', function (s) { return s.getAll() }).then(function (all) {
    if (my !== gen) return;
    (all || []).forEach(function (j) { jobs[j.ringId] = j });
    return (pendingInvite() ? redeem(pendingInvite()).catch(function () {}) : Promise.resolve()).then(refresh).then(function () { if (my !== gen) return; show('vMain'); var h = document.querySelector('.lib-h'); h.tabIndex = -1; try { h.focus({ preventScroll: true }) } catch (e) {} return resume() }).then(function () { if (my === gen) { render(); work() } });
  }).catch(function (e) { if (my !== gen) return; if (errMsg(e) === 'e_auth') signedOutView(); else { show('vMain'); say(errMsg(e), null, true) } });
}

function boot() {
  applyLang();
  $('lang').addEventListener('click', function () { lang = lang === 'he' ? 'en' : 'he'; try { localStorage.setItem('snipring-lang', lang) } catch (e) {} applyLang(); if (user) { $('who').textContent = t('signedAs', { n: user.email || '' }); render() } });
  if (!ON || !window.supabase || !CFG.supabaseUrl) { show('vOff'); return }
  show('vBusy');
  client().auth.onAuthStateChange(function (ev, s) {
    // runs for this tab and for sign-in/out in other tabs; a different user aborts everything in flight
    setTimeout(function () { if (s && s.user) startFor(s.user); else signedOutView() }, 0);
  });
  window.addEventListener('online', function () { if (user) work() });
  $('inviteForm').addEventListener('submit', function (e) {
    e.preventDefault(); var c = $('inviteCode').value.trim(); if (!c || !user) return;
    var b = this.querySelector('button'); b.disabled = true;
    redeem(c).then(function (v) { if (v === 'ok' || v === 'already') { $('inviteCode').value = ''; return refresh() } })
      .catch(function (err) { say(errMsg(err), null, true) }).then(function () { b.disabled = false });
  });
  track('library_viewed');
}
boot();
})();
