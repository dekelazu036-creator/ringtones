# SnipRing — project context for Claude sessions

Last updated: 2026-10-08. Owner: Dekel. Live site: https://snipring.com (GitHub Pages, repo `dekelazu036-creator/ringtones`).
This file is the single source of context. It is public (served by GitHub Pages like every repo file): never put personal data or secrets in it. Read it fully before doing anything. **No secrets belong in this file or anywhere in the repo.**

---

## 1. Product, audience, business model

**What it is.** SnipRing turns any song or video on the user's phone into a ringtone (iPhone first, Android too), in the browser.
Pick a file → the chorus/drop is found automatically → trim (≤ 29.5 s for iPhone) → export MP3 / share → "Use as ringtone" (iOS label: `שימוש כצלצול`).
Tagline: **"השיר שלכם. הצלצול שלכם." / "Your song. Your ringtone."** Trust message: *free, no sign-up, the file never leaves your phone.*

**Why.** Making a ringtone from a song on iPhone is cumbersome (GarageBand, ~14 steps). SnipRing does it in three.

**Expansion (approved 6-phase plan).** From ringtones to a personal sound platform — *"Snip any sound. Create any sound. Make it yours."*
- **Snip:** song / video / mic recording → sound.
- **Create:** Sound Studio (`studio.html`), melody-from-a-name, voice effects, voice dedication, (later) AI sound generator.
- **Discover:** gallery of official sounds, packs, creators (`discover.html`, Supabase-backed, read-only today).

**Audience.** Phone users who want a personal ringtone, notification or alarm sound. Launch **Israel first (Hebrew), then international (English)**. Bilingual from day one.

**Business model.** Freemium.
- **Core rule:** creating and exporting a ringtone is **free and never requires an account**. Sign-up is optional and offered only *after* value.
- Tiers: guest → free account → Pro/Studio (planned, not built). Price to *test* (not final): ₪9.90/month or ₪49 lifetime.
- Pro ideas: unlimited, full manual editing, personal cloud library/history. Referral idea: friend joins = free Pro ringtone for both.
- Marketing: **zero ad budget at first (organic only)** — short video (TikTok/Reels/Shorts), SEO guide pages, honest community answers (Reddit, Facebook groups), product virality ("send to a friend"). **Meta (Facebook/Instagram) is the first paid-ads platform** when ads start.
- Never promise "download any song", never quote lyrics, only use platform-licensed audio in videos.

---

## 2. Decisions and why

### Technical / architecture
| Decision | Why |
|---|---|
| Static site on GitHub Pages, vanilla HTML/CSS/JS, no framework, no build step | Simple, free, fast; owner can follow every change |
| All audio processing in the browser (Web Audio, `vendor/lame.min.js` MP3 encoder, self-hosted) | Privacy promise: the guest's file never leaves the device; no server cost |
| Local storage: IndexedDB `snipring` v1, store `rings` (keyPath `id` = `Date.now()`), record `{id,name,secs,data:ArrayBuffer,type,fav,origin,used}`, prune keeps 30 (oldest non-favourite deleted). `studio.js` also opens v1 | ArrayBuffer instead of Blob because of Safari; **do not change this structure without approval** |
| Chorus detection by repetition (chroma self-similarity), not loudness | Loudness picked wrong parts |
| Exported file name `<song> - ringtone.mp3`, ID3 title = chosen name | Never confused with the original |
| Service worker `sw.js` (cache `snipring-v7`): pages network-first, static stale-while-revalidate; `config.js`, `account.html`, `auth.js`, `boot.js`, `vendor/supabase*` and `/media/` are never cached | Updates show immediately; auth always fresh |
| Self-hosted fonts and encoder; only third-party requests are analytics | Compliance / privacy |
| Supabase as backend (Postgres, Auth, Storage, Edge Functions), publishable key in `config.js` | Fastest safe path. **Tension:** Dekel prefers owning the stack over depending on platforms — keep Supabase usage portable (plain SQL, standard Postgres, thin Edge Functions) |
| supabase-js **2.109.0** vendored with SRI (`vendor/supabase-2.109.0.js`), same version pinned in Edge Functions | Reproducible, verified build |

### Accounts (Phase 1A — built, **switched off**)
- `config.js` → `auth.enabled: false`. Visible only in owner mode `snipring.com/?me` on that device.
- Methods: **email 6-digit OTP** (typed in the same tab) and **Google** (OAuth PKCE). *No magic links* — on iPhone they open in a different browser. Apple Sign-in: later, decided by iPhone signup data.
- Turnstile on signups; neutral messages (no account enumeration); `return` param same-site only; sign-out local or global; local sounds untouched by sign-out.
- In-app browsers (Instagram/TikTok/Facebook): banner + "copy link", email first (Google blocks OAuth in webviews).
- `profiles` table is **private** (owner reads own row only; update limited to `display_name`, `locale`), created by a security-definer trigger.
- `account.html` has a strict CSP, `noindex`, frame-busting and **never loads the Meta Pixel**.

### Cloud library (Phase 1B — designed, M0 done, M1 in progress)
Approved decisions D1–D13:
- **D1** Guest creation stays local; cloud save only on explicit choice + confirmation. No automatic or bulk upload.
- **D2** Duplicate detection by content SHA-256 (per user), including concurrent duplicates (per-user lock).
- **D3** Beta limits: 100 items, 100 MB counted, 150 MB physical (incl. bytes still being released), 10 MiB per file, 3 concurrent uploads, 30 per hour, 800 MB per project (Free plan has 1 GB).
- **D4** The browser has **no Storage access at all** (no policies on bucket `user-media`). Everything goes through three Edge Functions: `library-upload`, `library-download`, `library-janitor`.
- **D5** No recycle bin; clear confirmation + reliable server-side cleanup.
- **D6** Residual risk of third-party script on the same origin reading the session token: accepted **for private beta only**. Before public launch an explicit security decision is required (options: mandatory CSP incl. `index.html`, no third-party scripts when signed in).
- **D7** Separate staging Supabase project on Free.
- **D8** Sign-out with the last remaining copy of an unfinished creation → default "Restore to device".
- **D9** No independent cloud-media backups in private beta; disclose it; originals stay on the device. Revisit before public.
- **D10** No cloud renaming in beta.
- **D11** Optional `cloudCopy: {id, sha}` field on local `rings` records (no structural change, old records stay compatible).
- **D12** Staging two-account tests run from the owner's computer (this cloud workspace cannot reach supabase.co).
- **D13** If a 10 MiB upload through the function fails on staging → lower the cap first; signed upload URL only if unavoidable.

Architecture rules (keep them):
- User id only from a verified session (`auth.getUser`), never from the request body. API keys / non-JWT bearer → 401. Anonymous users → 401.
- Size, SHA-256 and **duration are measured by the server** on the received bytes. MP3 is validated by walking the MPEG Layer III frame chain (ID3 ≤ 512 KB, no smuggled trailing payload, consistent stream).
- One dispatcher `public.svc_library(op, args)`, executable by `service_role` only **and** checking the JWT role claim. All logic in schema `private` (not exposed). Every function `SECURITY DEFINER` + `set search_path = ''` + fully qualified names.
- Lock order: per-user row `private.library_usage FOR UPDATE` first, then the item row, then (begin only) the project advisory lock. No lock is held during Storage I/O.
- States: `uploading → ready → deleting → purged`, `uploading → abandoned → purged`. Reservation TTL 5 min, purge grace 10 min, tombstones dropped after 30 days. Physical quota is released **only after the object is confirmed gone**.
- Switches in `private.settings`: `reservations_open` (stops new uploads only; missing row = closed) and `emergency_stop` (stops begin + finish; download, delete and janitor keep working).
- Signed download URL lifetime fixed by the server: 300 s.
- Missing limit → error (fail closed), never "unlimited".
- `library_items.user_id` and `library_usage.user_id` are `on delete restrict`: an auth user with library data cannot be deleted by accident; account deletion must go through the reliable deletion path.

### Design
- Site design system lives in `app.css`: **one font, IBM Plex Sans Hebrew** (self-hosted); logo wordmark in **Karantina** ("Snip" in ink, "Ring" in accent); one SVG icon sprite (`icons.svg`); 4 px spacing scale; semantic colour tokens with **light and dark** (system preference + manual toggle).
- Light: bg `#F4F6FA`, accent `#2546F0`. Dark (default look in brand materials): bg `#0B0F19`, surface `#131A29`, accent `#7D92FF`, text on accent dark `#0B0F19` (never white).
- Borders over shadows, rounded (radii 8/12/16/20, pill), one accent per screen.
- Brand kit follows the **existing site colours** (decided; the earlier orange/lime proposal was dropped). Secondary mark: a ring with a cut and an accent dot in the gap. Original vector logo file still missing.
- Full RTL in Hebrew (logo top-right), LTR in English; language auto-detected from the device, toggle in header.
- Incoming-call preview is generic (iPhone-style slide / Android-style swipe), **no platform assets**.
- Accessibility: IS 5568 statement page, skip link, landmarks, keyboard waveform slider, accessibility menu.

### Privacy / analytics
- **Umami Cloud** (cookieless, no IP): all product + funnel events. Website id `db897ad6-80a9-43c7-9b29-d7474d5f4b73`, domains `snipring.com,www.snipring.com`.
- **Meta Pixel**: funnel milestones only, **loaded only after the visitor taps "Accept"**; `metaPixelId` in `config.js` is still empty (= off, no cookie notice). Never on `account.html`. Only `mode, seconds, method, source_type, plan, value, currency` go to Meta; every event has an `eventID` for future CAPI dedupe.
- No email, user id or name is ever sent to Umami or Meta. Funnel events carry `tier` (`guest`/`free`).
- Owner mode `?me` turns Umami and Meta off on that device (`?me=on` back on).
- Attribution in `localStorage['snipring-attr']` (first touch forever, last non-direct touch). UTM convention for Meta ads is in `ANALYTICS.md`.
- Raise `consentVersion` in `config.js` after a material privacy change.

### Marketing (approved plan, separate artifacts)
- Organic-first 90-day plan, Israel then international, thresholds gate each phase. Weekly content series (song of the week, before/after vs GarageBand, reply-to-comments, quick tips, street test, embarrassing ring, behind the scenes).
- AI agent team proposed (trends, scripts, SEO, community, analytics, ads, video) — **drafts only, human approval before anything is published**.
- Three scheduled agents created 2026-10-07 (Asia/Jerusalem): daily 08:45 trends + script brief; Sun/Wed 10:10 SEO article; Sun/Tue/Thu 19:10 community questions.

---

## 3. Roadmap

### Done (in production unless noted)
1. MVP cutter: upload, chorus detection, trim ≤ 29.5 s, start/end handles, naming, direct iOS share.
2. Hebrew + English, SEO guide pages (`iphone-ringtone`, `android-ringtone`, `video-ringtone`, `contact-ringtone` and Hebrew/alt variants) with HowTo/FAQ data, sitemap, robots.
3. Terms + Privacy (he/en), accessibility statement, PWA (manifest, icons, iPhone install hint), og:image, demo video.
4. Android flow, My ringtones on device (rename, duplicate, favourites, edit again), offline support.
5. Fun features: mic recording (raw capture for iPhone), melody from a name, voice effects, voice dedication, call preview, text-tone and alarm modes.
6. Design-system overhaul (one font, SVG icons, tokens, dark mode).
7. Analytics layer, attribution, consent-gated Meta Pixel (pixel id not set yet).
8. Sound platform Phase 1 (video → sound, new sound types, My sounds), Phase 2 Discover (Supabase schema v1, read-only gallery), Phase 3 Sound Studio.
9. **Phase 1A accounts** — built, configured and owner-tested in production, **switched off**.
10. **Phase 1B M0** — branch `phase-1b-m0` (pushed, **not merged**): `supabase/library_1b.sql`, cron + teardown SQL, 3 Edge Functions (+ single-file bundles in `supabase/functions/dist/`), 168 local tests passing (`supabase/tests/run_all.sh`), `STAGING.md`, `TEST_MATRIX.md`, staging test runner. `schema.sql` fixed (profiles private).

### In progress — Phase 1B M1 (staging validation)
Done: staging project `snipring-staging` created; two test users A/B (the owner's Gmail address with `+a` / `+b`); Supabase connector attached to Claude.
**Blocked:** Supabase connector `apply_migration` calls return `cancelled` (reads via `execute_sql` work). Fallback: owner pastes SQL in the SQL Editor.
Next steps, in order:
1. Run on **staging only**: `schema.sql` → `auth_1a.sql` → `library_1b.sql` → beta snippet:
   ```sql
   insert into private.cloud_access (user_id)
   select id from auth.users where email in ('<owner>+a@gmail.com','<owner>+b@gmail.com');
   update private.settings set value = 'true' where key = 'reservations_open';
   ```
2. `supabase/tests/policy_audit.sql` + Supabase security advisors; compare with the expected list.
3. Deploy the 3 functions (upload/download `verify_jwt` on, janitor off). Owner sets function secrets `ALLOWED_ORIGINS=http://localhost:8080` and `JANITOR_SECRET` (48+ random chars, password manager).
4. Enable `pg_cron` + `pg_net`, create Vault secrets `library_project_url` and `library_janitor_secret`, run `library_1b_cron.sql`.
5. Owner runs `node supabase/tests/staging/staging_test.mjs --slow` with env vars (passwords typed locally only), then manual checks T15, T16, T18, T19, T26 (`TEST_MATRIX.md`).
6. Fix failures on the branch; M1 exit = all staging tests pass, audit matches, risks R1/R2 closed, `library_health` clean for 24 h.

### Planned
- **M2:** `library.html` (separate page) + local upload queue (per-user DB `snipring-cloud-<uid>`, owner binding, Web Lock, AbortController on account switch, last-copy dialog D8, `cloudCopy` D11, blocked `deleteDatabase`, storage-shortage handling). Test against staging.
- Then: production rollout of 1B (owner runs production SQL), private beta via allow-list.
- **Launch blockers (keep):** Supabase plan decision (Free vs Pro); self-service account deletion including media; legal review of Terms/Privacy. Before public: D6 decision, media backup policy, alerting, global rate limiting / Turnstile on upload.
- Later phases: Pro/Studio tiers and payments, AI sound generator, creators/Discover uploads with moderation, Apple sign-in.

---

## 4. How Dekel wants to work

- **Reply in Hebrew** (he corrects English replies with "בעברית"). Code, commits, repo docs (like this file) in English.
- **Always give links in a copyable code block.**
- **Step-by-step guidance** ("תדריך אותי") for anything he does in a dashboard: one screen at a time, exact button names, tell him what to send back. He often replies with phone photos of the screen — read them carefully.
- **Concise reports.** At the end: what was done, what was not, what is blocked, what needs approval.
- **Approval gates:** never move to the next phase/milestone without explicit approval. "Approving the direction is not approval to implement."
- Prefers MVP first, then strengthen; precise roadmaps; owning the code.
- Clearly label **TESTED / NOT TESTED / BLOCKED / REQUIRES APPROVAL**. Do not claim something works without testing it; do not weaken tests to make them pass.

### Hebrew writing conventions (site and docs)
- Address users in plural ("בחרו", "השיר שלכם"); short, active, verb first.
- Avoid mixed-direction phrases that render in the wrong order (Latin + numbers + Hebrew in one run). Rephrase, or isolate with `<bdi>` / `.num` (`unicode-bidi:isolate`). Put `dir="ltr"` on domains/codes.
- Hebrew joiner before Latin/acronyms uses maqaf: `ה־API`, `ב־staging`.
- In Hebrew date/number ranges write "עד" instead of an en dash.
- Match iOS labels exactly (`שימוש כצלצול`).
- Never "הורד כל שיר"; always "השיר שלך / הקובץ שלך".

---

## 5. Configured manually outside the code (no secrets here)

| Service | What is set up |
|---|---|
| **Domain** | `snipring.com` bought via **Cloudflare**. `CNAME` file → GitHub Pages. |
| **Hosting** | GitHub Pages from `main` of `dekelazu036-creator/ringtones`. Merging to `main` = deploying. |
| **Supabase production** | Project `snipring`, ref `gtjtvfogqrnuiducvoqm`, region **eu-central-1**, Free plan, org `fwbpzcottjvuyqcwwkci`. `schema.sql` (older version) and `auth_1a.sql` run by the owner. Auth: Site URL `https://snipring.com`, redirect `https://snipring.com/account.html**`, Email OTP 6 digits / 600 s, Confirm email on, anonymous sign-ins off, OTP template from `supabase/email-templates/otp.html` in "Magic link" and "Confirm signup". Custom SMTP via Resend. Turnstile secret in Attack Protection. Google provider on. No 1B objects in production. |
| **Supabase staging** | Project `snipring-staging`, ref `kavomvsvufqnqjepbevs`, region **eu-west-1** (differs from production; fine for correctness tests), Free. Email provider, Confirm email off. Two test users A (`+a`) and B (`+b`); look up their UUIDs in Auth → Users. Nothing migrated yet. Default privileges on `public` still grant new tables/functions to API roles — our SQL revokes explicitly. |
| **Resend** | Domain `mail.snipring.com` verified (DKIM + SPF, eu-west-1); sender `SnipRing <noreply@mail.snipring.com>`; restricted sending key used only as Supabase SMTP password. |
| **Cloudflare Turnstile** | Widget "SnipRing auth", Managed, hostname `snipring.com`; public site key `0x4AAAAAAFQ0O8x3Ke3kRuTq` in `config.js`. |
| **Google Cloud** | Project "SnipRing", OAuth consent External, **In production**, basic scopes, web client with origin `https://snipring.com` + Supabase callback. Consent screen shows the Supabase domain (custom auth domain is a paid add-on). |
| **Umami Cloud** | Website for snipring.com (id above). Reports to create: funnel, UTM breakdown, goal `export_completed` (see `ANALYTICS.md`). |
| **Meta** | Pixel **not created/configured yet** (`metaPixelId: ''`). Setup checklist in `ANALYTICS.md`. Instagram business account / Facebook page linking was being prepared in the marketing session; status unverified. |
| **Claude artifacts** | Brand kit: `https://claude.ai/artifact/7istGkWd44Q5SnruYLVPW5`. Phase 1B plan v3: `https://claude.ai/code/artifact/4b761e93-3f5c-47d0-9386-8227ab69163f`. M0 report: `https://claude.ai/code/artifact/544f8657-c9b9-443a-a6a5-46a9d6dca077`. Marketing plan doc lives in the "מערך שיווק" chat. |
| **Claude scheduled tasks** | 3 marketing agents (see §2 Marketing), drafts only. |

Secrets that exist **only** in dashboards / password manager: Supabase DB passwords and secret keys (both projects), Google OAuth client secret, Resend key, Turnstile secret, staging test-user passwords, future `JANITOR_SECRET`.

---

## 6. Known issues, failed attempts, and things that must not break

### Must not break
- Guest flow: create + preview + export **without an account**, no signup wall anywhere.
- Audio processing, chorus detection, MP3 encoding, IndexedDB `snipring` v1 / `rings` structure, prune-30 logic, Studio projects.
- Existing local sounds must survive every change (sign-in, sign-out, cloud features).
- Mobile + desktop, Hebrew RTL + English LTR, light + dark, the current design.
- `?me` owner mode, consent gating of Meta, no personal data to analytics.
- `config.js` must never be cached; must contain public identifiers only.
- Production Supabase: no SQL, policy changes, buckets or function deploys without explicit approval — **the owner runs production SQL himself**. No paid services. `auth.enabled` stays `false`. No public cloud saving.
- No song-download features, no fake AI.

### Lessons / things that did not work
- Magic links on iPhone open another browser → switched to typed OTP codes.
- Google OAuth is blocked inside in-app webviews → banner + copy link, email first.
- iPhone MediaRecorder output could not be decoded reliably → raw mic capture.
- Safari IndexedDB with Blob was unreliable → store ArrayBuffer.
- "Edit again" re-applied effects twice → fixed by resetting effects.
- Mixed-direction Hebrew in the OTP email rendered out of order → rephrased.
- Earlier brand kit (orange/lime, Rubik) clashed with the site → replaced by site colours.
- This cloud workspace cannot reach supabase.co, npm, jsr, deno.land or GitHub raw (egress policy). Tests run against a local Postgres 16 stub (`supabase/tests/stub_supabase.sql`); real-platform checks need staging.
- psql treats an identifier named `begin` inside `CREATE FUNCTION` as a `BEGIN ATOMIC` body → whole file runs as one transaction. Never name helpers `begin`.
- Postgres `jsonb` rejects `\u0000` → strip control characters before RPC.
- Within one SQL statement a volatile function's writes are invisible to sibling subqueries (snapshot) — split assertions in tests.
- Supabase connector: `apply_migration` returned `cancelled` repeatedly even after permissions were set to allow; cause unknown.
- Local git: branch upstream had to be set manually (`remote.origin.fetch` only listed `main` and `phase-1a-auth`).

### Open risks (Phase 1B)
R1 unknown request-body limit for 10 MiB through Edge Functions · R2 hosted behaviour (sb_secret → `service_role` claim in PostgREST; `postgres` reading `storage.objects`) not yet verified · R3 Edge Functions hold the secret key · R4 signed URL shareable for 300 s · R5 MP3 check is structural, not a decode · R6 per-user rate limits only · R7 no alerting · R8 = D6 · R9 = D9 · R10 no TypeScript type-check / Deno run yet.

---

## 7. Open ideas and undecided questions

- Supabase plan: stay Free (no backups, pauses after 7 days idle, 150 s function limit) or Pro $25/month — launch blocker.
- D6 security decision before public launch (site-wide CSP vs. no third-party scripts when signed in).
- Recreate staging in eu-central-1 to match production latency? (optional)
- How to unblock the Supabase connector writes, or keep using manual SQL Editor runs.
- Pricing and Pro feature set (test ₪9.90/month vs ₪49 lifetime); payments provider not chosen.
- Apple Sign-in (decide from iPhone signup data).
- Media backup policy before public launch; global rate limiting / Turnstile on upload; monitoring/alerting for the janitor.
- Original SnipRing vector logo file (missing) and an iPhone screen recording of the full flow for the video agent.
- Meta Pixel creation and Instagram/Facebook business setup.
- Referral programme ("friend joins = free Pro ringtone").
- AI sound generator, creator uploads to Discover with moderation and copyright checks.
- Long-term: reduce platform dependency (Dekel prefers owning the stack).

---

## Repo map (quick)
- `index.html` creator (main app) · `studio.html/js` Sound Studio · `discover.html/js` gallery · `account.html` + `auth.js` + `auth-state.js` + `boot.js` accounts · `app.css` design system · `config.js` public config · `sw.js` offline · `legal.*`, `privacy.html`, `terms.html`, `accessibility.html` · guide pages `*-ringtone.html`.
- `supabase/`: `schema.sql`, `auth_1a.sql` (+ rollback, tests), `library_1b.sql`, `library_1b_cron.sql`, `library_1b_teardown.sql`, `functions/`, `tests/`, `STAGING.md`, `email-templates/`.
- Docs: `AUTH.md`, `ANALYTICS.md`, `supabase/STAGING.md`, `supabase/tests/TEST_MATRIX.md`, `supabase/tests/README.md`.
- Tools: `tools/build_discover.py`, `tools/make_sounds.py`, `tools/bundle_functions.mjs`.
- Run local checks: `supabase/tests/run_all.sh` (needs Postgres 16, Node 22+, ffmpeg).
