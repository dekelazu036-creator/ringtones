/* Runs before first paint on pages with a strict Content-Security-Policy (no inline scripts allowed there):
   applies the saved theme and language, and refuses to run inside a frame (clickjacking protection). */
(function () {
  if (window.top !== window.self) { try { window.top.location = window.self.location.href } catch (e) { document.documentElement.style.display = 'none' } }
  try {
    var t = localStorage.getItem('snipring-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    var l = localStorage.getItem('snipring-lang'); if (l === 'en') { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr' }
  } catch (e) {}
})();
