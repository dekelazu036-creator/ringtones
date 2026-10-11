-- =====================================================================
-- SnipRing private beta invites (M6). Requires library_1b.sql (private.cloud_access, private.log).
-- Idempotent. The owner creates codes; a signed-in user redeems one and joins the cloud-library beta.
--
--   select private.create_invite(5, 14, 'friends');      -- owner, SQL Editor: 5 uses, valid 14 days
--   -> 'A1B2-C3D4-E5F6-0718'  (shown ONCE; only its SHA-256 is stored)
--
-- Rules: codes are 64 random bits (gen_random_uuid); a wrong or used-up code gets the same neutral
-- answer; 10 failed tries per user per hour, then refused; redeeming is idempotent per user.
-- =====================================================================
begin;

create table if not exists private.beta_invites (
  code_hash  text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  uses_left  int  not null check (uses_left >= 0),
  expires_at timestamptz not null,
  note       text,
  created_at timestamptz not null default now());
create table if not exists private.beta_redemptions (
  user_id    uuid primary key references auth.users(id) on delete cascade,   -- goes with the account
  code_hash  text not null,
  at         timestamptz not null default now());
alter table private.beta_invites     enable row level security;   -- no policies: API roles get nothing
alter table private.beta_redemptions enable row level security;

create or replace function private.invite_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

-- owner only (SQL Editor / service). Returns the plain code once.
create or replace function private.create_invite(p_uses int default 1, p_days int default 14, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare u text := upper(replace(gen_random_uuid()::text, '-', '')); c text;
begin
  if p_uses not between 1 and 1000 or p_days not between 1 and 365 then raise exception 'uses 1..1000, days 1..365'; end if;
  -- 16 hex digits = 64 random bits (skips the fixed version/variant digits of a v4 uuid)
  c := substr(u, 1, 12) || substr(u, 18, 4);
  c := substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4) || '-' || substr(c, 13, 4);
  insert into private.beta_invites (code_hash, uses_left, expires_at, note)
  values (private.invite_hash(c), p_uses, now() + make_interval(days => p_days), left(p_note, 100));
  return c;
end $$;

-- signed-in user redeems a code: 'ok' | 'already' | 'invalid' | 'rate_limited'
create or replace function public.beta_redeem(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); h text; inv private.beta_invites; fails int;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('snipring.invite.' || v_uid::text, 0));   -- one redemption per user at a time
  if exists (select 1 from private.cloud_access a where a.user_id = v_uid) then return 'already'; end if;
  select count(*) into fails from private.library_events e
   where e.user_id = v_uid and e.kind = 'invite_failed' and e.at > now() - interval '1 hour';
  if fails >= 10 then return 'rate_limited'; end if;
  h := private.invite_hash(left(coalesce(p_code, ''), 64));
  select * into inv from private.beta_invites where code_hash = h for update;
  if not found or inv.uses_left < 1 or inv.expires_at <= now() then
    perform private.log(v_uid, null, 'invite_failed', null);                 -- no code in the log
    return 'invalid';
  end if;
  update private.beta_invites set uses_left = uses_left - 1 where code_hash = h;
  insert into private.cloud_access (user_id) values (v_uid) on conflict do nothing;
  insert into private.beta_redemptions (user_id, code_hash) values (v_uid, h) on conflict do nothing;
  perform private.log(v_uid, null, 'invite_redeemed', null);
  return 'ok';
end $$;

revoke all on private.beta_invites, private.beta_redemptions from public, anon, authenticated, service_role;
revoke all on function private.invite_hash(text), private.create_invite(int, int, text) from public, anon, authenticated, service_role;
revoke all on function public.beta_redeem(text) from public, anon, service_role;
grant execute on function public.beta_redeem(text) to authenticated;

commit;
select 'SnipRing beta invites ready' as status;
