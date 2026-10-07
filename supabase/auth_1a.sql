-- =====================================================================
-- SnipRing Phase 1A: account foundation (identity + private profiles).
-- Scope: Supabase Auth users get a private profile row, created automatically.
-- No plans, entitlements, billing, credits, storage or Studio tables (later phases).
-- Additive and safe to re-run. Rollback: supabase/auth_1a_rollback.sql
-- =====================================================================

-- 1) profiles become private: only the owner can read their own row.
--    (Public creator profiles will come later through a separate, explicit view.)
alter table public.profiles add column if not exists locale text check (locale in ('he','en'));
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

drop policy if exists "active profiles are readable" on public.profiles;
drop policy if exists "own profile readable" on public.profiles;
create policy "own profile readable" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "own profile editable" on public.profiles;
create policy "own profile editable" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- no insert/delete policies: rows are created by the trigger below and removed with the auth user (on delete cascade)
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, locale, updated_at) on public.profiles to authenticated;

-- 2) every new auth user gets a profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 60), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) backfill for any user created before this migration (none expected)
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

select 'SnipRing auth 1A ready' as status;
