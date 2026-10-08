-- =====================================================================
-- SnipRing Phase 1B: private cloud library  (M0 — NOT RUN on staging or production)
--
-- Requires: schema.sql (sound_type enum, profiles) and auth_1a.sql already applied.
-- Scope: per-user private MP3 library. No Studio, billing, credits or entitlements.
--
-- Security model
--   * The browser has NO Storage policies on bucket user-media and no write access to
--     library tables. Uploads, downloads and cleanup go through three Edge Functions.
--   * Edge Functions call ONE dispatcher, public.svc_library(op, args), over the API with
--     the secret (service_role) key. It is executable by service_role only and also
--     checks the request's JWT role itself (defence in depth if a grant is ever wrong).
--   * All logic lives in schema "private", which is not exposed by the API.
--   * Every function is SECURITY DEFINER with search_path = '' and fully-qualified names.
--   * One per-user lock (private.library_usage row, FOR UPDATE) is taken first by every
--     writer, then the item row. Storage I/O never happens while a lock is held
--     (each SQL call is its own short transaction).
--   * Physical quota is released only after the object is confirmed gone.
--
-- Additive. Rollback: library_1b_teardown.sql (refuses while any media exists).
-- =====================================================================
begin;

-- ============================================================ 0. schema
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- ============================================================ 1. settings & bookkeeping
create table if not exists private.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now());
insert into private.settings (key, value) values
  ('reservations_open', 'false'),   -- may NEW uploads start?        (missing row = closed)
  ('emergency_stop',    'false'),   -- true = no start and no finish (download/delete/janitor keep working)
  ('limits', jsonb_build_object(
     'max_items',        100,
     'max_bytes',        104857600,   -- 100 MB counted per user
     'max_physical',     157286400,   -- 150 MB incl. bytes still being released
     'max_file',         10485760,    -- 10 MiB per file
     'max_uploading',    3,
     'per_hour',         30,
     'project_physical', 838860800,   -- 800 MB for the whole project (Free plan = 1 GB)
     'reservation_ttl_s', 300,
     'purge_grace_s',     600,
     'tombstone_days',    30))
on conflict (key) do nothing;

create table if not exists private.cloud_access (            -- private-beta allow-list
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now());

create table if not exists private.library_usage (            -- LOCK 1 lives here
  user_id         uuid primary key references auth.users(id) on delete restrict,
  items_active    int    not null default 0 check (items_active    >= 0),
  bytes_active    bigint not null default 0 check (bytes_active    >= 0),
  bytes_releasing bigint not null default 0 check (bytes_releasing >= 0),
  uploading_count int    not null default 0 check (uploading_count >= 0),
  audited_at      timestamptz,
  updated_at      timestamptz not null default now());

create table if not exists private.library_events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  user_id uuid,
  item_id uuid,
  kind    text not null,
  detail  jsonb);
create index if not exists library_events_at on private.library_events (at desc);

create table if not exists private.janitor_lease (            -- one janitor run at a time
  id     int primary key check (id = 1),
  holder text,
  until  timestamptz);
insert into private.janitor_lease (id) values (1) on conflict do nothing;

alter table private.settings       enable row level security;   -- no policies: API roles get nothing
alter table private.cloud_access   enable row level security;
alter table private.library_usage  enable row level security;
alter table private.library_events enable row level security;
alter table private.janitor_lease  enable row level security;

-- ============================================================ 2. items
create table if not exists public.library_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete restrict,
  client_key       uuid not null,
  name             text not null check (char_length(name) between 1 and 80),
  type             public.sound_type not null,
  duration_ms      int  not null check (duration_ms between 100 and 300000),
  size_bytes       bigint not null check (size_bytes between 1 and 10485760),
  content_sha256   text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  origin           text not null check (origin in
                     ('file','video','record','generated','discover','demo','mine','studio')),
  state            text not null check (state in
                     ('uploading','ready','deleting','abandoned','purged')),
  expires_at       timestamptz,
  storage_path     text generated always as (user_id::text || '/' || id::text || '.mp3') stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  purged_at        timestamptz,
  purge_attempts   int not null default 0,
  purge_next_at    timestamptz,
  purge_last_error text,
  unique (user_id, client_key),
  constraint li_expiry_only_uploading check ((state = 'uploading') = (expires_at is not null)),
  constraint li_purge_only_releasing  check ((state in ('deleting','abandoned')) = (purge_next_at is not null)),
  constraint li_sha_until_purged      check (state = 'purged' or content_sha256 is not null),
  constraint li_purged_has_time       check ((state = 'purged') = (purged_at is not null)));

create index if not exists li_ready  on public.library_items (user_id, created_at desc) where state = 'ready';
create index if not exists li_sha    on public.library_items (user_id, content_sha256) where state in ('uploading','ready');
create index if not exists li_expiry on public.library_items (expires_at)    where state = 'uploading';
create index if not exists li_purge  on public.library_items (purge_next_at) where state in ('deleting','abandoned');
create index if not exists li_path   on public.library_items (storage_path);
create index if not exists li_hour   on public.library_items (user_id, created_at);
create index if not exists li_tomb   on public.library_items (purged_at) where state = 'purged';

alter table public.library_items enable row level security;
drop policy if exists "own ready items" on public.library_items;
create policy "own ready items" on public.library_items for select to authenticated
  using (user_id = (select auth.uid()) and state = 'ready');
-- Supabase's default privileges grant ALL on new public tables to anon/authenticated/service_role.
-- Undo that, then allow only a column-limited SELECT for signed-in users.
revoke all on public.library_items from public, anon, authenticated, service_role;
grant select (id, name, type, duration_ms, size_bytes, origin, created_at)
  on public.library_items to authenticated;

-- ============================================================ 3. helpers
create or replace function private.flag(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value = 'true'::jsonb from private.settings s where s.key = p_key), false)
$$;

-- fails CLOSED: a missing limit raises instead of comparing against NULL (which would let everything through)
create or replace function private.lim(p_key text) returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare v bigint;
begin
  select (s.value ->> p_key)::bigint into v from private.settings s where s.key = 'limits';
  if v is null then raise exception 'library limit % is not configured', p_key using errcode = 'P0001'; end if;
  return v;
end $$;

create or replace function private.log(p_uid uuid, p_item uuid, p_kind text, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into private.library_events (user_id, item_id, kind, detail) values (p_uid, p_item, p_kind, p_detail)
$$;

-- LOCK 1 (the only per-user lock). Every writer calls this before touching that user's items.
create or replace function private.lib_lock(p_uid uuid) returns private.library_usage
language plpgsql security definer set search_path = '' as $$
declare u private.library_usage;
begin
  if p_uid is null then raise exception 'lib_lock: null user' using errcode = '22004'; end if;
  insert into private.library_usage (user_id) values (p_uid) on conflict (user_id) do nothing;
  select * into strict u from private.library_usage where user_id = p_uid for update;
  return u;
end $$;

create or replace function private.clean_name(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(btrim(left(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g'), 80)), ''), 'SnipRing')
$$;

-- ============================================================ 4. upload
-- uploading -> abandoned (caller already holds, or will take, lock 1; re-entrant inside one transaction)
create or replace function private.lib_abandon(p_uid uuid, p_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.library_items;
begin
  perform private.lib_lock(p_uid);
  select * into r from public.library_items where id = p_id and user_id = p_uid for update;
  if not found then return 'not_found'; end if;
  if r.state <> 'uploading' then return r.state; end if;                       -- idempotent
  update public.library_items
     set state = 'abandoned', expires_at = null, updated_at = now(),
         purge_next_at = now() + make_interval(secs => private.lim('purge_grace_s'))
   where id = p_id;
  update private.library_usage
     set items_active = items_active - 1, bytes_active = bytes_active - r.size_bytes,
         bytes_releasing = bytes_releasing + r.size_bytes,
         uploading_count = uploading_count - 1, updated_at = now()
   where user_id = p_uid;
  perform private.log(p_uid, p_id, 'abandoned', jsonb_build_object('reason', p_reason));
  return 'abandoned';
end $$;

-- p_size, p_sha256 and p_duration_ms are measured by library-upload on the received bytes,
-- never taken from the browser.
create or replace function private.lib_begin(
  p_uid uuid, p_client_key uuid, p_name text, p_type public.sound_type, p_duration_ms int,
  p_size bigint, p_sha256 text, p_origin text, p_allow_duplicate boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u private.library_usage; r public.library_items; x record; n_hour int; total bigint;
begin
  if private.flag('emergency_stop') then return '{"error":"stopped"}'; end if;
  if p_client_key is null then return '{"error":"bad_request"}'; end if;
  -- allow-list BEFORE the lock: users outside the beta never get a usage row (which would block account deletion)
  if not exists (select 1 from private.cloud_access a where a.user_id = p_uid) then
    return '{"error":"not_enabled"}'; end if;
  u := private.lib_lock(p_uid);                                                -- lock 1

  -- the same job again (lost response, retry)?
  select * into r from public.library_items
   where user_id = p_uid and client_key = p_client_key for update;            -- lock 2
  if found then
    if r.state = 'ready' then return jsonb_build_object('status','done','id',r.id); end if;
    if r.state = 'uploading' and r.expires_at > now() then
      return jsonb_build_object('status','upload','id',r.id,'path',r.storage_path,
                                'size',r.size_bytes,'sha256',r.content_sha256);
    end if;
    return jsonb_build_object('error','job_closed','state',r.state);           -- client starts a new job
  end if;

  -- a NEW reservation from here on
  if not private.flag('reservations_open') then return '{"error":"reservations_closed"}'; end if;
  if p_size is null or p_size < 1 or p_size > private.lim('max_file') then return '{"error":"file_too_large"}'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then return '{"error":"bad_hash"}'; end if;
  if p_duration_ms is null or p_duration_ms not between 100 and 300000 then return '{"error":"bad_duration"}'; end if;
  if p_type is null or p_origin is null
     or p_origin not in ('file','video','record','generated','discover','demo','mine','studio') then
    return '{"error":"bad_request"}'; end if;

  -- release this user's own expired reservations now (does not depend on the janitor running)
  for x in select li.id from public.library_items li
            where li.user_id = p_uid and li.state = 'uploading' and li.expires_at <= now() loop
    perform private.lib_abandon(p_uid, x.id, 'expired');
  end loop;
  select * into u from private.library_usage where user_id = p_uid;           -- refreshed counters (still locked)

  if not coalesce(p_allow_duplicate, false) then                               -- concurrent duplicates too: lock 1 serialises them
    select * into r from public.library_items
     where user_id = p_uid and content_sha256 = p_sha256 and state in ('uploading','ready')
     order by created_at limit 1;
    if found then
      return jsonb_build_object('status','duplicate','id',r.id,'state',r.state,'name',r.name);
    end if;
  end if;

  select count(*) into n_hour from public.library_items
   where user_id = p_uid and created_at > now() - interval '1 hour';
  if n_hour >= private.lim('per_hour') then return '{"error":"rate_limited"}'; end if;
  if u.uploading_count >= private.lim('max_uploading') then return '{"error":"too_many_uploads"}'; end if;
  if u.items_active + 1 > private.lim('max_items') then return '{"error":"quota_items"}'; end if;
  if u.bytes_active + p_size > private.lim('max_bytes') then return '{"error":"quota_bytes"}'; end if;
  if u.bytes_active + u.bytes_releasing + p_size > private.lim('max_physical') then
    return '{"error":"quota_physical"}'; end if;

  -- project-wide cap: serialise reservations across users (always taken AFTER lock 1 → no deadlock)
  perform pg_advisory_xact_lock(hashtextextended('snipring.library.project_physical', 0));
  select coalesce(sum(lu.bytes_active + lu.bytes_releasing), 0) into total from private.library_usage lu;
  if total + p_size > private.lim('project_physical') then return '{"error":"service_full"}'; end if;

  insert into public.library_items
    (user_id, client_key, name, type, duration_ms, size_bytes, content_sha256, origin, state, expires_at)
  values (p_uid, p_client_key, private.clean_name(p_name), p_type, p_duration_ms, p_size, p_sha256, p_origin,
          'uploading', now() + make_interval(secs => private.lim('reservation_ttl_s')))
  returning * into r;
  update private.library_usage
     set items_active = items_active + 1, bytes_active = bytes_active + p_size,
         uploading_count = uploading_count + 1, updated_at = now()
   where user_id = p_uid;
  return jsonb_build_object('status','upload','id',r.id,'path',r.storage_path,
                            'size',r.size_bytes,'sha256',r.content_sha256);
end $$;

create or replace function private.lib_finish(p_uid uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.library_items; o_size bigint; o_type text;
begin
  perform private.lib_lock(p_uid);                                             -- lock 1
  select * into r from public.library_items
   where id = p_id and user_id = p_uid for update;                            -- lock 2
  if not found then return '{"error":"not_found"}'; end if;
  if r.state = 'ready' then return jsonb_build_object('status','done','id',r.id); end if;
  if r.state <> 'uploading' then return jsonb_build_object('error','job_closed','state',r.state); end if;
  if private.flag('emergency_stop') then return '{"error":"stopped"}'; end if; -- row expires, janitor cleans
  if r.expires_at <= now() then
    perform private.lib_abandon(p_uid, p_id, 'expired');
    return '{"error":"expired"}';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into o_size, o_type
    from storage.objects o where o.bucket_id = 'user-media' and o.name = r.storage_path;
  if not found then return '{"error":"object_missing"}'; end if;              -- retry finish, or it expires
  if o_size is distinct from r.size_bytes or o_type is distinct from 'audio/mpeg' then
    perform private.lib_abandon(p_uid, p_id, 'mismatch');
    return '{"error":"mismatch"}';
  end if;

  update public.library_items set state = 'ready', expires_at = null, updated_at = now() where id = p_id;
  update private.library_usage set uploading_count = uploading_count - 1, updated_at = now()
   where user_id = p_uid;                                                      -- items/bytes already counted at begin
  return jsonb_build_object('status','done','id',r.id);
end $$;

-- ============================================================ 5. download
create or replace function private.lib_ready_item(p_uid uuid, p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('path', li.storage_path, 'name', li.name)
    from public.library_items li where li.id = p_id and li.user_id = p_uid and li.state = 'ready'
$$;

-- ============================================================ 6. janitor
create or replace function private.janitor_acquire(p_holder text, p_secs int) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.janitor_lease set holder = p_holder, until = now() + make_interval(secs => p_secs)
   where id = 1 and (until is null or until < now() or holder = p_holder);
  return found;
end $$;

create or replace function private.janitor_release(p_holder text) returns void
language sql security definer set search_path = '' as $$
  update private.janitor_lease set holder = null, until = null where id = 1 and holder = p_holder
$$;

create or replace function private.lib_expired(p_limit int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'id', t.id)), '[]'::jsonb)
    from (select li.user_id, li.id from public.library_items li
           where li.state = 'uploading' and li.expires_at < now()
           order by li.expires_at limit least(greatest(p_limit, 1), 200)) t
$$;

create or replace function private.lib_due_purges(p_limit int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'path', t.storage_path)), '[]'::jsonb)
    from (select li.id, li.storage_path from public.library_items li
           where li.state in ('deleting','abandoned') and li.purge_next_at <= now()
           order by li.purge_next_at limit least(greatest(p_limit, 1), 100)) t
$$;

-- called AFTER storage remove(); releases quota only if the object is really gone
create or replace function private.lib_purged(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; r public.library_items;
begin
  select li.user_id into v_uid from public.library_items li where li.id = p_id;
  if v_uid is null then return 'not_found'; end if;
  perform private.lib_lock(v_uid);
  select * into r from public.library_items where id = p_id for update;
  if r.state = 'purged' then return 'purged'; end if;
  if r.state not in ('deleting','abandoned') then return r.state; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'user-media' and o.name = r.storage_path) then
    return 'still_present';
  end if;
  update public.library_items
     set state = 'purged', purged_at = now(), updated_at = now(), purge_next_at = null,
         name = '-', content_sha256 = null, purge_last_error = null
   where id = p_id;
  update private.library_usage
     set bytes_releasing = bytes_releasing - r.size_bytes, updated_at = now()
   where user_id = v_uid;
  return 'purged';
end $$;

create or replace function private.lib_purge_failed(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.library_items
     set purge_attempts   = purge_attempts + 1,
         purge_next_at    = now() + least(interval '6 hours', interval '10 minutes' * power(2, least(purge_attempts, 10))),
         purge_last_error = left(coalesce(p_error, 'unknown'), 500), updated_at = now()
   where id = p_id and state in ('deleting','abandoned')
  returning purge_attempts into n;
  if n >= 5 then perform private.log(null, p_id, 'purge_stuck', jsonb_build_object('attempts', n, 'error', left(p_error, 200))); end if;
end $$;

-- objects older than 1 hour with no live row (expected: zero). 1 hour > reservation TTL + function wall clock.
create or replace function private.lib_orphans(p_limit int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t.name), '[]'::jsonb)
    from (select o.name from storage.objects o
           where o.bucket_id = 'user-media' and o.created_at < now() - interval '1 hour'
             and not exists (select 1 from public.library_items li
                              where li.storage_path = o.name
                                and li.state in ('uploading','ready','deleting','abandoned'))
           limit least(greatest(p_limit, 1), 100)) t
$$;

-- recompute one user's counters from rows and stored objects; corrects towards the safe side
create or replace function private.lib_audit_user(p_uid uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u private.library_usage; c record; s bigint; drift boolean;
begin
  u := private.lib_lock(p_uid);
  select count(*) filter (where state in ('uploading','ready'))::int                      as items,
         coalesce(sum(size_bytes) filter (where state in ('uploading','ready')), 0)       as active,
         coalesce(sum(size_bytes) filter (where state in ('deleting','abandoned')), 0)    as releasing,
         count(*) filter (where state = 'uploading')::int                                as up
    into c from public.library_items where user_id = p_uid;
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into s from storage.objects o
   where o.bucket_id = 'user-media' and o.name like p_uid::text || '/%';
  drift := (u.items_active, u.bytes_active, u.bytes_releasing, u.uploading_count)
           is distinct from (c.items, c.active, c.releasing, c.up)
           or s > c.active + c.releasing;
  if drift then
    perform private.log(p_uid, null, 'counter_drift',
      jsonb_build_object('counted', to_jsonb(u), 'rows', to_jsonb(c), 'stored', s));
    update private.library_usage
       set items_active = c.items, bytes_active = c.active,
           bytes_releasing = greatest(c.releasing, s - c.active),
           uploading_count = c.up, updated_at = now()
     where user_id = p_uid;
  end if;
  update private.library_usage set audited_at = now() where user_id = p_uid;
  return drift;
end $$;

create or replace function private.lib_audit_due(p_limit int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t.user_id), '[]'::jsonb)
    from (select lu.user_id from private.library_usage lu
           where lu.audited_at is null or lu.audited_at < now() - interval '1 hour'
           order by lu.audited_at nulls first limit least(greatest(p_limit, 1), 200)) t
$$;

create or replace function private.lib_drop_tombstones() returns int
language sql security definer set search_path = '' as $$
  with d as (delete from public.library_items
              where state = 'purged'
                and purged_at < now() - make_interval(days => private.lim('tombstone_days')::int)
             returning 1)
  select count(*)::int from d
$$;

create or replace view private.library_health as
select
  (select count(*) from public.library_items where state in ('deleting','abandoned')
      and coalesce(deleted_at, updated_at) < now() - interval '24 hours')        as stuck_deletions,
  (select count(*) from public.library_items where state = 'uploading'
      and expires_at < now() - interval '30 minutes')                            as stuck_uploads,
  (select count(*) from private.library_events where kind = 'purge_stuck'
      and at > now() - interval '7 days')                                        as purge_stuck_7d,
  (select count(*) from private.library_events where kind = 'orphan_removed'
      and at > now() - interval '7 days')                                        as orphans_7d,
  (select count(*) from private.library_events where kind = 'counter_drift'
      and at > now() - interval '7 days')                                        as drift_7d,
  (select max(at) from private.library_events where kind = 'janitor_run')        as last_janitor_run,
  (select coalesce(sum(bytes_active + bytes_releasing), 0) from private.library_usage) as counted_bytes,
  (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects
      where bucket_id = 'user-media')                                            as stored_bytes;

-- ============================================================ 7. Edge Function entry point (service_role only)
create or replace function public.svc_library(p_op text, p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_uid uuid; n int; x text;
begin
  -- defence in depth: the grant already limits this to service_role; also require the request's role claim
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'svc_library: service role required' using errcode = '42501';
  end if;
  v_uid := nullif(a ->> 'user_id', '')::uuid;
  case p_op
    when 'begin' then
      return private.lib_begin(v_uid, (a ->> 'client_key')::uuid, a ->> 'name', (a ->> 'type')::public.sound_type,
               (a ->> 'duration_ms')::int, (a ->> 'size')::bigint, a ->> 'sha256', a ->> 'origin',
               coalesce((a ->> 'allow_duplicate')::boolean, false));
    when 'finish' then
      return private.lib_finish(v_uid, (a ->> 'id')::uuid);
    when 'abandon' then
      return to_jsonb(private.lib_abandon(v_uid, (a ->> 'id')::uuid, left(coalesce(a ->> 'reason', 'client'), 40)));
    when 'ready_item' then
      return coalesce(private.lib_ready_item(v_uid, (a ->> 'id')::uuid), 'null'::jsonb);
    when 'janitor_acquire' then
      return to_jsonb(private.janitor_acquire(a ->> 'holder', least(coalesce((a ->> 'secs')::int, 120), 600)));
    when 'janitor_release' then
      perform private.janitor_release(a ->> 'holder'); return 'true'::jsonb;
    when 'expired' then
      return private.lib_expired(coalesce((a ->> 'limit')::int, 50));
    when 'due_purges' then
      return private.lib_due_purges(coalesce((a ->> 'limit')::int, 50));
    when 'purged' then
      return to_jsonb(private.lib_purged((a ->> 'id')::uuid));
    when 'purge_failed' then
      perform private.lib_purge_failed((a ->> 'id')::uuid, a ->> 'error'); return 'true'::jsonb;
    when 'orphans' then
      return private.lib_orphans(coalesce((a ->> 'limit')::int, 50));
    when 'orphans_removed' then
      for x in select jsonb_array_elements_text(coalesce(a -> 'names', '[]'::jsonb)) loop
        perform private.log(null, null, 'orphan_removed', jsonb_build_object('name', x));
      end loop;
      return 'true'::jsonb;
    when 'audit_due' then
      return private.lib_audit_due(coalesce((a ->> 'limit')::int, 50));
    when 'audit_user' then
      return to_jsonb(private.lib_audit_user(v_uid));
    when 'drop_tombstones' then
      n := private.lib_drop_tombstones(); return to_jsonb(n);
    when 'run_log' then
      perform private.log(null, null, 'janitor_run', a -> 'detail'); return 'true'::jsonb;
    else
      raise exception 'svc_library: unknown op %', p_op using errcode = '22023';
  end case;
end $$;

-- ============================================================ 8. browser-callable (auth.uid() only)
create or replace function public.library_delete(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); r public.library_items;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform private.lib_lock(v_uid);                                             -- lock 1
  select * into r from public.library_items where id = p_id and user_id = v_uid for update;  -- lock 2
  if not found then return 'not_found'; end if;
  if r.state = 'uploading' then return private.lib_abandon(v_uid, p_id, 'cancelled'); end if;
  if r.state <> 'ready' then return r.state; end if;                           -- already going away
  update public.library_items
     set state = 'deleting', deleted_at = now(), updated_at = now(),
         purge_next_at = now() + make_interval(secs => private.lim('purge_grace_s'))
   where id = p_id;
  update private.library_usage
     set items_active = items_active - 1, bytes_active = bytes_active - r.size_bytes,
         bytes_releasing = bytes_releasing + r.size_bytes, updated_at = now()
   where user_id = v_uid;
  return 'deleting';
end $$;                                             -- works under every switch, including emergency_stop

create or replace function public.library_job_status(p_client_keys uuid[])
returns table (client_key uuid, id uuid, state text)
language sql stable security definer set search_path = '' as $$
  select li.client_key, li.id, li.state from public.library_items li
   where li.user_id = auth.uid() and li.client_key = any (p_client_keys[1:100])
$$;

create or replace function public.library_usage() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'items', coalesce(u.items_active, 0), 'bytes', coalesce(u.bytes_active, 0),
    'max_items', private.lim('max_items'), 'max_bytes', private.lim('max_bytes'),
    'uploads_open', private.flag('reservations_open') and not private.flag('emergency_stop'),
    'enabled', exists (select 1 from private.cloud_access a where a.user_id = x.uid))
  from (select auth.uid() as uid) x
  left join private.library_usage u on u.user_id = x.uid
  where x.uid is not null
$$;

-- ============================================================ 9. privileges
revoke all on all tables    in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

revoke all on function public.svc_library(text, jsonb)      from public, anon, authenticated;
revoke all on function public.library_delete(uuid)          from public, anon, service_role;
revoke all on function public.library_job_status(uuid[])    from public, anon, service_role;
revoke all on function public.library_usage()               from public, anon, service_role;
grant execute on function public.svc_library(text, jsonb)   to service_role;
grant execute on function public.library_delete(uuid)       to authenticated;
grant execute on function public.library_job_status(uuid[]) to authenticated;
grant execute on function public.library_usage()            to authenticated;

-- ============================================================ 10. storage: private bucket, NO policies
-- Only the Edge Functions (secret key = service_role, which bypasses RLS) touch this bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-media', 'user-media', false, 10485760, array['audio/mpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- refuse to finish if any storage policy mentions this bucket (none must exist)
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'storage'
              and (coalesce(qual, '') || coalesce(with_check, '')) like '%user-media%') then
    raise exception 'a storage policy references user-media; remove it before continuing';
  end if;
end $$;

commit;
select 'SnipRing library 1B ready (uploads closed until reservations_open = true)' as status;
