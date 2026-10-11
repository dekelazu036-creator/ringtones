/* SnipRing error monitoring: counts uncaught errors in Umami (cookieless), so a broken release shows up.
   Privacy: only the error type, our own script's file name and line number are sent. Never the message
   (it can contain a song or file name), never the URL query, never user data. At most 3 per page view.
   Owner mode (?me) turns Umami off on that device, so nothing is sent there. */
(function () {
  var sent = 0, seen = {}, q = [];
  function file(src) {
    try { var u = new URL(src, location.href); if (u.origin !== location.origin) return 'external'; return u.pathname.split('/').pop() || 'page' } catch (e) { return 'unknown' }
  }
  function send(d) {
    if (window.umami && umami.track) { try { umami.track('js_error', d) } catch (e) {} } else q.push(d);
  }
  function report(kind, name, src, line) {
    var d = { kind: kind, name: String(name || 'Error').slice(0, 40), file: file(src || ''), line: +line || 0, page: location.pathname.slice(0, 60) };
    var k = d.kind + d.name + d.file + d.line; if (seen[k] || sent >= 3) return; seen[k] = 1; sent++;
    send(d);
  }
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window) { report('resource', e.target.tagName, e.target.src || e.target.href, 0); return }  // failed script/style
    report('error', e.error && e.error.name, e.filename, e.lineno);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; report('rejection', r && (r.name || (r.constructor && r.constructor.name)) || typeof r, '', 0);
  });
  window.addEventListener('load', function () { setTimeout(function () { var x = q; q = []; x.forEach(send) }, 1500) });
})();
