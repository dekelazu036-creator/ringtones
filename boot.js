/* Runs before first paint on pages with a strict Content-Security-Policy (no inline scripts allowed there):
   applies the saved theme and language, and refuses to run inside a frame (clickjacking protection). */
(function () {
  // private beta: an invite link (?invite=CODE) unlocks the account UI on this device and is redeemed after sign-in
  try {
    var im = /[?&]invite=([A-Za-z0-9-]{8,40})(?:&|#|$)/.exec(location.search);
    if (im) {
      localStorage.setItem('snipring-invite', im[1]); localStorage.setItem('snipring-beta', '1');
      var iu = new URL(location.href); iu.searchParams.delete('invite'); history.replaceState(null, '', iu.pathname + iu.search + iu.hash);
    }
  } catch (e) {}
  if (window.top !== window.self) { try { window.top.location = window.self.location.href } catch (e) { document.documentElement.style.display = 'none' } }
  try {
    var t = localStorage.getItem('snipring-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    var l = localStorage.getItem('snipring-lang'); if (l === 'en') { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr' }
  } catch (e) {}
})();
