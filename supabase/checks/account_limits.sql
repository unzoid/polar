-- Checks for supabase/migrations/20261107000000_account_limits.sql, to run in
-- the SQL editor after the migration (docs/supabase-storage.md §8).
-- The migration's value checks hold for rows written from then on. 1 counts
-- the older rows that don't pass them; once every count is 0 (fix or delete
-- the rows it names first), 2 marks the checks as holding for every row.

-- 1. Rows that don't pass a check (every count 0 expected).
select 'library_meta_id_format' as "check", count(*) as rows from public.library
  where not (octet_length(meta_id) <= 200 and meta_id !~ '[[:cntrl:]]')
union all select 'library_times', count(*) from public.library where not (added_at >= 0 and updated_at >= 0)
union all select 'progress_meta_id_format', count(*) from public.progress
  where not (octet_length(meta_id) <= 200 and meta_id !~ '[[:cntrl:]]')
union all select 'progress_times', count(*) from public.progress where not (updated_at >= 0)
union all select 'anime_links_times', count(*) from public.anime_links where not (updated_at >= 0)
union all select 'playlists_name_format', count(*) from public.playlists where not (name !~ '[[:cntrl:]]')
union all select 'playlists_times', count(*) from public.playlists where not (updated_at >= 0)
union all select 'profile_settings_object', count(*) from public.profile_settings where not (jsonb_typeof(data) = 'object')
union all select 'profile_settings_times', count(*) from public.profile_settings where not (updated_at >= 0)
union all select 'profiles_name_format', count(*) from public.profiles where not (name !~ '[[:cntrl:]]')
union all select 'profiles_avatar_format', count(*) from public.profiles where not (avatar ~ '^[a-z0-9-]{1,32}$')
union all select 'profiles_position_range', count(*) from public.profiles where not (position between 0 and 1000);

-- 2. Only when every count above is 0 (each line fails on a row that doesn't pass).
alter table public.library validate constraint library_meta_id_format;
alter table public.library validate constraint library_times;
alter table public.progress validate constraint progress_meta_id_format;
alter table public.progress validate constraint progress_times;
alter table public.anime_links validate constraint anime_links_times;
alter table public.playlists validate constraint playlists_name_format;
alter table public.playlists validate constraint playlists_times;
alter table public.profile_settings validate constraint profile_settings_object;
alter table public.profile_settings validate constraint profile_settings_times;
alter table public.profiles validate constraint profiles_name_format;
alter table public.profiles validate constraint profiles_avatar_format;
alter table public.profiles validate constraint profiles_position_range;
