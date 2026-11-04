-- Anime links: for each AniList entry a profile has opened, the id its library
-- and progress are kept under (docs/anime-identity.md). One small row per anime
-- (~30 bytes of data); the newest decision about an entry wins, so it uses the
-- same last-write-wins trigger as the library and progress.
create table public.anime_links (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  anilist int not null check (anilist > 0),
  -- An IMDb id (tt…) or a Kitsu id (kitsu:N): the ids Polar keys titles by.
  canonical text not null check (canonical ~ '^(tt[0-9]{1,10}|kitsu:[0-9]{1,10})$'),
  mal int check (mal > 0),
  kitsu int check (kitsu > 0),
  updated_at bigint not null,
  synced_at timestamptz not null default now(),
  primary key (profile_id, anilist)
);
create index anime_links_pull_idx on public.anime_links(profile_id, synced_at);
create index anime_links_user_idx on public.anime_links(user_id);

create trigger anime_links_lww before insert or update on public.anime_links
  for each row execute function public.sync_lww();

alter table public.anime_links enable row level security;
create policy "own anime links" on public.anime_links for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = (select auth.uid()))
  );
