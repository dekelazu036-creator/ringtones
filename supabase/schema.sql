-- =====================================================================
-- SnipRing Discover — database schema v1
-- Phase 2: official sounds, public read-only gallery, play/use counters.
-- Prepared for later phases: creators, favourites, packs, moderation, AI.
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent where possible).
-- Nothing here contains secrets.
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------- enums ----------
do $$ begin
  create type sound_type as enum ('ring','text','alarm','sfx','intro','outro','custom');
exception when duplicate_object then null; end $$;
do $$ begin
  -- where the audio came from; decides whether it may ever be public
  create type sound_origin as enum ('official','studio','recording','ai','licensed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type sound_visibility as enum ('private','unlisted','public');
exception when duplicate_object then null; end $$;
do $$ begin
  create type sound_status as enum ('draft','pending','published','rejected','removed');
exception when duplicate_object then null; end $$;

-- ---------- creators (used from phase 5) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text check (char_length(display_name) <= 60),
  avatar_url   text,
  bio          text check (char_length(bio) <= 300),
  status       text not null default 'active' check (status in ('active','suspended')),
  created_at   timestamptz not null default now()
);

-- ---------- sounds ----------
create table if not exists public.sounds (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  owner_id        uuid references public.profiles(id) on delete set null,   -- null = official SnipRing sound
  title_he        text not null check (char_length(title_he) between 1 and 80),
  title_en        text not null check (char_length(title_en) between 1 and 80),
  description_he  text check (char_length(description_he) <= 500),
  description_en  text check (char_length(description_en) <= 500),
  type            sound_type not null,
  duration_ms     int  not null check (duration_ms between 100 and 300000),
  moods           text[] not null default '{}',
  tags            text[] not null default '{}',
  origin          sound_origin not null,
  ai_provider     text,
  license         text not null default 'snipring-standard',
  visibility      sound_visibility not null default 'private',
  status          sound_status not null default 'draft',
  audio_path      text not null,                 -- e.g. sounds/<slug>.mp3 (site) or an R2 key later
  peaks           jsonb,                         -- small waveform preview
  plays           int  not null default 0,
  uses            int  not null default 0,
  favorites       int  not null default 0,
  copyright_check text not null default 'not_needed'
                  check (copyright_check in ('not_needed','pending','clear','match','error')),
  search          tsvector,
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  -- a sound can only be public once it is published and its copyright check passed (or wasn't needed)
  constraint public_needs_clearance check (
    visibility = 'private' or (status = 'published' and copyright_check in ('not_needed','clear'))
  )
);

create or replace function public.sounds_search_refresh() returns trigger
language plpgsql set search_path = public as $$
begin
  new.search :=
    setweight(to_tsvector('simple', coalesce(new.title_he,'') || ' ' || coalesce(new.title_en,'')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(new.tags,' ') || ' ' || array_to_string(new.moods,' ') || ' ' || new.type::text || ' ' ||
      case new.type when 'ring' then 'ringtone רינגטון צלצול' when 'text' then 'notification text התראה הודעה' when 'alarm' then 'alarm wake שעון מעורר השכמה'
                    when 'sfx' then 'effect sfx אפקט' when 'intro' then 'intro פתיח' when 'outro' then 'outro סיום סגיר' else '' end), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.description_he,'') || ' ' || coalesce(new.description_en,'')), 'C');
  return new;
end $$;
drop trigger if exists sounds_search on public.sounds;
create trigger sounds_search before insert or update on public.sounds
  for each row execute function public.sounds_search_refresh();

create index if not exists sounds_search_idx  on public.sounds using gin (search);
create index if not exists sounds_tags_idx    on public.sounds using gin (tags);
create index if not exists sounds_moods_idx   on public.sounds using gin (moods);
create index if not exists sounds_title_he_trgm on public.sounds using gin (title_he gin_trgm_ops);
create index if not exists sounds_title_en_trgm on public.sounds using gin (title_en gin_trgm_ops);
create index if not exists sounds_list_idx    on public.sounds (status, visibility, type, published_at desc);

-- provenance: what each sound was made from. Anything derived from an upload/video stays private forever.
create table if not exists public.sound_sources (
  sound_id        uuid not null references public.sounds(id) on delete cascade,
  kind            text not null check (kind in ('upload','video','recording','ai','compose','sound')),
  parent_sound_id uuid references public.sounds(id) on delete set null,
  primary key (sound_id, kind)
);

-- ---------- packs ----------
create table if not exists public.packs (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  title_he       text not null, title_en text not null,
  description_he text, description_en text,
  cover_path     text,
  is_premium     boolean not null default false,
  status         sound_status not null default 'draft',
  position       int not null default 0,
  created_at     timestamptz not null default now()
);
create table if not exists public.pack_items (
  pack_id  uuid not null references public.packs(id) on delete cascade,
  sound_id uuid not null references public.sounds(id) on delete cascade,
  position int  not null default 0,
  primary key (pack_id, sound_id)
);

-- ---------- per-user & stats ----------
create table if not exists public.favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  sound_id   uuid not null references public.sounds(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sound_id)
);
-- aggregated per day; no per-visitor tracking
create table if not exists public.sound_stats_daily (
  sound_id uuid not null references public.sounds(id) on delete cascade,
  day      date not null default current_date,
  plays    int  not null default 0,
  uses     int  not null default 0,
  primary key (sound_id, day)
);

-- ---------- moderation ----------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  sound_id    uuid not null references public.sounds(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason      text not null check (reason in ('copyright','offensive','spam','other')),
  details     text check (char_length(details) <= 1000),
  contact     text check (char_length(contact) <= 200),
  status      text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  created_at  timestamptz not null default now()
);
create table if not exists public.moderation_actions (
  id         uuid primary key default gen_random_uuid(),
  sound_id   uuid references public.sounds(id) on delete set null,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  note       text,
  created_at timestamptz not null default now()
);

-- ---------- AI generations (phase 4; server-side only) ----------
create table if not exists public.ai_generations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  prompt       text not null check (char_length(prompt) <= 500),
  params       jsonb not null default '{}',
  provider     text not null,
  model        text,
  cost_cents   numeric(10,3),
  status       text not null default 'queued' check (status in ('queued','done','failed','blocked')),
  output_paths text[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security: everything locked by default, then open only what the site needs.
-- =====================================================================
alter table public.profiles           enable row level security;
alter table public.sounds             enable row level security;
alter table public.sound_sources      enable row level security;
alter table public.packs              enable row level security;
alter table public.pack_items         enable row level security;
alter table public.favorites          enable row level security;
alter table public.sound_stats_daily  enable row level security;
alter table public.reports            enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.ai_generations     enable row level security;

drop policy if exists "public sounds are readable" on public.sounds;
create policy "public sounds are readable" on public.sounds for select to anon, authenticated
  using (status = 'published' and visibility in ('public','unlisted'));

drop policy if exists "published packs are readable" on public.packs;
create policy "published packs are readable" on public.packs for select to anon, authenticated
  using (status = 'published');

drop policy if exists "items of published packs are readable" on public.pack_items;
create policy "items of published packs are readable" on public.pack_items for select to anon, authenticated
  using (exists (select 1 from public.packs p where p.id = pack_id and p.status = 'published'));

drop policy if exists "active profiles are readable" on public.profiles;
create policy "active profiles are readable" on public.profiles for select to anon, authenticated
  using (status = 'active');

drop policy if exists "own favourites" on public.favorites;
create policy "own favourites" on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "anyone can report" on public.reports;
create policy "anyone can report" on public.reports for insert to anon, authenticated
  with check (status = 'open' and (reporter_id is null or reporter_id = auth.uid()));

-- Grants (new tables are not exposed automatically in this project)
grant usage on schema public to anon, authenticated;
grant select on public.sounds, public.packs, public.pack_items, public.profiles to anon, authenticated;
grant insert on public.reports to anon, authenticated;
grant select, insert, delete on public.favorites to authenticated;

-- =====================================================================
-- Functions the site may call
-- =====================================================================

-- count a play or a "use" of a public sound (no visitor data stored)
create or replace function public.bump_sound(p_slug text, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if p_kind not in ('play','use') then return; end if;
  select id into sid from public.sounds
   where slug = p_slug and status = 'published' and visibility = 'public';
  if sid is null then return; end if;
  if p_kind = 'play' then update public.sounds set plays = plays + 1 where id = sid;
  else update public.sounds set uses = uses + 1 where id = sid; end if;
  insert into public.sound_stats_daily (sound_id, day, plays, uses)
  values (sid, current_date, (p_kind='play')::int, (p_kind='use')::int)
  on conflict (sound_id, day) do update
    set plays = sound_stats_daily.plays + excluded.plays,
        uses  = sound_stats_daily.uses  + excluded.uses;
end $$;

-- search public sounds by words (Hebrew or English), with typo tolerance on titles
create or replace function public.search_sounds(q text default '', p_type sound_type default null, p_limit int default 48)
returns setof public.sounds language sql stable set search_path = public as $$
  -- any word may match (OR); results with more matching words rank first
  with qq as (select nullif(replace(plainto_tsquery('simple', coalesce(q,''))::text, '&', '|'), '')::tsquery as tq)
  select s.* from public.sounds s, qq
  where s.status = 'published' and s.visibility = 'public'
    and (p_type is null or s.type = p_type)
    and (coalesce(trim(q),'') = ''
         or (qq.tq is not null and s.search @@ qq.tq)
         or s.title_he % q or s.title_en % q)
  order by
    case when coalesce(trim(q),'') = '' or qq.tq is null then 0
         else ts_rank(s.search, qq.tq) + greatest(similarity(s.title_he,q), similarity(s.title_en,q)) end desc,
    s.uses desc, s.published_at desc nulls last
  limit least(greatest(p_limit,1),100);
$$;

-- trending: uses + plays over the last 7 days
create or replace function public.trending_sounds(p_limit int default 24)
returns setof public.sounds language sql stable security definer set search_path = public as $$
  select s.* from public.sounds s
  left join (select sound_id, sum(uses*3 + plays) score from public.sound_stats_daily
             where day > current_date - 7 group by sound_id) t on t.sound_id = s.id
  where s.status = 'published' and s.visibility = 'public'
  order by coalesce(t.score,0) desc, s.published_at desc nulls last
  limit least(greatest(p_limit,1),100);
$$;

revoke all on function public.bump_sound(text,text) from public;
revoke all on function public.trending_sounds(int) from public;
revoke all on function public.sounds_search_refresh() from public, anon, authenticated;
grant execute on function public.bump_sound(text,text)                 to anon, authenticated;
grant execute on function public.search_sounds(text,sound_type,int)    to anon, authenticated;
grant execute on function public.trending_sounds(int)                  to anon, authenticated;

-- done
select 'SnipRing schema v1 ready' as status;
