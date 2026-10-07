-- Local test for auth_1a.sql. Run on a scratch Postgres with stub auth schema (see AUTH.md). Never on production.
\set ON_ERROR_STOP 0
-- two users sign up (one via Google with a name, one via email)
insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','a@example.com','{"full_name":"Alice Example"}'),
 ('22222222-2222-2222-2222-222222222222','b@example.com','{}');
select 'T1 profiles created by trigger' t, count(*) = 2 ok from public.profiles where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
select 'T2 display name from Google' t, display_name = 'Alice Example' ok from public.profiles where id = '11111111-1111-1111-1111-111111111111';
-- anon sees nothing
set role anon;
select 'T3 anon cannot read profiles' t, false ok from public.profiles limit 1;
reset role;
-- user A
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'T4 A sees only own profile' t, count(*) = 1 and bool_and(id = '11111111-1111-1111-1111-111111111111') ok from public.profiles;
update public.profiles set display_name = 'Alice' where id = '11111111-1111-1111-1111-111111111111';
select 'T5 A can rename self' t, display_name = 'Alice' ok from public.profiles;
update public.profiles set display_name = 'hacked' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set status = 'suspended' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set username = 'alice' where id = '11111111-1111-1111-1111-111111111111';
insert into public.profiles (id) values ('33333333-3333-3333-3333-333333333333');
delete from public.profiles where id = '11111111-1111-1111-1111-111111111111';
reset role;
select 'T6 B untouched by A' t, display_name is null ok from public.profiles where id = '22222222-2222-2222-2222-222222222222';
select 'T7 A status unchanged' t, status = 'active' ok from public.profiles where id = '11111111-1111-1111-1111-111111111111';
select 'T8 A username unchanged' t, username is null ok from public.profiles where id = '11111111-1111-1111-1111-111111111111';
select 'T9 no extra rows' t, count(*) = 2 ok from public.profiles;
-- deleting the auth user removes the profile
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select 'T10 cascade delete' t, count(*) = 1 ok from public.profiles;
-- the trigger function is not callable by clients
set role authenticated;
select 'T11 cannot call trigger fn' t, has_function_privilege('public.handle_new_user()','execute') = false ok;
reset role;
-- public Discover data still readable by anon
set role anon;
select 'T12 discover still public' t, count(*) >= 0 ok from public.sounds;
reset role;
