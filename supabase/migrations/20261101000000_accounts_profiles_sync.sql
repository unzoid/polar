-- Accounts, profiles and library/progress sync for Rustio.
-- Apply with the Supabase MCP (apply_migration), `supabase db push`, or paste
-- into the dashboard's SQL editor.

-- Profiles: several per account ("Who's watching?").
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  avatar text not null default 'blue',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index profiles_user_id_idx on public.profiles(user_id);

-- At most 5 profiles per account.
create function public.enforce_profile_limit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.profiles where user_id = new.user_id) >= 5 then
    raise exception 'profile_limit' using hint = 'An account can have up to 5 profiles.';
  end if;
  return new;
end $$;
create trigger profiles_limit before insert on public.profiles
  for each row execute function public.enforce_profile_limit();

-- Synced rows: client timestamps (ms) decide last-write-wins; synced_at is the
-- server's clock and is what clients pull from.
create table public.library_items (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meta_id text not null,
  type text not null,
  name text not null,
  poster text,
  added_at bigint not null,
  deleted boolean not null default false,
  updated_at bigint not null,
  synced_at timestamptz not null default now(),
  primary key (profile_id, meta_id)
);
create index library_items_pull_idx on public.library_items(profile_id, synced_at);
create index library_items_user_idx on public.library_items(user_id);

create table public.watch_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id text not null,
  meta_id text not null,
  type text not null,
  name text not null,
  background text,
  poster text,
  season int,
  episode int,
  episode_title text,
  stream jsonb,
  position double precision not null,
  duration double precision not null,
  updated_at bigint not null,
  synced_at timestamptz not null default now(),
  primary key (profile_id, video_id)
);
create index watch_progress_pull_idx on public.watch_progress(profile_id, synced_at);
create index watch_progress_user_idx on public.watch_progress(user_id);

-- Last write wins: an older (or re-sent, same-age) write never overwrites
-- what's stored, and every accepted write is stamped with the server clock.
create function public.sync_lww() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;
  end if;
  new.synced_at := now();
  return new;
end $$;
create trigger library_items_lww before insert or update on public.library_items
  for each row execute function public.sync_lww();
create trigger watch_progress_lww before insert or update on public.watch_progress
  for each row execute function public.sync_lww();

-- Row level security: users only ever see their own rows.
alter table public.profiles enable row level security;
alter table public.library_items enable row level security;
alter table public.watch_progress enable row level security;

create policy "own profiles" on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own library" on public.library_items for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = (select auth.uid()))
  );

create policy "own progress" on public.watch_progress for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = (select auth.uid()))
  );

-- Self-service account deletion (everything else goes with it via cascades).
create function public.delete_own_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
revoke all on function public.enforce_profile_limit() from public, anon, authenticated;
revoke all on function public.sync_lww() from public, anon, authenticated;
