-- Playlists: one row per playlist, its titles packed into `items` (see
-- src/lib/playlistCodec.ts): a version byte, then per title one tag byte and
-- the IMDb number as a varint, so a title costs ~4-5 bytes. Names and posters
-- aren't stored; the app looks them up.
create table public.playlists (
  id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  items bytea not null check (octet_length(items) <= 8192),
  deleted boolean not null default false,
  updated_at bigint not null,
  synced_at timestamptz not null default now()
);
create index playlists_pull_idx on public.playlists(profile_id, synced_at);
create index playlists_user_idx on public.playlists(user_id);

-- Same last-write-wins rule as the library and progress.
create trigger playlists_lww before insert or update on public.playlists
  for each row execute function public.sync_lww();

-- At most 100 playlists per profile (deleted ones included until purged).
create function public.enforce_playlist_limit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.playlists where profile_id = new.profile_id) >= 100 then
    raise exception 'playlist_limit' using hint = 'A profile can have up to 100 playlists.';
  end if;
  return new;
end $$;
create trigger playlists_limit before insert on public.playlists
  for each row execute function public.enforce_playlist_limit();
revoke all on function public.enforce_playlist_limit() from public, anon, authenticated;

alter table public.playlists enable row level security;
create policy "own playlists" on public.playlists for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = (select auth.uid()))
  );
