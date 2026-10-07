/* SnipRing account page (Phase 1A): sign in with Google or with a 6-digit email code, see who is signed in, sign out.
   Runs only on /account.html, which never loads the Meta Pixel and has a strict Content-Security-Policy.
   Uses the official supabase-js client (vendor/supabase-2.109.0.js) with the PKCE flow. No secrets here. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id) };
var CFG = window.SNIPRING_CONFIG || {}, A = CFG.auth || {};
var owner = false; try { owner = localStorage.getItem('umami.disabled') === '1' } catch (e) {}
var ON = !!A.enabled || owner;

/* ---------------------------------------------------------------- text */
var lang = (function () { try { var v = localStorage.getItem('snipring-lang'); if (v === 'he' || v === 'en') return v } catch (e) {} return /^he|^iw/i.test(navigator.language || '') ? 'he' : 'en' })();
var T = {
  he: {
    skip: 'דלגו לתוכן', back: 'חזרה', langBtn: 'English', toHome: 'לדף הבית',
    offH: 'החשבונות יגיעו בקרוב', offP: 'בינתיים אפשר ליצור רינגטונים ולהוריד אותם בלי חשבון, כמו תמיד.',
    busy: 'רגע…', finishing: 'משלים את ההתחברות…',
    h1: 'כניסה לחשבון SnipRing', sub: 'חשבון חינמי שומר את הצלילים שלכם. יצירה והורדה עובדות גם בלי חשבון.',
    perk1: 'הצלילים שלכם נשמרים בחשבון', perk2: 'גישה מכל מכשיר', perk3: 'מועדפים מהספרייה',
    inAppP: 'נראה שהאתר פתוח בתוך אפליקציה, וכאן התחברות עם Google לא עובדת. פתחו את הקישור בדפדפן Safari או Chrome, או התחברו עם קוד במייל.', copyLink: 'העתק קישור לדפדפן', copied: 'הקישור הועתק. הדביקו אותו בדפדפן Safari או Chrome.',
    google: 'המשך עם Google', or: 'או', emailL: 'כתובת מייל', sendCode: 'שלחו לי קוד',
    legal1: 'בהתחברות אתם מסכימים', termsL: 'לתנאי השימוש', terms: 'תנאי שימוש', legal2: 'ומאשרים שקראתם את', privacyL: 'מדיניות הפרטיות', privacy: 'מדיניות פרטיות', aStatement: 'הצהרת נגישות',
    codeH: 'הקלידו את הקוד', codeP: 'אם הכתובת תקינה, שלחנו קוד בן 6 ספרות אל', codeL: 'קוד בן 6 ספרות', verify: 'התחברות',
    resend: 'שליחה מחדש', resendIn: 'שליחה מחדש בעוד {n}', changeEmail: 'שינוי מייל', spamHint: 'לא הגיע? בדקו בתיקיית הספאם או קידומי מכירות.',
    inH: 'מחובר/ת', viaL: 'התחברות דרך', planL: 'חשבון', planFree: 'חינמי', via_google: 'Google', via_email: 'מייל',
    inNote: 'השמירה והסנכרון של הצלילים יתווספו בקרוב. הצלילים שיצרתם נשמרים בינתיים במכשיר הזה.',
    continue: 'חזרה לאתר', logout: 'התנתקות', logoutAll: 'התנתקות מכל המכשירים',
    loggedOut: 'התנתקתם. הצלילים שבמכשיר נשארו.', signedIn: 'התחברתם!',
    e_email: 'נא להקליד כתובת מייל תקינה.', e_code: 'הקוד צריך להיות 6 ספרות.', e_bad: 'הקוד שגוי או שפג תוקפו. נסו שוב או בקשו קוד חדש.',
    e_rate: 'יותר מדי ניסיונות. חכו דקה ונסו שוב.', e_captcha: 'בדיקת האבטחה לא עברה. נסו שוב.', e_net: 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.',
    e_google: 'ההתחברות עם Google לא הושלמה. אפשר לנסות שוב או להתחבר עם קוד במייל.', e_generic: 'משהו השתבש. נסו שוב.', e_captchaWait: 'רק רגע, בדיקת האבטחה עוד נטענת.'
  },
  en: {
    skip: 'Skip to content', back: 'Back', langBtn: 'עברית', toHome: 'Go to the home page',
    offH: 'Accounts are coming soon', offP: 'Meanwhile you can create and download ringtones without an account, as always.',
    busy: 'One moment…', finishing: 'Finishing sign-in…',
    h1: 'Sign in to SnipRing', sub: 'A free account saves your sounds. Creating and downloading work without one too.',
    perk1: 'Your sounds saved to your account', perk2: 'Access from any device', perk3: 'Favourites from the library',
    inAppP: 'It looks like this page is open inside an app. Google sign-in does not work here: open the link in Safari or Chrome, or sign in with an email code.', copyLink: 'Copy link for your browser', copied: 'Link copied. Paste it into Safari or Chrome.',
    google: 'Continue with Google', or: 'or', emailL: 'Email address', sendCode: 'Email me a code',
    legal1: 'By signing in you agree to the', termsL: 'Terms of Use', terms: 'Terms of Use', legal2: 'and confirm you have read the', privacyL: 'Privacy Policy', privacy: 'Privacy Policy', aStatement: 'Accessibility statement',
    codeH: 'Enter the code', codeP: 'If the address is valid, we sent a 6-digit code to', codeL: '6-digit code', verify: 'Sign in',
    resend: 'Send again', resendIn: 'Send again in {n}', changeEmail: 'Change email', spamHint: 'Nothing yet? Check your spam or promotions folder.',
    inH: 'Signed in', viaL: 'Signed in with', planL: 'Account', planFree: 'Free', via_google: 'Google', via_email: 'Email',
    inNote: 'Saving and syncing your sounds is coming soon. Until then, what you create stays on this device.',
    continue: 'Back to SnipRing', logout: 'Sign out', logoutAll: 'Sign out on all devices',
    loggedOut: 'You are signed out. The sounds on this device are still here.', signedIn: 'You are signed in!',
    e_email: 'Please enter a valid email address.', e_code: 'The code has 6 digits.', e_bad: 'That code is wrong or has expired. Try again or ask for a new one.',
    e_rate: 'Too many attempts. Wait a minute and try again.', e_captcha: 'The security check did not pass. Please try again.', e_net: 'No internet connection. Check it and try again.',
    e_google: 'Google sign-in was not completed. Try again, or sign in with an email code.', e_generic: 'Something went wrong. Please try again.', e_captchaWait: 'One moment, the security check is still loading.'
  }
};
function t(k, n) { var s = (T[lang] && T[lang][k]) || T.en[k] || k; return n != null ? s.replace('{n}', n) : s }
function applyLang() {
  var r = document.documentElement; r.lang = lang; r.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(function (e) { e.textContent = t(e.dataset.i18n) });
  $('lang').textContent = t('langBtn'); if (resendLeft > 0) paintResend();
  if (user) paintUser();
}

/* ---------------------------------------------------------------- analytics (Umami only; never the Meta Pixel; never email or ids) */
var q = [];
function track(n, d) { d = Object.assign({ tier: user ? 'free' : 'guest' }, d || {}); if (window.umami && umami.track) { try { umami.track(n, d) } catch (e) {} } else q.push([n, d]) }
function pageview() { var go = function () { try { umami.track(); q.forEach(function (x) { umami.track(x[0], x[1]) }); q = [] } catch (e) {} }; if (window.umami && umami.track) go(); else window.addEventListener('load', function () { if (window.umami && umami.track) go() }) }

/* ---------------------------------------------------------------- views */
var VIEWS = ['vOff', 'vBusy', 'vStart', 'vCode', 'vIn'];
function show(v) { VIEWS.forEach(function (id) { $(id).hidden = id !== v }); var h = $(v).querySelector('h1'); if (h && v !== 'vBusy') { h.tabIndex = -1; try { h.focus({ preventScroll: true }) } catch (e) {} } }
function msg(id, k) { $(id).textContent = k ? t(k) : '' }
function busy(btn, on) { btn.disabled = on; btn.classList.toggle('loading', on); btn.setAttribute('aria-busy', on ? 'true' : 'false') }

/* where to go after signing in: same-site paths only (blocks open redirects) */
function safeReturn(r) {
  if (!r) return '';
  try { var u = new URL(r, location.origin); if (u.origin !== location.origin || u.pathname === '/account.html') return ''; return u.pathname + u.search + u.hash } catch (e) { return '' }
}
var params = new URLSearchParams(location.search), RET = safeReturn(params.get('return'));
function cleanURL() { try { history.replaceState(null, '', '/account.html' + (RET ? '?return=' + encodeURIComponent(RET) : '')) } catch (e) {} }

/* ---------------------------------------------------------------- client */
var sb = null, user = null, method = '';
function client() {
  if (sb) return sb;
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  return sb;
}
function errKey(e) {
  if (!e) return 'e_generic';
  var c = (e.code || '') + ' ' + (e.message || '');
  if (e.status === 429 || /rate.?limit/i.test(c)) return 'e_rate';
  if (/captcha/i.test(c)) return 'e_captcha';
  if (/otp_expired|expired|invalid.*(token|otp)|token.*invalid/i.test(c)) return 'e_bad';
  if (e.name === 'AuthRetryableFetchError' || e.status === 0 || /fetch|network/i.test(c)) return 'e_net';
  return 'e_generic';
}

/* ---------------------------------------------------------------- Turnstile (only if a site key is configured) */
var cf = { ready: null, widgets: {}, tokens: {} };
function captchaOn() { return !!A.turnstileSiteKey }
function loadTurnstile() {
  if (!captchaOn()) return Promise.resolve(false);
  if (cf.ready) return cf.ready;
  cf.ready = new Promise(function (res) {
    var s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = function () { res(true) }; s.onerror = function () { res(false) }; document.head.appendChild(s);
  });
  return cf.ready;
}
function renderCaptcha(boxId) {
  if (!captchaOn()) return;
  loadTurnstile().then(function (ok) {
    if (!ok || !window.turnstile) return;
    var box = $(boxId); box.hidden = false;
    if (cf.widgets[boxId] != null) { turnstile.reset(cf.widgets[boxId]); cf.tokens[boxId] = ''; return }
    cf.widgets[boxId] = turnstile.render(box, { sitekey: A.turnstileSiteKey, language: lang, theme: 'auto',
      callback: function (tok) { cf.tokens[boxId] = tok }, 'expired-callback': function () { cf.tokens[boxId] = '' }, 'error-callback': function () { cf.tokens[boxId] = '' } });
  });
}
function captchaToken(boxId) { return captchaOn() ? (cf.tokens[boxId] || '') : undefined }
function captchaUsed(boxId) { if (captchaOn() && window.turnstile && cf.widgets[boxId] != null) { turnstile.reset(cf.widgets[boxId]); cf.tokens[boxId] = '' } }

/* ---------------------------------------------------------------- email code */
var email = '', resendLeft = 0, resendTimer = 0;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function sendCode(fromBox) {
  var tok = captchaToken(fromBox);
  if (captchaOn() && !tok) return Promise.reject({ code: 'captcha_wait' });
  return client().auth.signInWithOtp({ email: email, options: { shouldCreateUser: true, captchaToken: tok } }).then(function (r) { captchaUsed(fromBox); if (r.error) throw r.error });
}
function paintResend() { $('resendL').textContent = resendLeft > 0 ? t('resendIn', resendLeft) : t('resend'); $('resend').disabled = resendLeft > 0 }
function startResendTimer() {
  clearInterval(resendTimer); resendLeft = 60; paintResend();
  resendTimer = setInterval(function () { resendLeft--; paintResend(); if (resendLeft <= 0) clearInterval(resendTimer) }, 1000);
}
function onEmailSubmit(e) {
  e.preventDefault(); msg('startMsg');
  email = $('email').value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) { msg('startMsg', 'e_email'); $('email').focus(); return }
  var b = $('sendCode'); busy(b, true); method = 'email'; track('signup_started', { method: 'email' });
  sendCode('captcha').then(function () {
    track('otp_sent');
    $('sentTo').textContent = email; $('code').value = ''; msg('codeMsg'); show('vCode'); startResendTimer();
    setTimeout(function () { $('code').focus() }, 50);
  }).catch(function (err) {
    var k = err && err.code === 'captcha_wait' ? 'e_captchaWait' : errKey(err); msg('startMsg', k); track('otp_failed', { reason: k, step: 'send' });
  }).then(function () { busy(b, false) });
}
function onCodeSubmit(e) {
  if (e) e.preventDefault(); msg('codeMsg');
  var code = $('code').value.replace(/\D/g, '');
  if (code.length !== 6) { msg('codeMsg', 'e_code'); return }
  var b = $('verify'); busy(b, true);
  client().auth.verifyOtp({ email: email, token: code, type: 'email' }).then(function (r) {
    if (r.error) throw r.error; signedIn(r.data.session, true);
  }).catch(function (err) {
    var k = errKey(err); msg('codeMsg', k); track('otp_failed', { reason: k, step: 'verify' }); $('code').select();
  }).then(function () { busy(b, false) });
}

/* ---------------------------------------------------------------- Google (PKCE; Supabase returns here with ?code=) */
function onGoogle() {
  msg('startMsg'); method = 'google'; track('signup_started', { method: 'google' });
  var b = $('google'); busy(b, true);
  try { sessionStorage.setItem('snipring-auth-method', 'google') } catch (e) {}
  client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/account.html' + (RET ? '?return=' + encodeURIComponent(RET) : ''), queryParams: { prompt: 'select_account' } } })
    .then(function (r) { if (r.error) throw r.error })
    .catch(function (err) { busy(b, false); msg('startMsg', errKey(err)) });
}

/* ---------------------------------------------------------------- signed-in state */
function paintUser() {
  if (!user) return;
  var m = user.user_metadata || {}, name = m.full_name || m.name || '', prov = (user.app_metadata && user.app_metadata.provider) || 'email';
  $('whoEmail').textContent = user.email || '';
  $('avatar').textContent = (name || user.email || '?').trim().charAt(0).toUpperCase();
  $('via').textContent = t('via_' + (prov === 'google' ? 'google' : 'email'));
  $('continue').href = RET || '/';
}
function signedIn(session, fresh) {
  user = session && session.user; if (!user) { show('vStart'); return }
  paintUser();
  if (fresh) {
    var created = Date.parse(user.created_at || 0), isNew = created && Date.now() - created < 5 * 60 * 1000;
    var m = method || ((user.app_metadata && user.app_metadata.provider) === 'google' ? 'google' : 'email');
    track(isNew ? 'signup_completed' : 'login_completed', { method: m });
    try { sessionStorage.removeItem('snipring-auth-method') } catch (e) {}
    if (RET) { $('busyTxt').textContent = t('signedIn'); show('vBusy'); setTimeout(function () { location.replace(RET) }, 700); return }
  }
  show('vIn');
}
function logout(scope) {
  var b = $(scope === 'global' ? 'logoutAll' : 'logout'); busy(b, true);
  client().auth.signOut({ scope: scope }).catch(function () {}).then(function () {
    // the local session is always removed, even if the server could not be reached
    try { Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k) }) } catch (e) {}
    track('logout', { scope: scope }); user = null; busy(b, false);
    show('vStart'); msg('startMsg', 'loggedOut');
  });
}

/* ---------------------------------------------------------------- in-app browsers (Google blocks sign-in there) */
var INAPP = /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|BytedanceWebview|Line\/|Snapchat|LinkedInApp|Pinterest|Twitter/i.test(navigator.userAgent);

/* ---------------------------------------------------------------- boot */
function wire() {
  $('lang').addEventListener('click', function () { lang = lang === 'he' ? 'en' : 'he'; try { localStorage.setItem('snipring-lang', lang) } catch (e) {} applyLang() });
  $('backLink').href = RET || '/';
  $('emailForm').addEventListener('submit', onEmailSubmit);
  $('codeForm').addEventListener('submit', onCodeSubmit);
  $('code').addEventListener('input', function () { var v = this.value.replace(/\D/g, '').slice(0, 6); if (v !== this.value) this.value = v; if (v.length === 6) onCodeSubmit() });
  $('google').addEventListener('click', onGoogle);
  $('changeEmail').addEventListener('click', function () { clearInterval(resendTimer); resendLeft = 0; show('vStart'); $('email').focus() });
  $('resend').addEventListener('click', function () {
    var b = $('resend'); if (b.disabled) return; msg('codeMsg'); busy(b, true);
    var box = captchaOn() ? 'captcha' : null;
    sendCode(box).then(function () { track('otp_sent', { resend: 'yes' }); startResendTimer() })
      .catch(function (err) { msg('codeMsg', err && err.code === 'captcha_wait' ? 'e_captchaWait' : errKey(err)) }).then(function () { busy(b, false); paintResend() });
  });
  $('logout').addEventListener('click', function () { logout('local') });
  $('logoutAll').addEventListener('click', function () { logout('global') });
  $('copyLink').addEventListener('click', function () {
    var url = location.origin + '/account.html' + (RET ? '?return=' + encodeURIComponent(RET) : '');
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { msg('startMsg', 'copied') }).catch(function () { window.prompt('', url) });
  });
  if (A.google === false) { $('google').hidden = true; $('orRow').hidden = true }
  if (A.email === false) { $('emailForm').hidden = true; $('orRow').hidden = true }
  if (INAPP) { $('inApp').hidden = false; $('methods').classList.add('inapp') }   // email first; Google moves below
}
function boot() {
  applyLang(); wire();
  if (!ON || !window.supabase || !CFG.supabaseUrl) { cleanURL(); show('vOff'); pageview(); return }
  var code = params.get('code'), err = params.get('error') || params.get('error_description');
  if (code) {
    $('busyTxt').textContent = t('finishing'); show('vBusy');
    try { method = sessionStorage.getItem('snipring-auth-method') || 'google' } catch (e) { method = 'google' }
    client().auth.exchangeCodeForSession(code).then(function (r) {
      cleanURL(); pageview();
      if (r.error || !r.data || !r.data.session) throw r.error || new Error('no session');
      signedIn(r.data.session, true);
    }).catch(function () { cleanURL(); show('vStart'); msg('startMsg', 'e_google'); track('otp_failed', { reason: 'oauth', step: 'google' }); renderCaptcha('captcha') });
    return;
  }
  cleanURL(); pageview();
  if (err) { show('vStart'); msg('startMsg', 'e_google'); track('otp_failed', { reason: 'oauth', step: 'google' }); renderCaptcha('captcha'); return }
  client().auth.getSession().then(function (r) {
    if (r.data && r.data.session) signedIn(r.data.session, false);
    else { show('vStart'); renderCaptcha('captcha') }
    track('auth_viewed');
  }).catch(function () { show('vStart'); renderCaptcha('captcha') });
}
boot();
})();
