/* SnipRing public configuration.
   Only PUBLIC identifiers belong here (a Meta Pixel ID is public: it is visible in every page that uses it).
   Never put API keys, access tokens or Conversions API secrets in this file.
   Empty value = that integration is off, and no cookie notice is shown. */
window.SNIPRING_CONFIG = {
  metaPixelId: '',      // Meta Events Manager → Data sources → your pixel → "Pixel ID" (digits only)
  // Supabase (Discover library). The publishable key is designed to be public; access is limited by row-level security.
  supabaseUrl: 'https://gtjtvfogqrnuiducvoqm.supabase.co',
  supabaseKey: 'sb_publishable_t3dVqGlMKrpi_SeLMwiM2g_Y12HoRSp',
  // Accounts (Phase 1A). Ships switched OFF: only owner test mode (snipring.com/?me) can see it.
  // turnstileSiteKey is the PUBLIC site key; the secret lives only in Supabase.
  auth: { enabled: false, google: true, email: true, turnstileSiteKey: '0x4AAAAAAFQ0O8x3Ke3kRuTq' },
  consentVersion: 1     // raise by 1 after a material privacy change, to ask everyone again
};
