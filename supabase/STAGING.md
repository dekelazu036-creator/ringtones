# Phase 1B staging (M0 prepared — nothing created or run yet)

Staging is a **separate Supabase project on the Free plan**. It never uses production credentials
or production user data. Every step marked **[approval]** waits for the owner's explicit OK.

## 1. Create the project (owner, dashboard)
1. Supabase dashboard → **New project** in the same organization.
   Name `snipring-staging`, plan **Free**, same region as production.
   Database password: generate it in your password manager. Do not send it anywhere.
2. Free allows 2 active projects (production + staging). A Free project pauses after 1 week
   without activity; restoring it is free.
3. Write down only the public values: project URL `https://<staging-ref>.supabase.co` and the
   **publishable** key (`sb_publishable_…`). These may be shared; the secret key may not.

## 2. Auth for tests (owner, dashboard)
- Authentication → Sign In / Providers → **Email**: enabled, *Confirm email* off (staging only).
- Authentication → Users → **Add user** twice (A and B), with passwords from your password manager.
  Test addresses only (e.g. `you+a@…`, `you+b@…`). No Google, no Turnstile, no custom SMTP in staging.
- URL configuration: Site URL `http://localhost:8080`.

## 3. Database **[approval]** — SQL editor, in this order
1. `supabase/schema.sql` (now with private profiles)
2. `supabase/auth_1a.sql`
3. `supabase/library_1b.sql`
4. `supabase/tests/policy_audit.sql` (read-only) → compare with the expected list at its end.
5. Beta switches for the two test users (UUIDs from Auth → Users):
   ```sql
   insert into private.cloud_access (user_id) values ('<uuid A>'), ('<uuid B>');
   update private.settings set value = 'true' where key = 'reservations_open';
   ```

## 4. Edge Functions **[approval]**
Either the CLI (`supabase functions deploy library-upload --project-ref <staging-ref>`, same for
download and janitor, with `supabase/functions/config.toml.snippet`) or the dashboard editor,
pasting the single-file bundles from `supabase/functions/dist/` (rebuild: `node tools/bundle_functions.mjs`).

| Function | Verify JWT | Secrets it needs |
|---|---|---|
| library-upload | **on** | `ALLOWED_ORIGINS` |
| library-download | **on** | `ALLOWED_ORIGINS` |
| library-janitor | **off** (checks its own secret) | `JANITOR_SECRET` |

Function secrets (Edge Functions → Secrets):
- `ALLOWED_ORIGINS` = `http://localhost:8080` (staging test origin)
- `JANITOR_SECRET` = 48+ random characters from your password manager (never in Git or chat)

`SUPABASE_URL`, `SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

## 5. Scheduled janitor **[approval]**
Database → Extensions: enable `pg_cron` and `pg_net`. In the SQL editor create the two Vault
secrets (header of `supabase/library_1b_cron.sql`), then run that file.

## 6. Run the two-account tests (owner's computer, Node 18+)
```bash
SB_URL=https://<staging-ref>.supabase.co SB_KEY=<publishable> \
A_EMAIL=… A_PASSWORD=… B_EMAIL=… B_PASSWORD=… \
node supabase/tests/staging/staging_test.mjs --slow
```
Then the manual SQL checks in `supabase/tests/TEST_MATRIX.md` (T15, T16, T18, T19, T26).

## Tear down staging
Delete the staging project in the dashboard (Settings → General → Delete project). Nothing in
production depends on it.
