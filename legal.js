(() => {
  const L = { he: { btn: 'English', home: 'חזרה ל‑SnipRing', terms: 'תנאי שימוש', privacy: 'מדיניות פרטיות', a11y: 'הצהרת נגישות' },
              en: { btn: 'עברית', home: 'Back to SnipRing', terms: 'Terms of Use', privacy: 'Privacy Policy', a11y: 'Accessibility statement' } };
  let lang;
  try { lang = localStorage.getItem('snipring-lang'); } catch (e) {}
  if (lang !== 'he' && lang !== 'en') lang = /^he|^iw/i.test(navigator.language || '') ? 'he' : 'en';
  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-lang]').forEach(a => { a.hidden = a.dataset.lang !== lang; });
    document.querySelectorAll('[data-l]').forEach(a => { a.textContent = L[lang][a.dataset.l]; });
    document.getElementById('lang').textContent = L[lang].btn;
  }
  document.getElementById('lang').addEventListener('click', () => {
    lang = lang === 'he' ? 'en' : 'he';
    try { localStorage.setItem('snipring-lang', lang); } catch (e) {}
    apply();
  });
  apply();
})();
