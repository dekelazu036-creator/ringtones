# Production health monitoring — diagnosis and options

Status 2026-10-12. Read-only diagnosis; nothing here is switched on.

## What runs today
| Layer | What | Covers | Reliability |
|---|---|---|---|
| GitHub Actions `.github/workflows/health.yml` | `cron: '17 * * * *'` → POST `library-health` (secret `HEALTH_SECRET`), fails unless `"ok":true`; a failed run e-mails the repo owner | every `ops_health()` check **including `janitor_recent`** (the only check that notices a janitor that stopped) | **best effort** (see below) |
| Janitor step 10 (code ready, needs `RESEND_API_KEY` + `ALERT_EMAIL`) | e-mail at most once per 6 h when a check fails | everything except `janitor_recent` (the janitor cannot report its own absence) | runs every 10 min with the janitor; **off in production** until the secrets are set |

## Why only 4 runs in ~22 hours
Runs of `production health` from 2026-10-11 20:38 UTC to 2026-10-12 18:31 UTC:

| Started (UTC) | Trigger | Delay after :17 |
|---|---|---|
| 10-11 20:38 | manual (`workflow_dispatch`) | — |
| 10-12 00:36 | schedule | 19 min |
| 10-12 07:25 | schedule | 8 min |
| 10-12 17:59 | schedule | 42 min |

Expected ≈ 21 scheduled runs, got 3 (≈ 14 %), each late, gaps of 7 h and 10.5 h.
GitHub documents `schedule` as best effort: under load scheduled jobs are delayed **or dropped**, the
start of every hour is the busiest time, and nothing reports a dropped run. Other limits that apply:
schedules run only from the default branch; in a public repository they are disabled after 60 days without
repository activity; the minimum interval is 5 minutes. The workflow itself is correct (each run that
started passed in seconds). **Conclusion: GitHub schedules cannot be the only alarm.** A stopped janitor
would today go unnoticed for up to ~10 h.

Side note: the repository is public, so each run's log shows the health answer. It contains only yes/no
checks (no user data, no secret), which is acceptable, but `echo "$body"` could be reduced to `failing` only.

## Options for reliable external monitoring
| Option | How | Catches janitor stop | Needs from us | Cost | Notes |
|---|---|---|---|---|---|
| **A. Dead-man's switch** (e.g. Healthchecks.io) | janitor pings a secret URL at the end of each successful run; no ping for 30 min → e-mail | **yes** (also pg_cron / pg_net / function failures) | small code change (one `fetch`, ping URL as function secret), account at the provider | free tier (20 checks) | provider never gets our secrets or data; best fit for "janitor stopped" |
| **B. External scheduler** (e.g. cron-job.org) calling `library-health` | every 15 min with the `Authorization` header | yes (via `janitor_recent`) | `library-health` must answer non-200 when `ok:false` (today always 200) → tiny change, e.g. `?strict=1` → 503; the provider stores `HEALTH_SECRET` | free | the secret only reveals yes/no checks; keep it separate from the janitor secret (already the case) |
| C. Uptime service with keyword check (UptimeRobot etc.) | keyword `"ok":true` | yes | custom headers are usually a paid feature | paid | equivalent to B |
| D. Keep GitHub | as is, plus `workflow_dispatch` | sometimes | nothing | free | keep as a **secondary** layer only |

**Recommendation:** A (dead-man's switch from the janitor) + janitor e-mails (B in ALERTS_RESEND.md) as the
two primary layers, GitHub as a third. Both A and B need a small code change and an outside account →
**REQUIRES APPROVAL**; not built.
