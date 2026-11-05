-- Per-episode history on the server: every video a profile played, packed per
-- title in `progress.entries`, instead of only the newest one. Not a migration:
-- run it once (dashboard SQL editor or `psql`) when the database has room for
-- it (docs/supabase-storage.md §2: the heavy test profile's progress grows from
-- 376 KiB to 496 KiB, whole profile 0.66 to 0.78 MiB), after
-- supabase/migrations/20261105000000_compact_storage.sql. Then turn on
-- the `syncEpisodeHistory` setting on each device (docs/supabase-storage.md
-- §3.4), so the app pushes every episode and not only the newest.
-- To go back: supabase/optional/per_episode_progress_off.sql.

-- Last write wins per video: each video keeps its newer entry (a tie keeps
-- the stored one), kind follows the newest push, and a push that changes
-- nothing writes nothing. Entries arrive checked, clamped and re-encoded, so
-- what's stored always decodes.
create or replace function public.progress_merge() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  cap bigint := public.polar_time_cap();
  pushed_at bigint;
  top bigint;
  packed bytea;
begin
  create temp table if not exists polar_merge (video_id text, sort_key bytea, body bytea, at bigint, src int) on commit drop;
  truncate polar_merge;
  insert into polar_merge
    select distinct on (e.video_id) e.video_id, e.sort_key, e.body, least(e.at, cap), 1
    from public.polar_entries(new.meta_id, new.entries, new.updated_at) e
    order by e.video_id, e.at desc;
  select max(m.at) into pushed_at from polar_merge m;
  if pushed_at is null then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    insert into polar_merge
      select o.video_id, o.sort_key, o.body, o.at, 0 from public.polar_entries(old.meta_id, old.entries, old.updated_at) o;
    -- Per video the newer entry; on a tie the stored one (src 0).
    delete from polar_merge m using polar_merge w
      where m.video_id = w.video_id and (w.at > m.at or (w.at = m.at and w.src < m.src));
    if not exists (select 1 from polar_merge m where m.src = 1) then
      return null;
    end if;
    if pushed_at <= old.updated_at then
      new.kind := old.kind;
    end if;
  end if;
  select max(m.at) into top from polar_merge m;
  select '\x01'::bytea || string_agg(m.body || public.polar_varint_bytes(top - m.at), ''::bytea order by m.sort_key)
    into packed from polar_merge m;
  new.entries := packed;
  new.updated_at := top;
  new.synced_at := now();
  return new;
end $$;
revoke all on function public.progress_merge() from public, anon, authenticated;

drop trigger progress_sync on public.progress;
create trigger progress_sync before insert or update on public.progress
  for each row execute function public.progress_merge();
