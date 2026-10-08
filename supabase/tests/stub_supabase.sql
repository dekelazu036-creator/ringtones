-- =====================================================================
-- LOCAL TEST STUB ONLY. Never run on staging or production.
-- Recreates the parts of a hosted Supabase database that SnipRing's SQL relies on,
-- so migrations and security tests can run on a scratch Postgres:
--   roles (anon, authenticated, service_role), auth.users + auth.uid()/auth.role(),
--   storage.buckets + storage.objects (RLS on, broad grants like hosted Supabase),
--   and Supabase's DEFAULT PRIVILEGES on schema public (new tables/functions are
--   granted to anon/authenticated automatically — the trap our migration must undo).
-- Differences from real Supabase are listed in supabase/tests/README.md.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- auth ----------
create schema if not exists auth;
create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}',
  is_anonymous       boolean not null default false,
  created_at         timestamptz not null default now());

-- same definitions as hosted Supabase (claims set per request by PostgREST)
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- ---------- storage ----------
create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now());
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
-- hosted Supabase grants these broadly and relies on RLS policies
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

-- ---------- Supabase default privileges on public ----------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

select 'local supabase stub ready' as status;
