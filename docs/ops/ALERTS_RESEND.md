# Owner alert e-mails (Resend) — activation guide

Status 2026-10-12: code ready (janitor step 10, test alert), **not active in production**. Owner runs every step.
Nothing in this file is a secret. The Resend key and the alert address are typed only into the hidden prompts of
`supabase/rollout/prod_alerts.sh`, never into chat, files or the dashboard notes.

## What it does
Every janitor run (10 min) reads `ops_health()`. If a check fails (except `janitor_recent` and `uploads_paused`)
and no alert was sent in the last 6 hours, it e-mails the owner from `SnipRing alerts <noreply@mail.snipring.com>`
with the names of the failing checks only (no user data). A failed send is retried on the next run.

## Preconditions
1. `ops-hardening` merged to `main` (contains the hardened `prod_alerts.sh`: the temp file with the key is
   removed on success, failure, Ctrl+C, terminal close and kill; mode 600).
2. The script deploys **the code checked out on the owner's computer**: run it from an up-to-date `main`.
3. Production already has the `alert_due` / `alert_sent` ops (applied 2026-10-12). Deploying the new janitor
   also brings steps 8–9 (R2 backup), which stay **off** while the R2 secrets are missing.

## Steps
1. **Resend → API Keys → Create API key.** Name `snipring-alerts`, Permission **Sending access**,
   Domain **mail.snipring.com**. Copy it (shown once). Do not paste it anywhere else.
2. On the computer, in the repo folder:
   ```bash
   git checkout main && git pull --ff-only
   ```
   ```bash
   zsh supabase/rollout/prod_alerts.sh
   ```
   It asks for the alert address and the key (hidden), stores both as production function secrets and redeploys
   `library-janitor`. Expected last line: `DONE. Tell Claude: alerts done.`
3. **Check without a fault** (needs the separate approval for the test alert in production):
   a. SQL Editor (production): apply the `alert_test` delta from `supabase/account_delete.sql`
      (function `private.alert_test` + the `alert_test` line in `svc_account` + its revoke). Claude prepares
      the exact block at that time.
   b. Turn test alerts on for a few minutes:
      `insert into private.settings (key, value) values ('alert_test_enabled', 'true') on conflict (key) do update set value = 'true';`
   c. Send one test (the janitor secret is read from Vault inside the database, never shown):
      `select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'library_project_url') || '/functions/v1/library-janitor?test_alert=1', body := '{}'::jsonb, headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'library_janitor_secret')));`
   d. A few seconds later: `select status_code, content from net._http_response order by id desc limit 1;`
      expected `200` and `{"test_alert":"sent"}`; the e-mail "SnipRing: TEST alert (nothing is wrong)" arrives.
   e. Turn it off again: `delete from private.settings where key = 'alert_test_enabled';`
4. Watch the next janitor runs: `select at, detail from private.library_events where kind = 'janitor_run' order by at desc limit 3;`
   (no `alert` field = healthy, nothing sent).

## Test-alert safety (what protects it)
- Only the janitor secret opens it (a user session or the anon key gets 401). It runs no janitor work.
- Off unless `private.settings.alert_test_enabled` is JSON `true` (missing row = off; SQL not applied = off).
- One per 10 minutes, counted before sending (a failing provider cannot cause a loop); separate from the
  6-hour throttle of real alerts.
- The answer is one word (`sent / disabled / throttled / failed / not_configured`): no address, key or provider text.

## Undo
`supabase secrets unset RESEND_API_KEY ALERT_EMAIL --project-ref <production ref>` then redeploy `library-janitor`
→ step 10 is skipped. Revoke the key in Resend.

## Tested
Local: H5, H6 (44/44), W9, W10 (10/10, source and dist bundles). Staging: SQL gate (`disabled → allowed → throttled`,
grants: anon/authenticated cannot execute), HTTP 401 without the secret, `not_configured` without Resend secrets.
**Not tested:** a real Resend delivery (staging has no Resend key; first real send = step 3 above).
