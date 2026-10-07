/* SnipRing public configuration.
   Only PUBLIC identifiers belong here (a Meta Pixel ID is public: it is visible in every page that uses it).
   Never put API keys, access tokens or Conversions API secrets in this file.
   Empty value = that integration is off, and no cookie notice is shown. */
window.SNIPRING_CONFIG = {
  metaPixelId: '',      // Meta Events Manager → Data sources → your pixel → "Pixel ID" (digits only)
  consentVersion: 1     // raise by 1 after a material privacy change, to ask everyone again
};
