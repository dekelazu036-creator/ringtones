-- Rollback for SnipRing Phase 1A. Restores the profiles table to its pre-1A state.
-- Safe while there are no real users. Does not delete auth users or profile rows.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop policy if exists "own profile readable" on public.profiles;
drop policy if exists "own profile editable" on public.profiles;
drop policy if exists "active profiles are readable" on public.profiles;
create policy "active profiles are readable" on public.profiles
  for select to anon, authenticated using (status = 'active');
revoke update on public.profiles from authenticated;
grant select on public.profiles to anon, authenticated;

alter table public.profiles drop column if exists locale;
alter table public.profiles drop column if exists updated_at;

select 'SnipRing auth 1A rolled back' as status;
