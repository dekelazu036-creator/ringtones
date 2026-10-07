/* SnipRing account state for every page. No auth library and no network requests here:
   it only reads the session that account.html stored on this device, to show the account button.
   The button stays hidden unless accounts are enabled in config.js or this device is in owner test mode (?me). */
(function () {
  var CFG = window.SNIPRING_CONFIG || {}, A = CFG.auth || {};
  var owner = false; try { owner = localStorage.getItem('umami.disabled') === '1' } catch (e) {}
  var on = !!A.enabled || owner;
  var ref = ''; try { ref = new URL(CFG.supabaseUrl).hostname.split('.')[0] } catch (e) {}
  var KEY = 'sb-' + ref + '-auth-token';
  function read() {
    try {
      var j = JSON.parse(localStorage.getItem(KEY) || 'null'), u = j && (j.user || (j.currentSession && j.currentSession.user));
      if (!u || !u.id) return null;
      var m = u.user_metadata || {};
      return { email: u.email || '', name: m.full_name || m.name || '' };
    } catch (e) { return null }
  }
  var S = window.SNIPRING_AUTH = { on: on, owner: owner, user: null, tier: 'guest' };
  var L = { he: { in: 'התחברות', me: 'החשבון שלי' }, en: { in: 'Sign in', me: 'My account' } };
  function paint() {
    S.user = on ? read() : null; S.tier = S.user ? 'free' : 'guest';
    var lang = document.documentElement.lang === 'en' ? 'en' : 'he', ret = location.pathname + location.search;
    var btns = document.querySelectorAll('.acctbtn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], init = b.querySelector('.acct-init'), ic = b.querySelector('svg');
      b.hidden = !on; if (!on) continue;
      b.href = '/account.html?return=' + encodeURIComponent(ret);
      b.classList.toggle('in', !!S.user);
      if (S.user) { var ch = (S.user.name || S.user.email || '?').trim().charAt(0).toUpperCase(); init.textContent = ch; init.hidden = false; ic.style.display = 'none'; b.setAttribute('aria-label', L[lang].me) }
      else { init.hidden = true; ic.style.display = ''; b.setAttribute('aria-label', L[lang].in) }
      b.title = b.getAttribute('aria-label');
    }
    document.documentElement.classList.toggle('auth-on', on);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
  window.addEventListener('storage', function (e) { if (!e.key || e.key === KEY) paint() });               // sign-in/out in another tab
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); // language switch
  window.addEventListener('pageshow', paint);                                                              // back/forward cache
})();
