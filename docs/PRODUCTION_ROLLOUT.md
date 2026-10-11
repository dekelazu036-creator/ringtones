# Production rollout — Core 1.0 (cloud library private beta + account deletion)

**Status: NOT STARTED. Every step needs the owner's explicit approval at that moment.**
Production project: `snipring` (ref in CLAUDE.md §5), eu-central-1, Free plan.
Rule from CLAUDE.md: **the owner runs production SQL himself**; Claude prepares, checks and guides.
Claude's permissions deny any command containing the production ref, so Claude cannot run these by mistake.

## Preconditions (all must be true)
- [ ] M1 closed: staging runner 30/30 (done 2026-10-11), T30 9/9 (done), `library_health` clean 24 h, owner approval.
- [ ] CI green on `core-1.0` (backend + frontend jobs).
- [ ] Legal review of the privacy/terms drafts done, or the owner accepts publishing the drafts for the private beta.
- [ ] Decision: keep `auth.enabled = false` (private beta through owner mode / allow-list only). **Recommended: yes.**

## What changes for visitors
Merging `core-1.0` → `main` publishes: the new design (lime/violet), updated privacy and terms pages,
`monitor.js` error counts. `library.html` and account deletion stay invisible while `auth.enabled = false`
(only `?me` owner mode sees accounts). No signup wall anywhere; the guest flow is unchanged.

## Step 0 — read-only inspection (Claude, with approval)
Claude lists production tables/policies/functions with read-only queries to confirm the starting point
(older `schema.sql` + `auth_1a.sql`, no 1B objects). Nothing is written.

**Done 2026-10-11 (read-only, approved):** 10 public tables from `schema.sql` (sounds, packs, pack_items, profiles,
favorites, reports, sound_sources, sound_stats_daily, moderation_actions, ai_generations); `profiles` already private
(policies `own profile readable/editable`, anon has no SELECT); 26 sounds; 1 Auth user; **no** `private` schema
objects, **no** Storage buckets, **no** `pg_cron`/`pg_net` (Step 4 enables them). Difference from staging: production
has Supabase's `ensure_rls` event trigger (`public.rls_auto_enable`, auto-enables RLS on new public tables).
Harmless for our SQL, which enables RLS explicitly; noted so the advisors output is not a surprise.

## Step 1 — website (owner merges)
1. Merge the PR `core-1.0` → `main` on GitHub (= deploy to GitHub Pages).
2. `consentVersion` in `config.js` is already 2 on `core-1.0` (material privacy change): visitors are asked again.
3. Check https://snipring.com on the phone: create + export a ringtone as a guest, light/dark, Hebrew/English.
Rollback: revert the merge commit on `main`.

## Step 2 — database (owner, Supabase SQL Editor, production project)
Run each file's full content, in this order. Each prints a status line at the end. All are idempotent
(verified locally on a production-like database: run twice, existing users and profiles kept).
1. `supabase/schema.sql` — makes `profiles` private (removes the old public policy).
2. `supabase/auth_1a.sql`
3. `supabase/library_1b.sql` — creates the private bucket `user-media` with no policies; uploads stay **closed**.
4. `supabase/account_delete.sql`
5. `supabase/tests/policy_audit.sql` — read-only; send Claude the output to compare with staging.
Rollback: `supabase/library_1b_teardown.sql` (refuses while any data exists).

## Step 3 — Edge Functions (owner's computer, CLI)
Link stays on staging; deploy by explicit ref (typed by the owner, not by Claude):
```bash
supabase functions deploy library-upload   --project-ref <production-ref> --use-api
supabase functions deploy library-download --project-ref <production-ref> --use-api
supabase functions deploy account-delete   --project-ref <production-ref> --use-api
supabase functions deploy library-janitor  --project-ref <production-ref> --use-api --no-verify-jwt
```
Function secrets (Dashboard → Edge Functions → Secrets), values from the password manager:
- `ALLOWED_ORIGINS` = `https://snipring.com,https://www.snipring.com`
- `JANITOR_SECRET` = a NEW random value (48+ chars), different from staging.

## Step 4 — janitor schedule (owner, SQL Editor)
1. Database → Extensions: enable `pg_cron` and `pg_net`.
2. Create the two Vault secrets (header of `supabase/library_1b_cron.sql`), the production URL and the same `JANITOR_SECRET`.
3. Run `supabase/library_1b_cron.sql`.
4. After 10 minutes Claude checks (read-only, with approval) that the run returned 200.

## Step 5 — private beta for the owner only
```sql
insert into private.cloud_access (user_id) select id from auth.users where email = '<owner email>';
update private.settings set value = 'true' where key = 'reservations_open';
```
Then on the phone: `snipring.com/?me` → sign in → make a sound → My Library → save, play, download, delete.

## Watch afterwards
`select * from private.library_health;` and `select * from private.account_deletion_health;` daily for a week.
Emergency stop: `update private.settings set value = 'true' where key = 'emergency_stop';` (downloads/deletes keep working).

## Still open before a PUBLIC launch (not part of this rollout)
Supabase plan (backups), D6 security decision, media backup policy, alerting, global rate limit / Turnstile on upload,
minimum age for accounts, final legal texts.
