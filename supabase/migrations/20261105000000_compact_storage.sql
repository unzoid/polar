-- Compact storage (docs/supabase-storage.md). Accounts keep only the user's
-- own data, never facts about a show (no names, images or episode titles):
-- library and progress move to `library` and `progress`, one row per title.
-- `progress.entries` is packed (src/lib/account/progressCodec.ts) and holds one
-- entry, the newest video the profile is on; supabase/optional/
-- per_episode_progress.sql turns on keeping every episode, merged per video.
-- The old tables are copied in and dropped: app versions from before this stop
-- syncing library and progress until updated.
-- Also: API keys and add-on links leave the synced settings (they stay on each
-- device), client times are clamped to now + 5 min (critique H2), the playlist
-- limit counts live playlists on real inserts only (H4), and `user_id` leaves
-- every per-profile table (row level security goes through `profiles`).

-- --- Codec ------------------------------------------------------------------

-- One unsigned LEB128 varint at byte `pos` (0-based); `pos` comes back past it.
create function public.polar_varint(b bytea, inout pos int, out val bigint)
language plpgsql immutable strict set search_path = '' as $$
declare
  byte int;
  shift int := 0;
begin
  val := 0;
  loop
    if pos >= length(b) or shift > 49 then
      raise exception 'bad_entries';
    end if;
    byte := get_byte(b, pos);
    pos := pos + 1;
    val := val + ((byte & 127)::bigint << shift);
    exit when byte < 128;
    shift := shift + 7;
  end loop;
  -- What JavaScript reads exactly (Number.MAX_SAFE_INTEGER).
  if val > 9007199254740991 then
    raise exception 'bad_entries';
  end if;
end $$;

create function public.polar_varint_bytes(n bigint) returns bytea
language plpgsql immutable strict set search_path = '' as $$
declare
  out bytea := ''::bytea;
begin
  if n < 0 then
    raise exception 'bad_entries';
  end if;
  loop
    if n < 128 then
      return out || set_byte('\x00'::bytea, 0, n::int);
    end if;
    out := out || set_byte('\x00'::bytea, 0, ((n & 127) | 128)::int);
    n := n >> 7;
  end loop;
end $$;

-- A row's entries: per video its id, the bytes it sorts by (form + payload),
-- its bytes without the age, and its time. Raises 'bad_entries' on anything
-- that isn't version 1 written correctly.
create function public.polar_entries(meta text, b bytea, row_at bigint)
returns table (video_id text, sort_key bytea, body bytea, at bigint)
language plpgsql immutable strict set search_path = '' as $$
declare
  pos int := 1;
  start int;
  key_end int;
  flags int;
  season bigint;
  episode bigint;
  n bigint;
  age bigint;
begin
  if length(b) = 0 or get_byte(b, 0) <> 1 then
    raise exception 'bad_entries';
  end if;
  while pos < length(b) loop
    start := pos;
    flags := get_byte(b, pos);
    pos := pos + 1;
    if flags > 15 then
      raise exception 'bad_entries';
    end if;
    season := null;
    episode := null;
    case flags & 3
      when 0 then
        video_id := meta;
      when 1 then
        select v.pos, v.val into pos, season from public.polar_varint(b, pos) v;
        select v.pos, v.val into pos, episode from public.polar_varint(b, pos) v;
        video_id := meta || ':' || season || ':' || episode;
      when 2 then
        select v.pos, v.val into pos, episode from public.polar_varint(b, pos) v;
        video_id := meta || ':' || episode;
      else
        select v.pos, v.val into pos, n from public.polar_varint(b, pos) v;
        if pos + n > length(b) then
          raise exception 'bad_entries';
        end if;
        video_id := convert_from(substr(b, pos + 1, n::int), 'UTF8');
        pos := pos + n::int;
    end case;
    key_end := pos;
    if flags & 4 <> 0 and season is null then
      select v.pos into pos from public.polar_varint(b, pos) v;
    end if;
    if flags & 8 <> 0 and episode is null then
      select v.pos into pos from public.polar_varint(b, pos) v;
    end if;
    select v.pos into pos from public.polar_varint(b, pos) v; -- position
    select v.pos into pos from public.polar_varint(b, pos) v; -- duration
    body := substr(b, start + 1, pos - start);
    select v.pos, v.val into pos, age from public.polar_varint(b, pos) v;
    if age > row_at then
      raise exception 'bad_entries';
    end if;
    sort_key := set_byte(substr(b, start + 1, key_end - start), 0, flags & 3);
    at := row_at - age;
    return next;
  end loop;
end $$;

-- One video as progressCodec.ts's encodeEntries writes it, without the age:
-- used to copy the old per-episode rows in.
create function public.polar_entry(meta text, video text, season bigint, episode bigint, pos float8, dur float8,
  out sort_key bytea, out body bytea)
language plpgsql immutable set search_path = '' as $$
declare
  num constant text := '(0|[1-9][0-9]{0,14})';
  rest text;
  parts text[];
  flags int := (case when season is null then 0 else 4 end) | (case when episode is null then 0 else 8 end);
  tail bytea := ''::bytea;
begin
  if video like meta || ':%' then
    rest := substr(video, length(meta) + 2);
  end if;
  if video = meta then
    sort_key := '\x00';
    tail := coalesce(public.polar_varint_bytes(season), '') || coalesce(public.polar_varint_bytes(episode), '');
  elsif rest ~ ('^' || num || ':' || num || '$')
    and split_part(rest, ':', 1)::bigint = season and split_part(rest, ':', 2)::bigint = episode then
    sort_key := '\x01'::bytea || public.polar_varint_bytes(season) || public.polar_varint_bytes(episode);
  elsif rest ~ ('^' || num || '$') and rest::bigint = episode then
    sort_key := '\x02'::bytea || public.polar_varint_bytes(episode);
    tail := coalesce(public.polar_varint_bytes(season), '');
  else
    sort_key := '\x03'::bytea || public.polar_varint_bytes(length(convert_to(video, 'UTF8'))) || convert_to(video, 'UTF8');
    tail := coalesce(public.polar_varint_bytes(season), '') || coalesce(public.polar_varint_bytes(episode), '');
  end if;
  body := set_byte(sort_key, 0, get_byte(sort_key, 0) | flags) || tail
    || public.polar_varint_bytes(case when pos > 0 and pos < 1e15 then floor(pos + 0.5)::bigint else 0 end)
    || public.polar_varint_bytes(case when dur > 0 and dur < 1e15 then floor(dur + 0.5)::bigint else 0 end);
end $$;

-- The latest a client time may be: now + 5 min, in ms (critique H2).
create function public.polar_time_cap() returns bigint
language sql stable set search_path = '' as $$
  select (extract(epoch from now()) * 1000)::bigint + 300000
$$;

-- --- Last write wins, clamped -----------------------------------------------

create or replace function public.sync_lww() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := least(new.updated_at, public.polar_time_cap());
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;
  end if;
  new.synced_at := now();
  return new;
end $$;

-- --- library ----------------------------------------------------------------

create table public.library (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null check (char_length(meta_id) between 1 and 200),
  -- 0 movie, 1 series; 128 + kind = removed (a tombstone).
  kind smallint not null check (kind in (0, 1, 128, 129)),
  -- Seconds since 1970: display order only.
  added_at int not null,
  updated_at bigint not null,
  synced_at timestamptz not null default now(),
  primary key (profile_id, meta_id)
);
create trigger library_lww before insert or update on public.library
  for each row execute function public.sync_lww();

-- --- progress ---------------------------------------------------------------

create table public.progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null check (char_length(meta_id) between 1 and 200),
  kind smallint not null check (kind in (0, 1)),
  entries bytea not null check (octet_length(entries) <= 32768),
  -- The newest entry's time (ms); entries' ages count back from it.
  updated_at bigint not null,
  synced_at timestamptz not null default now(),
  primary key (profile_id, meta_id)
);

-- One entry per title: the push's newest entry replaces the stored one when
-- it's newer, and kind follows it. Entries arrive checked, clamped and
-- re-encoded, so what's stored always decodes.
create function public.progress_newest() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  e record;
begin
  select n.body, least(n.at, public.polar_time_cap()) as at into e
    from public.polar_entries(new.meta_id, new.entries, new.updated_at) n
    order by n.at desc, n.sort_key limit 1;
  if e is null or (tg_op = 'UPDATE' and e.at <= old.updated_at) then
    return null;
  end if;
  new.entries := '\x01'::bytea || e.body || '\x00'::bytea;
  new.updated_at := e.at;
  new.synced_at := now();
  return new;
end $$;
create trigger progress_sync before insert or update on public.progress
  for each row execute function public.progress_newest();

-- --- Copy the old rows in ---------------------------------------------------

insert into public.library (profile_id, meta_id, kind, added_at, updated_at)
select profile_id, meta_id,
  (case when type = 'series' then 1 else 0 end) + (case when deleted then 128 else 0 end),
  (added_at / 1000)::int,
  updated_at
from public.library_items;

-- Per title the newest video only (the trigger keeps one entry).
insert into public.progress (profile_id, meta_id, kind, entries, updated_at)
select distinct on (p.profile_id, p.meta_id) p.profile_id, p.meta_id,
  case when p.type = 'series' then 1 else 0 end,
  '\x01'::bytea || e.body || '\x00'::bytea,
  p.updated_at
from public.watch_progress p
cross join lateral public.polar_entry(p.meta_id, p.video_id, p.season, p.episode, p.position, p.duration) e
order by p.profile_id, p.meta_id, p.updated_at desc, p.video_id;

drop table public.library_items;
drop table public.watch_progress;

-- --- Keys and add-on links stay on each device (I-009 A) ------------------

-- The app no longer sends them (src/lib/account/settingsSync.ts); this takes them
-- out of the documents already stored. A document without `addons` leaves each
-- device's add-ons as they are.
-- The last-write-wins trigger would refuse a write that doesn't move updated_at.
alter table public.profile_settings disable trigger profile_settings_lww;
update public.profile_settings
set data = (data - 'addons') #- '{settings,tmdbKey}' #- '{settings,omdbKey}' #- '{settings,mdblistKey}' #- '{settings,seekrKey}';
alter table public.profile_settings enable trigger profile_settings_lww;

-- --- user_id out of the kept tables -----------------------------------------

drop policy "own playlists" on public.playlists;
drop policy "own settings" on public.profile_settings;
drop policy "own anime links" on public.anime_links;
alter table public.playlists drop column user_id;
alter table public.profile_settings drop column user_id;
alter table public.anime_links drop column user_id;
-- anime_links pulls walk its primary key; playlists keep theirs (the key is `id`).
drop index public.anime_links_pull_idx;

-- --- Playlist limit: live playlists, real inserts only (H4) -----------------

create or replace function public.enforce_playlist_limit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not new.deleted
    and not exists (select 1 from public.playlists where id = new.id)
    and (select count(*) from public.playlists where profile_id = new.profile_id and not deleted) >= 100 then
    raise exception 'playlist_limit' using hint = 'A profile can have up to 100 playlists.';
  end if;
  return new;
end $$;

-- --- Row level security -----------------------------------------------------

alter table public.library enable row level security;
alter table public.progress enable row level security;

create policy "own library" on public.library for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));
create policy "own progress" on public.progress for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));
create policy "own playlists" on public.playlists for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));
create policy "own settings" on public.profile_settings for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));
create policy "own anime links" on public.anime_links for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));

revoke all on function public.progress_newest() from public, anon, authenticated;
revoke all on function public.polar_entry(text, text, bigint, bigint, float8, float8) from public, anon, authenticated;
