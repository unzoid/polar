-- Checks for supabase/migrations/20261105000000_compact_storage.sql, to run on
-- a copy of the project (docs/supabase-storage.md §7) in the SQL editor.
-- Nothing here writes.

-- 1. BEFORE the migration: note these numbers.
--    select count(*) as library_rows from public.library_items;
--    select count(distinct (profile_id, meta_id)) as progress_titles from public.watch_progress;
--    select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- 2. AFTER the migration.

-- Same counts as library_rows and progress_titles above.
select
  (select count(*) from public.library) as library_rows,
  (select count(*) from public.progress) as progress_titles;

-- Every progress row decodes (an error here names a broken row) and holds one
-- entry, the time of which is the row's (0 rows expected).
select p.profile_id, p.meta_id, count(e.*) as entries
from public.progress p
left join lateral public.polar_entries(p.meta_id, p.entries, p.updated_at) e on true
group by p.profile_id, p.meta_id, p.updated_at
having count(e.*) <> 1 or max(e.at) <> p.updated_at;

-- No API keys or add-on links left in the stored settings (0 expected).
select count(*) as settings_with_secrets
from public.profile_settings
where data ? 'addons'
  or data->'settings' ?| array['tmdbKey', 'omdbKey', 'mdblistKey', 'seekrKey'];

-- The old tables and user_id columns are gone (0 expected).
select count(*) as leftovers
from information_schema.columns
where table_schema = 'public'
  and (table_name in ('library_items', 'watch_progress') or (column_name = 'user_id' and table_name <> 'profiles'));

-- Row level security is on for every table (all true expected).
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('profiles', 'library', 'progress', 'playlists', 'profile_settings', 'anime_links');

-- Compare with database_size above.
select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- 3. In the app: sign in with two accounts on two devices and check that
--    neither sees the other's library, that a title saved or played on one
--    device shows on another signed in to the same profile (names and
--    pictures appear after a moment: they're looked up on the device), and
--    that Settings → Services keys and Settings → Add-ons stay per device.
