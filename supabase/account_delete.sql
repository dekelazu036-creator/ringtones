-- =====================================================================
-- SnipRing — self-service account deletion (Core 1.0 launch blocker)
-- Requires: schema.sql, auth_1a.sql, library_1b.sql. Idempotent: safe to run again.
--
-- Flow (all state changes are short SQL transactions; Storage and Auth calls happen in between):
--   1. account-delete function (user's verified session) → svc op acct_request:
--      user leaves the beta allow-list (no new uploads), every live item goes to deleting/abandoned
--      with no grace period, a row in private.account_deletions records the request.
--   2. the function (and every janitor run after it) removes the objects and confirms them
--      with the existing lib_purged (quota released only when the object is really gone).
--   3. acct_prepare: only when the user has NO live items, drops the tombstones and the usage row
--      (both reference auth.users ON DELETE RESTRICT), then the function deletes the Auth user
--      (profiles/favourites cascade, reports/sounds keep a NULL author) and calls acct_done.
--   If anything fails, acct_failed backs off and the janitor retries. The RESTRICT foreign keys
--   stay: an Auth user whose media is not confirmed gone still cannot be deleted.
-- The record kept afterwards holds only the user id and timestamps (no email, no names).
-- =====================================================================
begin;

create table if not exists private.account_deletions (
  user_id      uuid primary key,                                -- no FK: the row outlives the Auth user
  requested_at timestamptz not null default now(),
  state        text not null default 'pending' check (state in ('pending','done')),
  attempts     int  not null default 0,
  next_at      timestamptz not null default now(),
  last_error   text,
  done_at      timestamptz,
  constraint ad_done_has_time check ((state = 'done') = (done_at is not null)));
create index if not exists ad_due on private.account_deletions (next_at) where state = 'pending';
alter table private.account_deletions enable row level security;   -- no policies: API roles get nothing

-- 1. request (idempotent). Called only with the id of a verified session.
create or replace function private.acct_request(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u private.library_usage; r record; n int := 0;
begin
  if p_uid is null then return '{"error":"bad_request"}'; end if;
  if not exists (select 1 from auth.users where id = p_uid) then return '{"error":"not_found"}'; end if;
  insert into private.account_deletions (user_id) values (p_uid)
  on conflict (user_id) do update set next_at = now()
    where private.account_deletions.state = 'pending';
  delete from private.cloud_access where user_id = p_uid;               -- no new uploads from now on
  u := private.lib_lock_existing(p_uid);                                 -- lock 1 (only if library data exists)
  if u.user_id is not null then
    for r in select li.id, li.state, li.size_bytes from public.library_items li
              where li.user_id = p_uid and li.state in ('uploading','ready','deleting','abandoned')
              for update loop                                            -- lock 2, per item
      if r.state = 'uploading' then
        perform private.lib_abandon(p_uid, r.id, 'account_deleted');
      elsif r.state = 'ready' then
        update public.library_items
           set state = 'deleting', deleted_at = now(), updated_at = now(), purge_next_at = now()
         where id = r.id;
        update private.library_usage
           set items_active = items_active - 1, bytes_active = bytes_active - r.size_bytes,
               bytes_releasing = bytes_releasing + r.size_bytes, updated_at = now()
         where user_id = p_uid;
      end if;
      n := n + 1;
    end loop;
    -- no grace period for a deleted account: purge on the next pass
    update public.library_items set purge_next_at = now(), updated_at = now()
     where user_id = p_uid and state in ('deleting','abandoned');
  end if;
  perform private.log(p_uid, null, 'account_deletion_requested', jsonb_build_object('items', n));
  return jsonb_build_object('status', 'pending', 'items', n);
end $$;

-- 2. paths still to remove for one user (the janitor's due_purges covers everyone; this is the fast path)
create or replace function private.acct_purges(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'path', t.storage_path)), '[]'::jsonb)
    from (select li.id, li.storage_path from public.library_items li
           where li.user_id = p_uid and li.state in ('deleting','abandoned')
           order by li.created_at limit 100) t
$$;

-- 3. due requests for the janitor
create or replace function private.acct_due(p_limit int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t.user_id), '[]'::jsonb)
    from (select d.user_id from private.account_deletions d
           where d.state = 'pending' and d.next_at <= now()
           order by d.next_at limit least(greatest(p_limit, 1), 50)) t
$$;

-- 4. ready to delete the Auth user? 'waiting' while any item is not purged yet.
create or replace function private.acct_prepare(p_uid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare u private.library_usage;
begin
  if not exists (select 1 from private.account_deletions d where d.user_id = p_uid and d.state = 'pending') then
    return 'not_requested'; end if;
  if not exists (select 1 from auth.users where id = p_uid) then return 'gone'; end if;
  u := private.lib_lock_existing(p_uid);                                 -- lock 1 (serialises with any writer)
  if exists (select 1 from public.library_items li
              where li.user_id = p_uid and li.state in ('uploading','ready','deleting','abandoned')) then
    return 'waiting'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'user-media' and o.name like p_uid::text || '/%') then
    return 'waiting'; end if;                                            -- an object without a row: orphan sweep first
  delete from public.library_items where user_id = p_uid and state = 'purged';
  delete from private.library_usage where user_id = p_uid;
  return 'ready';
end $$;

create or replace function private.acct_done(p_uid uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users where id = p_uid) then return 'still_exists'; end if;
  update private.account_deletions set state = 'done', done_at = now(), last_error = null
   where user_id = p_uid and state = 'pending';
  if not found then return 'done'; end if;                               -- already done earlier: idempotent
  -- the technical log of this user goes too; only the proof row below stays (id + time, nothing else)
  delete from private.library_events where user_id = p_uid;
  perform private.log(p_uid, null, 'account_deleted', null);
  return 'done';
end $$;

create or replace function private.acct_failed(p_uid uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update private.account_deletions
     set attempts = attempts + 1, last_error = left(coalesce(p_error, 'unknown'), 300),
         next_at = now() + least(interval '6 hours', interval '5 minutes' * power(2, least(attempts, 10)))
   where user_id = p_uid and state = 'pending'
  returning attempts into n;
  if n >= 5 then perform private.log(p_uid, null, 'account_deletion_stuck', jsonb_build_object('attempts', n, 'error', left(p_error, 200))); end if;
end $$;

-- 'waiting' is normal while objects are being removed: look again on the next janitor pass
create or replace function private.acct_later(p_uid uuid) returns void
language sql security definer set search_path = '' as $$
  update private.account_deletions set next_at = now() + interval '5 minutes'
   where user_id = p_uid and state = 'pending'
$$;

-- service entry point for account ops (same rules as svc_library: service_role only + role claim)
create or replace function public.svc_account(p_op text, p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_uid uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'svc_account: service role required' using errcode = '42501';
  end if;
  v_uid := nullif(a ->> 'user_id', '')::uuid;
  case p_op
    when 'request' then return private.acct_request(v_uid);
    when 'purges'  then return private.acct_purges(v_uid);
    when 'due'     then return private.acct_due(coalesce((a ->> 'limit')::int, 20));
    when 'prepare' then return to_jsonb(private.acct_prepare(v_uid));
    when 'done'    then return to_jsonb(private.acct_done(v_uid));
    when 'failed'  then perform private.acct_failed(v_uid, a ->> 'error'); return 'true'::jsonb;
    when 'later'   then perform private.acct_later(v_uid); return 'true'::jsonb;
    -- monitoring: yes/no checks only (no user data), consumed by the library-health function
    when 'health'  then return private.ops_health();
    -- alert e-mails: at most one every 6 hours (the janitor asks, sends, then records it)
    when 'alert_due'  then return to_jsonb(not exists (select 1 from private.library_events e
                                where e.kind = 'alert_sent' and e.at > now() - interval '6 hours'));
    when 'alert_sent' then perform private.log(null, null, 'alert_sent', jsonb_build_object('failing', a -> 'failing')); return 'true'::jsonb;
    else raise exception 'svc_account: unknown op %', p_op using errcode = '22023';
  end case;
end $$;

-- health: pending requests older than a day should not exist
create or replace view private.account_deletion_health as
select
  (select count(*) from private.account_deletions where state = 'pending')                                   as pending,
  (select count(*) from private.account_deletions where state = 'pending' and requested_at < now() - interval '24 hours') as overdue,
  (select count(*) from private.library_events where kind = 'account_deletion_stuck' and at > now() - interval '7 days')   as stuck_7d,
  (select count(*) from private.account_deletions where state = 'done' and done_at > now() - interval '30 days')            as done_30d;

-- one place that says whether the cloud library and account deletion are healthy (for alerting)
create or replace function private.ops_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'janitor_recent',    coalesce(h.last_janitor_run > now() - interval '30 minutes', false),
    'no_stuck_deletes',  h.stuck_deletions = 0,
    'no_stuck_uploads',  h.stuck_uploads = 0,
    'no_stuck_purges',   h.purge_stuck_7d = 0,
    'bytes_tracked',     h.stored_bytes <= h.counted_bytes,          -- an object nobody counts = leak
    'deletions_on_time', a.overdue = 0 and a.stuck_7d = 0,
    'backup_current',    not private.flag('backup_enabled') or h.backup_lag = 0,
    'uploads_paused',    not private.flag('reservations_open') or private.stopped())
  from private.library_health h, private.account_deletion_health a
$$;

-- privileges: functions get EXECUTE for PUBLIC by default, so revoke explicitly
revoke all on private.account_deletions from public, anon, authenticated, service_role;
revoke all on private.account_deletion_health from public, anon, authenticated, service_role;
revoke all on function private.ops_health() from public, anon, authenticated, service_role;
revoke all on function private.acct_request(uuid), private.acct_purges(uuid), private.acct_due(int),
                       private.acct_prepare(uuid), private.acct_done(uuid), private.acct_failed(uuid, text),
                       private.acct_later(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.svc_account(text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_account(text, jsonb) to service_role;

commit;
select 'SnipRing account deletion ready' as status;
