# External dead-man's switch (Healthchecks.io) — plan

Status 2026-10-12: **plan only.** No account, no code, no secret. Building and enabling need separate approvals.
Why: GitHub schedules ran 3 of ~21 expected times in 22 h (see MONITORING.md). The janitor cannot report its own
absence, so "the janitor stopped" needs a watcher outside Supabase that alarms on **silence**.

## How it works
- One check `snipring-janitor` (production) and one `snipring-janitor-staging` (tested first).
- At the end of every janitor run the function sends one HTTPS request to the check's ping URL:
  - `…/<uuid>` = run completed and every health check passed;
  - `…/<uuid>/fail` = run completed but a check failed; the request body is the list of failing check **names** only.
- Healthchecks e-mails the owner when the state changes: **up → down** (a `/fail`, or no ping for period + grace)
  and **down → up** (next good ping). One e-mail per change, so a long outage is not a flood.
- Schedule: Cron `*/10 * * * *`, time zone UTC, **grace 20 min** → alarm about 30 min after the last good run
  (two missed runs tolerated). Tune after a week of data.

## Behaviour by failure type
| Situation | What Healthchecks sees | Result |
|---|---|---|
| Janitor stopped (pg_cron job gone, pg_net broken, function crashes before the end, wrong `JANITOR_SECRET` → 401, project paused, Supabase outage) | no ping | e-mail "down" after ~30 min |
| One slow/failed run (temporary) | one ping missing, next one arrives | no e-mail (inside the grace time) |
| Health check fails (stuck delete, leak, backup lag…) | `/fail` | e-mail "down" at once; Resend alert as a second channel |
| Run skipped because another run holds the lease | ping still sent (the scheduler works) | nothing |
| Network between Supabase and hc-ping.com down | pings lost | **false "down"** after ~30 min → check the janitor log; nothing else breaks |
| Healthchecks.io itself down | — | **no alarm** (false negative) → GitHub hourly check and Resend alerts remain |
| Ping URL leaked | someone could send fake "up" pings and hide a real outage | rotate the URL (one click), update the function secret |

## Code to add (not built; ~20 lines + tests)
- `supabase.ts`: `pingFromEnv()` reads `HC_PING_URL` (must match `^https://hc-ping\.com/[0-9a-f-]{36}$`; anything else = off).
- `runJanitor`: after `run_log`, `await deps.ping?.(failing)` — **5 s timeout, one retry, never throws**, never delays
  the janitor's own work, counts against the run budget. Body: failing check names only (no ids, no user data).
- The janitor already reads `ops_health()` in step 10; the ping reuses that result (one query, not two).
- Tests: ping on a healthy run; `/fail` with names only; network error and timeout do not change the janitor report;
  no ping URL = no request; the URL never appears in logs or responses.

## Privacy and security
- Data sent: arrival time, `/fail` with check names. No personal data → no privacy-policy change needed (re-check).
- Hosting: Healthchecks.io states it runs in the EU (verify on the day).
- The ping URL is a credential (it can silence the alarm): only in function secrets, never in the repo, chat or logs;
  set by an owner-run script with a hidden prompt, same pattern as `prod_alerts.sh` (cleanup trap, mode 600).

## Cost
Free "Hobbyist" plan: 20 checks, e-mail notifications, enough for 2 checks. $0.

## Rollout (each step separate approval)
1. Owner creates the Healthchecks.io account and the **staging** check (schedule above), e-mail integration on.
2. Claude builds the code + tests on a branch; CI green.
3. Staging: owner sets `HC_PING_URL` on staging, Claude deploys the janitor to staging; verify: pings every 10 min;
   unschedule the staging cron job for 40 min → "down" e-mail; reschedule → "up" e-mail.
4. Production: owner creates the production check, sets the secret with the script, deploys `library-janitor`.
5. Keep GitHub `health.yml` as the third layer.

## Rollback
Unset `HC_PING_URL` and redeploy → no pings; pause or delete the check in Healthchecks (otherwise it reports "down").
