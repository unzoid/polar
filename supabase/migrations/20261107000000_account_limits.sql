-- Account limits (#110, docs/supabase-storage.md §8): every table an account
-- can write has a per-row size cap and a row cap, so the most one account can
-- store is known. On top of the per-row caps already in place:
--   library       5,000 rows a profile, 10,000 an account
--   progress      5,000 rows a profile, 10,000 an account; a row of the
--                default (one entry) mode up to 512 bytes of entries
--   anime_links   5,000 rows a profile
--   playlists     1,000 rows a profile, removed ones included (100 live, as before)
-- Removals older than 90 days are purged to make room when a profile reaches
-- its cap; a refused insert raises '<table>_limit' (or 'playlist_limit') and
-- the app says which part of the account is full.
-- A removed playlist keeps no titles.
-- Values: ids without control characters and at most 200 bytes, times not
-- negative, `added_at` clamped like `updated_at`, avatars and names checked,
-- settings a JSON object. The new checks are `not valid`: they hold for every
-- row written from now on; supabase/checks/account_limits.sql finds older rows
-- that don't pass and validates them.

-- --- Row caps ---------------------------------------------------------------

-- After each insert statement: the profiles it added rows to, each within its
-- cap and its account within the account cap (0: none). Runs once per
-- statement, so a push of 500 rows counts once. A profile past its cap first
-- loses the removals no device needs any more (library tombstones and removed
-- playlists changed more than 90 days ago).
create function public.enforce_row_caps() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  per_profile int := tg_argv[0]::int;
  per_account int := tg_argv[1]::int;
  code text := tg_argv[2];
  p record;
  n bigint;
begin
  for p in select distinct t.profile_id, pr.user_id
    from added t join public.profiles pr on pr.id = t.profile_id
  loop
    execute format('select count(*) from public.%I where profile_id = $1', tg_table_name) into n using p.profile_id;
    if n > per_profile then
      if tg_table_name = 'library' then
        delete from public.library
          where profile_id = p.profile_id and kind >= 128 and synced_at < now() - interval '90 days';
      elsif tg_table_name = 'playlists' then
        delete from public.playlists
          where profile_id = p.profile_id and deleted and synced_at < now() - interval '90 days';
      end if;
      execute format('select count(*) from public.%I where profile_id = $1', tg_table_name) into n using p.profile_id;
    end if;
    if n > per_profile then
      raise exception '%', code
        using hint = format('A profile can keep up to %s rows in %s.', per_profile, tg_table_name);
    end if;
    if per_account > 0 then
      execute format('select count(*) from public.%I t join public.profiles pr on pr.id = t.profile_id where pr.user_id = $1',
        tg_table_name) into n using p.user_id;
      if n > per_account then
        raise exception '%', code
          using hint = format('An account can keep up to %s rows in %s.', per_account, tg_table_name);
      end if;
    end if;
  end loop;
  return null;
end $$;

create trigger library_row_caps after insert on public.library
  referencing new table as added
  for each statement execute function public.enforce_row_caps('5000', '10000', 'library_limit');
create trigger progress_row_caps after insert on public.progress
  referencing new table as added
  for each statement execute function public.enforce_row_caps('5000', '10000', 'progress_limit');
create trigger anime_links_row_caps after insert on public.anime_links
  referencing new table as added
  for each statement execute function public.enforce_row_caps('5000', '0', 'anime_links_limit');
create trigger playlists_row_caps after insert on public.playlists
  referencing new table as added
  for each statement execute function public.enforce_row_caps('1000', '0', 'playlist_limit');

-- --- Progress: one small entry unless every episode is kept -----------------

-- After progress_sync (triggers run in name order) has re-encoded the row: in
-- the default mode it holds one entry, which needs far less than the 32 KB
-- the per-episode mode (supabase/optional/per_episode_progress.sql) allows.
-- Only what the app writes: the owner's scripts (per_episode_progress_off.sql
-- shrinking rows back to one entry) aren't held to it.
create function public.progress_entry_size() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and octet_length(new.entries) > 512 and to_regprocedure('public.polar_every_episode()') is null then
    raise exception 'bad_entries' using hint = 'A title''s progress is up to 512 bytes.';
  end if;
  return new;
end $$;
create trigger progress_within_size before insert or update on public.progress
  for each row execute function public.progress_entry_size();

-- --- Library: `added_at` within 1970 .. now + 5 min -------------------------

create function public.library_clamp_added() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.added_at := greatest(0, least(new.added_at::bigint, public.polar_time_cap() / 1000))::int;
  return new;
end $$;
create trigger library_added before insert or update on public.library
  for each row execute function public.library_clamp_added();

-- --- Playlists: a removed one keeps no titles ------------------------------

-- The app reads nothing but the removal from it (src/lib/library/playlists.ts),
-- so its items shrink to the empty list: the version byte.
create function public.playlist_drop_removed_items() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.deleted then
    new.items := '\x01'::bytea;
  end if;
  return new;
end $$;
create trigger playlists_removed before insert or update on public.playlists
  for each row execute function public.playlist_drop_removed_items();

-- --- Value checks -----------------------------------------------------------

alter table public.library
  add constraint library_meta_id_format check (octet_length(meta_id) <= 200 and meta_id !~ '[[:cntrl:]]') not valid,
  add constraint library_times check (added_at >= 0 and updated_at >= 0) not valid;
alter table public.progress
  add constraint progress_meta_id_format check (octet_length(meta_id) <= 200 and meta_id !~ '[[:cntrl:]]') not valid,
  add constraint progress_times check (updated_at >= 0) not valid;
alter table public.anime_links
  add constraint anime_links_times check (updated_at >= 0) not valid;
alter table public.playlists
  add constraint playlists_name_format check (name !~ '[[:cntrl:]]') not valid,
  add constraint playlists_times check (updated_at >= 0) not valid;
alter table public.profile_settings
  add constraint profile_settings_object check (jsonb_typeof(data) = 'object') not valid,
  add constraint profile_settings_times check (updated_at >= 0) not valid;
-- Avatars are ids like the app's (src/lib/account/avatars.ts); the app never
-- sets `position` past the profile limit.
alter table public.profiles
  add constraint profiles_name_format check (name !~ '[[:cntrl:]]') not valid,
  add constraint profiles_avatar_format check (avatar ~ '^[a-z0-9-]{1,32}$') not valid,
  add constraint profiles_position_range check (position between 0 and 1000) not valid;

revoke all on function public.enforce_row_caps() from public, anon, authenticated;
revoke all on function public.progress_entry_size() from public, anon, authenticated;
revoke all on function public.playlist_drop_removed_items() from public, anon, authenticated;
revoke all on function public.library_clamp_added() from public, anon, authenticated;
