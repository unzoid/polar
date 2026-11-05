-- Back to one entry per title (undoes per_episode_progress.sql): new pushes keep
-- only the newest video, and every stored row is cut down to its newest entry.
-- Turn the setting off on each device too.

drop trigger progress_sync on public.progress;
create trigger progress_sync before insert or update on public.progress
  for each row execute function public.progress_newest();

-- The rewrite doesn't move updated_at, which the trigger would refuse.
alter table public.progress disable trigger progress_sync;
update public.progress p
set entries = '\x01'::bytea || n.body || '\x00'::bytea
from public.progress q
cross join lateral (
  select e.body from public.polar_entries(q.meta_id, q.entries, q.updated_at) e order by e.at desc, e.sort_key limit 1
) n
where p.profile_id = q.profile_id and p.meta_id = q.meta_id;
alter table public.progress enable trigger progress_sync;
