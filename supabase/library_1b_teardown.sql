-- =====================================================================
-- SnipRing Phase 1B teardown (rollback of library_1b.sql + library_1b_cron.sql).
-- NOT RUN. Owner-only, after an explicit decision.
--
-- Before this file: turn uploads off (reservations_open = false, emergency_stop = true),
-- give users time to download, then delete every object through the Storage API
-- (never by SQL on storage.objects — that leaves the files behind).
-- This script REFUSES to run while any row or object still exists.
-- It drops only the objects created by Phase 1B — never the whole "private" schema.
-- profiles / Auth (Phase 1A) and Discover (schema.sql) are untouched.
-- =====================================================================
begin;

do $$ begin
  if exists (select 1 from public.library_items where state <> 'purged') then
    raise exception 'teardown refused: library_items still has rows that are not purged';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'user-media') then
    raise exception 'teardown refused: bucket user-media still has objects (delete them via the Storage API first)';
  end if;
end $$;

-- scheduled janitor (only if library_1b_cron.sql was applied)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'library-janitor'$q$;
  end if;
end $$;

drop function if exists public.svc_library(text, jsonb);
drop function if exists public.library_delete(uuid);
drop function if exists public.library_job_status(uuid[]);
drop function if exists public.library_usage();

drop view     if exists private.library_health;
drop function if exists private.lib_drop_tombstones();
drop function if exists private.lib_audit_due(int);
drop function if exists private.lib_audit_user(uuid);
drop function if exists private.lib_orphans(int);
drop function if exists private.lib_purge_failed(uuid, text);
drop function if exists private.lib_purged(uuid);
drop function if exists private.lib_due_purges(int);
drop function if exists private.lib_expired(int);
drop function if exists private.janitor_release(text);
drop function if exists private.janitor_acquire(text, int);
drop function if exists private.lib_ready_item(uuid, uuid);
drop function if exists private.lib_finish(uuid, uuid);
drop function if exists private.lib_begin(uuid, uuid, text, public.sound_type, int, bigint, text, text, boolean);
drop function if exists private.lib_abandon(uuid, uuid, text);
drop function if exists private.clean_name(text);
drop function if exists private.lib_lock(uuid);
drop function if exists private.log(uuid, uuid, text, jsonb);
drop function if exists private.lim(text);
drop function if exists private.flag(text);

drop table if exists public.library_items;
drop table if exists private.janitor_lease;
drop table if exists private.library_events;   -- keep a copy first if the audit trail is needed
drop table if exists private.library_usage;
drop table if exists private.cloud_access;
drop table if exists private.settings;

delete from storage.buckets where id = 'user-media';   -- empty (checked above)
-- schema "private" itself is left in place on purpose.

commit;
select 'SnipRing library 1B removed' as status;
