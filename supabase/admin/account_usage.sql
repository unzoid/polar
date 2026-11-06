-- Which accounts take the most room (#110): run in the dashboard's SQL editor
-- (it runs as the owner, past row level security). Nothing here writes.
-- Sizes are the rows' own bytes; indexes add roughly as much again. The caps
-- each account is held to are in docs/supabase-storage.md §8.

-- 1. The 50 largest accounts, with their rows per table.
with rows as (
  select p.user_id, 'library' as tbl, pg_column_size(t.*) as bytes
    from public.library t join public.profiles p on p.id = t.profile_id
  union all select p.user_id, 'progress', pg_column_size(t.*)
    from public.progress t join public.profiles p on p.id = t.profile_id
  union all select p.user_id, 'anime_links', pg_column_size(t.*)
    from public.anime_links t join public.profiles p on p.id = t.profile_id
  union all select p.user_id, 'playlists', pg_column_size(t.*)
    from public.playlists t join public.profiles p on p.id = t.profile_id
  union all select p.user_id, 'profile_settings', pg_column_size(t.*)
    from public.profile_settings t join public.profiles p on p.id = t.profile_id
  union all select p.user_id, 'profiles', pg_column_size(p.*) from public.profiles p
)
select
  r.user_id,
  u.email,
  u.created_at,
  pg_size_pretty(sum(r.bytes)) as size,
  sum(r.bytes) as bytes,
  count(*) filter (where r.tbl = 'profiles') as profiles,
  count(*) filter (where r.tbl = 'library') as library,
  count(*) filter (where r.tbl = 'progress') as progress,
  count(*) filter (where r.tbl = 'anime_links') as anime_links,
  count(*) filter (where r.tbl = 'playlists') as playlists
from rows r
join auth.users u on u.id = r.user_id
group by r.user_id, u.email, u.created_at
order by bytes desc
limit 50;

-- 2. Sign-ups per day over the last 30 days: a burst can be a script.
select date_trunc('day', created_at)::date as day, count(*) as accounts
from auth.users
where created_at > now() - interval '30 days'
group by 1
order by 1 desc;

-- 3. The whole database, and each table with its indexes.
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select c.relname as "table", pg_size_pretty(pg_total_relation_size(c.oid)) as size
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;
