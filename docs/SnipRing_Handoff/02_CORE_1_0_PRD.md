# Core 1.0 — Approved Scope and Acceptance
## In scope
- Guest ringtone maker: upload, waveform, trim, preview, export, device instructions, **no account/payment required**.
- Accounts: Email OTP and Google, optional signup after value, secure sessions and logout.
- My Library: user-confirmed cloud save, list, preview, download, delete, private cross-device access; preserve IndexedDB guest creations.
- Discover: initial catalogue of rights-cleared original/licensed sounds, playback, search by name/category/tags, filters, Use Sound into editing.
- Mobile/desktop, English/Hebrew, accessibility, privacy, monitoring, backups and self-service account deletion before public accounts launch.
## Out of scope
Studio Alpha, full-song AI, marketplace transactions, creator social network, royalty platform, AI credits, advanced folders/versioning. Video-to-Sound, advanced Smart Cut, alarm/notification creation are Create 2.0 unless already safely present.
## Acceptance tests
Guest create/export on iPhone, Android and desktop; auth failures preserve work; account A cannot access B's assets; concurrent quota tests; cross-device retrieval; failed upload recovery; no silent bulk upload; Discover content licenses verified; responsive RTL/LTR; self-service deletion and restore drill before public launch.
## Metrics
Guest export completion, time-to-export, errors, signup conversion, cloud-save success, Discover play-to-use. Never send private filenames/audio/tokens to analytics.
