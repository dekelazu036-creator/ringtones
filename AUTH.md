# SnipRing accounts — Phase 1A (identity foundation)

Status: **built, switched off** (`auth.enabled: false` in `config.js`). Visible only in owner test mode (`snipring.com/?me` on that device).

## Product rules
- Creating, previewing and downloading a ringtone never requires an account. No signup wall anywhere.
- Guest audio stays on the device. Nothing from Phase 1A uploads audio.
- Phase 1A = identity only: sign in, see who you are, sign out. No cloud library, no plans/entitlements, no Studio persistence.

## Architecture
| Piece | File | Notes |
|---|---|---|
| Account page | `account.html` + `auth.js` | Only page that loads the auth library. Strict CSP (meta), `noindex`, frame-busting, **no Meta Pixel ever** |
| Auth library | `vendor/supabase-2.109.0.js` (MIT, `vendor/LICENSE-supabase.txt`) | Official `@supabase/supabase-js` 2.109.0 UMD build, self-hosted. Verified identical to jsDelivr (sha256 `nMtwuZhgu4FZO9gIcI9uHthhRu8TjxlCo37rOFGdWoE=`, 206613 bytes) and pinned with SRI `sha384-QBRYTjAPttRJE6VS+3BZ2pbh2K1WYNBwquAji9CwlJx1Uwk9QxbOQ5GpBhBoj1xg`. PKCE flow, session in localStorage |
| Header button | `auth-state.js` (all pages) | No library, no network: reads the stored session to show the button / initial; sets `SNIPRING_AUTH.tier` (`guest`/`free`) |
| Pre-paint | `boot.js` | Theme + language before paint (inline scripts are not allowed by the CSP) |
| Database | `supabase/auth_1a.sql`, rollback `supabase/auth_1a_rollback.sql`, tests `supabase/tests/auth_1a_test.sql` | Private `profiles` + auto-create trigger |
| Email template | `supabase/email-templates/otp.html` | 6-digit code only, Hebrew + English |

Methods: **email one-time code** (6 digits, typed in the same tab — no magic links, which open in a different browser on iPhone) and **Google** (OAuth PKCE, returns to `account.html?return=…&code=…`). Apple: later, decided by iPhone signup data.

### Flows
- Email: `signInWithOtp({email, shouldCreateUser:true, captchaToken})` → code view → `verifyOtp({type:'email'})` → session → back to `return`.
- Google: `signInWithOAuth({provider:'google', redirectTo:/account.html?return=…})` → Supabase → Google → back with `?code` → `exchangeCodeForSession` → URL cleaned **before** the analytics page view → back to `return`.
- `return` accepts same-site paths only (open-redirect protection).
- Sign out: "this device" (`scope:local`) or "all devices" (`scope:global`); local token always removed; local sounds untouched.
- In-app browsers (Instagram/TikTok/Facebook…): banner + "copy link", email shown first (Google blocks OAuth in webviews).

### Feature flag (`config.js`)
`auth: { enabled, google, email, turnstileSiteKey }`. Off → no button anywhere, `account.html` says "coming soon", zero auth requests. The flag is UI only, not security: Supabase signups are protected by Turnstile + rate limits.

## Security notes
- No secrets in the repo, frontend or docs. Secrets live only in the Supabase dashboard (Google client secret, SMTP key, Turnstile secret).
- `profiles` is private (owner-only read; update limited to `display_name`, `locale`); rows created by a `security definer` trigger the client cannot call.
- Bearer tokens (not cookies) → CSRF not applicable; PKCE protects OAuth.
- Neutral messages ("if the address is valid we sent a code") → no account enumeration.
- Tokens live in localStorage: XSS is the main risk → strict CSP on `account.html`; user-provided text is rendered with `textContent` only. A site-wide CSP for the creator page is a separate future task (inline scripts + blob: audio).

## Production setup status (2026-10-08)

Done by the owner in the dashboards (no secrets are stored in this repo):

- Resend: domain `mail.snipring.com` verified (DKIM + SPF, eu-west-1); restricted "Sending access" key used only as the Supabase SMTP password.
- Supabase SMTP: `smtp.resend.com:465`, user `resend`, sender `SnipRing <noreply@mail.snipring.com>`.
- Turnstile: widget "SnipRing auth" (Managed) for `snipring.com`; public site key in `config.js`, secret only in Supabase Attack Protection.
- Google OAuth: project "SnipRing", External, In production, basic scopes only; web client with origin `https://snipring.com` and the Supabase callback; secret only in Supabase.
- Supabase Auth: Site URL `https://snipring.com`, redirect `https://snipring.com/account.html**`, Email OTP 6 digits / 600 s, Confirm email on, anonymous sign-ins off, `supabase/email-templates/otp.html` in "Magic link" and "Confirm signup".
- `supabase/auth_1a.sql` run in production by the owner.
- Owner tests (`?me`) passed: email code, Google on desktop and iPhone Safari, one user per email, return to site with saved sounds intact, Instagram in-app browser.

`auth.enabled` stays `false`. The Google consent screen shows the Supabase project domain; a custom auth domain is a paid add-on and is part of the plan decision.

## Open requirements before PUBLIC account launch (blockers)
1. **Self-service account deletion** (needs a server function with the service role; must delete auth user + profile + any future data). Email-based deletion is *not* the final implementation.
2. Supabase plan / backups / limits review (decision by the owner; no paid plan activated).
3. Legal review of the account sections in Privacy and Terms.


## Rollback
1. Instant: `auth.enabled: false` (config.js is never cached).
2. Code: `git revert` the Phase 1A commit.
3. DB: run `supabase/auth_1a_rollback.sql` (safe while there are no real users).
4. Providers: disable Google + Email in Supabase, remove SMTP, revoke the Resend key, delete the Google OAuth client and the Turnstile widget.

## Analytics (Umami only; never email or user ids; never sent to Meta)
`auth_viewed`, `signup_started{method}`, `otp_sent{resend?}`, `otp_failed{reason,step}`, `signup_completed{method}`, `login_completed{method}`, `logout{scope}`; every funnel event on other pages now carries `tier` (`guest`/`free`).
