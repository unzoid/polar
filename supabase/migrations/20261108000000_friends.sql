-- Friends (#135): a profile that turns Friends on gets a friend code; someone
-- who has the code sends a request, which the other side accepts or declines.
-- Either side can remove the other; blocking hides you from them and refuses
-- their requests. Everything goes through the functions below (the tables
-- have row level security and no policies): they check that the profile is
-- the caller's and keep within the caps.
--
-- Being online, in a party and what's on travel by Realtime Presence on the
-- private topic `friends:<profile id>`: only its own account shows presence
-- there; it and that profile's accepted friends listen. The app sends only
-- what the profile's privacy settings allow (nothing at all while it's
-- hidden). Invites arrive on `invites:<profile id>`, sent by friend_invite()
-- with the inviting profile filled in by the server; nobody else can send
-- there. An invite carries a party code, never a stream link.
--
-- Caps (docs/supabase-storage.md §8): 100 rows a profile (friends, requests
-- and blocks), of which 50 friends and 20 requests sent and not yet answered.

create table public.friend_codes (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  created_at timestamptz not null default now()
);

-- `a` asked `b`. One row a pair, whichever way round.
create table public.friendships (
  a uuid not null references public.profiles(id) on delete cascade,
  b uuid not null references public.profiles(id) on delete cascade,
  state text not null check (state in ('pending', 'accepted', 'blocked')),
  blocked_by uuid references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (a, b),
  check (a <> b),
  check ((state = 'blocked') = (blocked_by is not null)),
  check (blocked_by is null or blocked_by in (a, b))
);
create unique index friendships_pair on public.friendships (least(a, b), greatest(a, b));
create index friendships_b_idx on public.friendships (b);

alter table public.friend_codes enable row level security;
alter table public.friendships enable row level security;

-- --- Helpers ----------------------------------------------------------------

-- The profile, if it is the caller's; raises otherwise.
create function public.friend_own(p uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = p and user_id = auth.uid()) then
    raise exception 'not_your_profile';
  end if;
  return p;
end $$;

-- Eight characters without 0/O and 1/I, from the server's random numbers.
create function public.friend_new_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea := uuid_send(gen_random_uuid());
  out text := '';
begin
  for i in 0..7 loop
    out := out || substr(alphabet, 1 + get_byte(bytes, i) % 32, 1);
  end loop;
  return out;
end $$;

-- The pair's row, either way round.
create function public.friend_pair(x uuid, y uuid) returns public.friendships
language sql stable security definer set search_path = '' as $$
  select * from public.friendships where (a = x and b = y) or (a = y and b = x)
$$;

-- Holds a profile within its caps once a row about it has been added or accepted.
create function public.friend_caps(p uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.friendships where a = p or b = p) > 100 then
    raise exception 'friend_limit' using hint = 'A profile can have up to 100 friends, requests and blocks.';
  end if;
  if (select count(*) from public.friendships where (a = p or b = p) and state = 'accepted') > 50 then
    raise exception 'friend_limit' using hint = 'A profile can have up to 50 friends.';
  end if;
  if (select count(*) from public.friendships where a = p and state = 'pending') > 20 then
    raise exception 'friend_requests_limit' using hint = 'A profile can have up to 20 requests waiting for an answer.';
  end if;
end $$;

-- --- Friend codes -----------------------------------------------------------

-- The profile's code, made the first time (turning Friends on).
create function public.friend_code(p uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c text;
begin
  perform public.friend_own(p);
  select code into c from public.friend_codes where profile_id = p;
  while c is null loop
    begin
      insert into public.friend_codes(profile_id, code) values (p, public.friend_new_code()) returning code into c;
    exception when unique_violation then
      -- The profile got one meanwhile, or the new code is taken: read again, or try another.
      select code into c from public.friend_codes where profile_id = p;
    end;
  end loop;
  return c;
end $$;

-- A new code: the old one stops working. Friends stay.
create function public.friend_code_reset(p uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  delete from public.friend_codes where profile_id = p;
  return public.friend_code(p);
end $$;

-- Friends turned off: nobody can send a request with the code any more. Friends stay.
create function public.friend_code_off(p uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  delete from public.friend_codes where profile_id = p;
end $$;

-- --- Requests and friends ---------------------------------------------------

-- Ask the profile with this code. 'sent', or 'accepted' when they had asked
-- first, or 'already' (friends already, or asked already). A profile that has
-- blocked the caller looks like any other: 'sent', and nothing happens.
create function public.friend_request(p uuid, friend_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  other uuid;
  pair public.friendships;
begin
  perform public.friend_own(p);
  select profile_id into other from public.friend_codes where code = upper(friend_code);
  if other is null then
    raise exception 'friend_code_unknown' using hint = 'No profile has that friend code.';
  end if;
  if other = p then
    raise exception 'friend_self' using hint = 'That is this profile''s own code.';
  end if;
  pair := public.friend_pair(p, other);
  if pair.a is not null then
    if pair.state = 'blocked' then
      return case when pair.blocked_by = p then 'blocked' else 'sent' end;
    elsif pair.state = 'accepted' or pair.a = p then
      return 'already';
    end if;
    update public.friendships set state = 'accepted', updated_at = now() where a = other and b = p;
    perform public.friend_caps(p);
    perform public.friend_caps(other);
    return 'accepted';
  end if;
  insert into public.friendships(a, b, state) values (p, other, 'pending');
  perform public.friend_caps(p);
  perform public.friend_caps(other);
  return 'sent';
end $$;

-- Accept or decline a request the profile received.
create function public.friend_respond(p uuid, other uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  if accept then
    update public.friendships set state = 'accepted', updated_at = now() where a = other and b = p and state = 'pending';
    perform public.friend_caps(p);
    perform public.friend_caps(other);
  else
    delete from public.friendships where a = other and b = p and state = 'pending';
  end if;
end $$;

-- No longer friends (or a request withdrawn). A block stays until its blocker lifts it.
create function public.friend_remove(p uuid, other uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  delete from public.friendships
    where ((a = p and b = other) or (a = other and b = p)) and state <> 'blocked';
end $$;

-- Block a friend or someone who sent a request: they no longer see this
-- profile, and their requests go nowhere.
create function public.friend_block(p uuid, other uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  update public.friendships set state = 'blocked', blocked_by = p, updated_at = now()
    where ((a = p and b = other) or (a = other and b = p)) and state <> 'blocked';
end $$;

create function public.friend_unblock(p uuid, other uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  delete from public.friendships
    where ((a = p and b = other) or (a = other and b = p)) and blocked_by = p;
end $$;

-- Friends, requests both ways and the profile's own blocks, with each other
-- profile's name and avatar. Blocks by others aren't listed.
create function public.friend_list(p uuid)
returns table (id uuid, name text, avatar text, state text, incoming boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  return query
    select o.id, o.name, o.avatar, f.state, f.b = p
    from public.friendships f
    join public.profiles o on o.id = case when f.a = p then f.b else f.a end
    where (f.a = p or f.b = p) and (f.state <> 'blocked' or f.blocked_by = p)
    order by f.state, o.name;
end $$;

-- Invite a friend into the profile's watch party: a broadcast on their invite
-- topic, saying who it is from.
create function public.friend_invite(p uuid, other uuid, party text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  if party !~ '^[A-Z0-9]{6}$' then
    raise exception 'bad_party_code';
  end if;
  if (public.friend_pair(p, other)).state is distinct from 'accepted' then
    raise exception 'not_friends';
  end if;
  perform realtime.send(jsonb_build_object('from', p, 'party', party), 'invite', 'invites:' || other::text, true);
end $$;

-- --- Realtime topics --------------------------------------------------------

-- Whether the caller may listen to (`track` false) or show presence on
-- (`track` true) a friends or invites topic.
create function public.friend_topic_allowed(topic text, track boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  kind text := split_part(topic, ':', 1);
  rest text := split_part(topic, ':', 2);
  p uuid;
  mine boolean;
begin
  if kind not in ('friends', 'invites') or rest !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  p := rest::uuid;
  mine := exists (select 1 from public.profiles where profiles.id = p and user_id = auth.uid());
  if kind = 'invites' then
    return mine and not track;
  end if;
  if track or mine then
    return mine;
  end if;
  return exists (
    select 1 from public.friendships f join public.profiles o on o.id = case when f.a = p then f.b else f.a end
    where (f.a = p or f.b = p) and f.state = 'accepted' and o.user_id = auth.uid()
  );
end $$;

create policy "friends: owners and friends listen"
  on realtime.messages for select to authenticated
  using (extension in ('broadcast', 'presence') and public.friend_topic_allowed(realtime.topic(), false));

create policy "friends: owners show presence"
  on realtime.messages for insert to authenticated
  with check (extension = 'presence' and public.friend_topic_allowed(realtime.topic(), true));

-- --- Grants -----------------------------------------------------------------

revoke all on function public.friend_own(uuid) from public, anon, authenticated;
revoke all on function public.friend_new_code() from public, anon, authenticated;
revoke all on function public.friend_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.friend_caps(uuid) from public, anon, authenticated;
revoke all on function public.friend_code(uuid) from public, anon;
revoke all on function public.friend_code_reset(uuid) from public, anon;
revoke all on function public.friend_code_off(uuid) from public, anon;
revoke all on function public.friend_request(uuid, text) from public, anon;
revoke all on function public.friend_respond(uuid, uuid, boolean) from public, anon;
revoke all on function public.friend_remove(uuid, uuid) from public, anon;
revoke all on function public.friend_block(uuid, uuid) from public, anon;
revoke all on function public.friend_unblock(uuid, uuid) from public, anon;
revoke all on function public.friend_list(uuid) from public, anon;
revoke all on function public.friend_invite(uuid, uuid, text) from public, anon;
revoke all on function public.friend_topic_allowed(text, boolean) from public, anon;
grant execute on function public.friend_code(uuid) to authenticated;
grant execute on function public.friend_code_reset(uuid) to authenticated;
grant execute on function public.friend_code_off(uuid) to authenticated;
grant execute on function public.friend_request(uuid, text) to authenticated;
grant execute on function public.friend_respond(uuid, uuid, boolean) to authenticated;
grant execute on function public.friend_remove(uuid, uuid) to authenticated;
grant execute on function public.friend_block(uuid, uuid) to authenticated;
grant execute on function public.friend_unblock(uuid, uuid) to authenticated;
grant execute on function public.friend_list(uuid) to authenticated;
grant execute on function public.friend_invite(uuid, uuid, text) to authenticated;
grant execute on function public.friend_topic_allowed(text, boolean) to authenticated;
