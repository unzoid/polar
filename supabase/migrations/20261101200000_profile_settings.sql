-- Per-profile preferences (player, subtitles, interface, shortcuts, addons)
-- as one small JSON document, last write wins like everything else.
-- Device-only things (volume, TV sounds) stay local.
create table public.profile_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null check (pg_column_size(data) <= 16384),
  updated_at bigint not null,
  synced_at timestamptz not null default now()
);
create index profile_settings_user_idx on public.profile_settings(user_id);

create trigger profile_settings_lww before insert or update on public.profile_settings
  for each row execute function public.sync_lww();

alter table public.profile_settings enable row level security;
create policy "own settings" on public.profile_settings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = (select auth.uid()))
  );

-- watch_progress.stream is no longer sent (it was ~75% of each row and its
-- URL often expires; each device keeps its own). Optional cleanup:
--   update public.watch_progress set stream = null where stream is not null;
