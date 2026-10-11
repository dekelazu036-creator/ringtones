/* SnipRing public configuration.
   Only PUBLIC identifiers belong here (a Meta Pixel ID is public: it is visible in every page that uses it).
   Never put API keys, access tokens or Conversions API secrets in this file.
   Empty value = that integration is off, and no cookie notice is shown. */
window.SNIPRING_CONFIG = {
  metaPixelId: '',      // Meta Events Manager → Data sources → your pixel → "Pixel ID" (digits only)
  // Supabase (Discover library). The publishable key is designed to be public; access is limited by row-level security.
  supabaseUrl: 'https://gtjtvfogqrnuiducvoqm.supabase.co',
  supabaseKey: 'sb_publishable_t3dVqGlMKrpi_SeLMwiM2g_Y12HoRSp',
  // Accounts: PUBLIC since 2026-10-11 (optional; creating and exporting never needs one).
  // turnstileSiteKey is the PUBLIC site key; the secret lives only in Supabase.
  auth: { enabled: true, google: true, email: true, turnstileSiteKey: '0x4AAAAAAFQ0O8x3Ke3kRuTq' },
  consentVersion: 2     // 2026-10-11: cloud library + account deletion. Raise by 1 after a material privacy change, to ask everyone again
};
/* Local staging tests only. On localhost / 127.0.0.1, localStorage 'snipring-dev-supabase' =
   {"url":"https://<staging-ref>.supabase.co","key":"sb_publishable_..."} replaces the project above
   (public values only). Never active on snipring.com. Turnstile is off there: staging has no captcha. */
(function (C) {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    var o = JSON.parse(localStorage.getItem('snipring-dev-supabase') || 'null');
    if (!o || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(o.url) || !/^sb_publishable_[\w-]+$/.test(o.key)) return;
    if (/gtjtvfogqrnuiducvoqm/.test(o.url)) return;   // never production through this switch
    C.supabaseUrl = o.url; C.supabaseKey = o.key; C.auth.turnstileSiteKey = ''; C.dev = true;
  } catch (e) {}
})(window.SNIPRING_CONFIG);
