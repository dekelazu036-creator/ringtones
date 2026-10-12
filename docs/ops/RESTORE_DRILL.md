# Database restore drill — restore into a SEPARATE project

Status 2026-10-12: procedure only. **No project is created or deleted now.** Each run needs the owner's approval
(it creates a billed project for a few hours and copies personal data).

## Rules
- **Never** use the "Restore" button of the production project's own backup list: it overwrites production.
  Only **"Restore to a new project"**.
- The copy holds personal data (Auth e-mails). Owner-only access, no sharing, delete it the same day.
- Integrity checks use **aggregates and hashes only**: counts, sums, max timestamps, md5 of ordered ids.
  Never print e-mails, names or user ids in chat or logs.
- Claude never receives the new project's keys or DB password.

## What a database backup does and does not contain
Contains: all schemas (`public`, `private`, `auth`, `storage` metadata, `cron`, `vault`, `net`).
Does **not** contain: Storage files (MP3s → see R2_BACKUP_PLAN.md), Edge Functions and their secrets,
Auth settings (SMTP, providers, redirect URLs), project API keys.

## Procedure
1. **Record the cut-off.** Note the timestamp of the backup chosen (Database → Backups, production).
2. **Restore to a new project** (production dashboard → Database → Backups → the chosen backup → *Restore to a
   new project*). Name `snipring-restore-drill-YYYYMMDD`, same region, smallest compute.
3. **Isolate immediately** (new project → SQL Editor), before anything else:
   ```sql
   select cron.unschedule(jobid) from cron.job;                 -- the copied janitor job would call PRODUCTION
   update private.settings set value = 'true'  where key = 'emergency_stop';
   update private.settings set value = 'false' where key = 'reservations_open';
   delete from vault.secrets where name in ('library_janitor_secret', 'library_project_url');
   ```
   Then Authentication → Sign In / Providers: turn off sign-ups and every provider. Do not deploy functions.
4. **Isolation checks** (all must hold):
   - `select count(*) from cron.job;` = 0
   - `select count(*) from vault.secrets where name like 'library_%';` = 0
   - no Edge Functions listed in the new project
   - production janitor runs continue normally (`private.library_events`, kind `janitor_run`, in production)
5. **Integrity checks** — run the same query in production with `<= cut-off` filters and in the copy; compare:
   ```sql
   select 'items' k, count(*)::text v from public.library_items where created_at <= :cutoff
   union all select 'items_by_state', string_agg(state || '=' || n, ',' order by state)
     from (select state, count(*) n from public.library_items where created_at <= :cutoff group by state) s
   union all select 'bytes_ready', coalesce(sum(size_bytes), 0)::text from public.library_items where state = 'ready' and created_at <= :cutoff
   union all select 'ids_md5', md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.library_items where created_at <= :cutoff
   union all select 'users', count(*)::text from auth.users where created_at <= :cutoff
   union all select 'sounds', count(*)::text from public.sounds
   union all select 'deletions_done', count(*)::text from private.account_deletions where state = 'done';
   ```
   And in the copy only: usage counters equal the sum of items
   (`library_usage.bytes_active` vs `sum(size_bytes)` of ready items per user → report only the number of mismatches),
   functions are `SECURITY DEFINER` with `search_path=''` (same audit query as `supabase/tests/policy_audit.sql`).
   Rows changed after the cut-off explain differences in `items_by_state`; counts created before it must match.
6. **Record** the result (time to restore, checks passed/failed) in this file's log below. No personal data.
7. **Delete the drill project** the same day (Settings → General → Delete project). Owner action.

## Cost
Pro plan: a new project is billed per hour of compute (smallest size ≈ $0.01–0.02 per hour). A few hours ≈ under $1.
Confirm on the Billing page before starting.

## Log
| Date | Backup | Restore time | Isolation | Integrity | Deleted |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
