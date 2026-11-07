-- Friends and account caps, tightened (#197):
--   * friend codes: an account can try up to 20 codes nobody has in an hour.
--     friend_request answers 'unknown' for such a code instead of raising, so
--     the try is kept (a raise would take it back with the rest).
--   * invites: an account sends up to 30 in 10 minutes.
--   * friend_respond no longer tells the other profile its list changed when
--     there was no request to answer.
--   * the profile, row and friend caps take a lock per account (or per pair of
--     profiles) first, so inserts arriving at the same moment are counted one
--     after the other rather than each seeing room for itself.
--   * new friend codes use only the random bytes of the uuid they come from
--     (one character used to have 16 possible values, not 32).
--   * the progress codec's functions need a signed-in caller.
--
-- Realtime checks the friends topics' policies when someone joins and when
-- their sign-in is renewed: a friend who is removed or blocked can go on
-- seeing presence they already listen to until then (about an hour at most).

-- --- Tries ------------------------------------------------------------------

-- Friend codes tried that nobody has, and invites sent, per account; each
-- account's rows older than an hour go when it tries again.
create table public.friend_tries (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('code', 'invite')),
  at timestamptz not null default now()
);
create index friend_tries_idx on public.friend_tries (user_id, kind, at);
alter table public.friend_tries enable row level security;
revoke all on public.friend_tries from anon, authenticated;

-- The caller's tries of `kind` within `win`, its own tries locked until the
-- end of the transaction (so two at once are counted one after the other).
create function public.friend_tries_within(kind text, win interval) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  n bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('friend_tries:' || auth.uid()::text, 0));
  delete from public.friend_tries t where t.user_id = auth.uid() and t.at < now() - interval '1 hour';
  select count(*) into n from public.friend_tries t
    where t.user_id = auth.uid() and t.kind = friend_tries_within.kind and t.at > now() - win;
  return n;
end $$;

-- Both profiles of a pair locked until the end of the transaction, always in
-- the same order, so requests and answers between them go one at a time.
create function public.friend_lock_pair(x uuid, y uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('friends:' || least(x, y)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('friends:' || greatest(x, y)::text, 0));
end $$;

-- --- Codes ------------------------------------------------------------------

-- Eight characters without 0/O and 1/I. Bytes 6 and 8 of a uuid hold its
-- version and variant; the ones used here are all random.
create or replace function public.friend_new_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea := uuid_send(gen_random_uuid());
  out text := '';
begin
  for i in 0..7 loop
    out := out || substr(alphabet, 1 + get_byte(bytes, case when i < 6 then i else i + 3 end) % 32, 1);
  end loop;
  return out;
end $$;

-- --- Requests ---------------------------------------------------------------

-- Ask the profile with this code. 'sent', or 'accepted' when they had asked
-- first, or 'already' (friends already, or asked already), or 'unknown' when
-- no profile has the code. A profile that has blocked the caller looks like
-- any other: 'sent', and nothing happens.
create or replace function public.friend_request(p uuid, friend_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  other uuid;
  pair public.friendships;
begin
  perform public.friend_own(p);
  if public.friend_tries_within('code', interval '1 hour') >= 20 then
    raise exception 'friend_tries_limit' using hint = 'Up to 20 friend codes nobody has can be tried in an hour.';
  end if;
  select profile_id into other from public.friend_settings where code = upper(friend_code);
  if other is null then
    insert into public.friend_tries(user_id, kind) values (auth.uid(), 'code');
    return 'unknown';
  end if;
  if other = p then
    raise exception 'friend_self' using hint = 'That is this profile''s own code.';
  end if;
  perform public.friend_lock_pair(p, other);
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
    perform public.friend_changed(other);
    return 'accepted';
  end if;
  insert into public.friendships(a, b, state) values (p, other, 'pending');
  perform public.friend_caps(p);
  perform public.friend_caps(other);
  perform public.friend_changed(other);
  return 'sent';
end $$;

-- Accept or decline a request the profile received. The other profile hears
-- of it only when there was one.
create or replace function public.friend_respond(p uuid, other uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform public.friend_own(p);
  perform public.friend_lock_pair(p, other);
  if accept then
    update public.friendships set state = 'accepted', updated_at = now() where a = other and b = p and state = 'pending';
    get diagnostics n = row_count;
    if n > 0 then
      perform public.friend_caps(p);
      perform public.friend_caps(other);
    end if;
  else
    delete from public.friendships where a = other and b = p and state = 'pending';
    get diagnostics n = row_count;
  end if;
  if n > 0 then
    perform public.friend_changed(other);
  end if;
end $$;

-- Invite a friend into the profile's watch party: a broadcast on their invite
-- topic, saying who it is from. Up to 30 in 10 minutes an account.
create or replace function public.friend_invite(p uuid, other uuid, party text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  if party !~ '^[A-Z0-9]{6}$' then
    raise exception 'bad_party_code';
  end if;
  if (public.friend_pair(p, other)).state is distinct from 'accepted' then
    raise exception 'not_friends';
  end if;
  if public.friend_tries_within('invite', interval '10 minutes') >= 30 then
    raise exception 'friend_invite_limit' using hint = 'Up to 30 invites can be sent in 10 minutes.';
  end if;
  insert into public.friend_tries(user_id, kind) values (auth.uid(), 'invite');
  perform realtime.send(jsonb_build_object('from', p, 'party', party), 'invite', 'invites:' || other::text, true);
end $$;

-- --- Caps under a lock ------------------------------------------------------

create or replace function public.enforce_profile_limit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('profiles:' || new.user_id::text, 0));
  if (select count(*) from public.profiles where user_id = new.user_id) >= 5 then
    raise exception 'profile_limit' using hint = 'An account can have up to 5 profiles.';
  end if;
  return new;
end $$;

-- As in 20261107000000_account_limits.sql, with a lock per account and table
-- before counting.
create or replace function public.enforce_row_caps() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  per_profile int := tg_argv[0]::int;
  per_account int := tg_argv[1]::int;
  code text := tg_argv[2];
  p record;
  n bigint;
begin
  for p in select distinct t.profile_id, pr.user_id
    from added t join public.profiles pr on pr.id = t.profile_id
    order by pr.user_id, t.profile_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || p.user_id::text, 0));
    execute format('select count(*) from public.%I where profile_id = $1', tg_table_name) into n using p.profile_id;
    if n > per_profile then
      if tg_table_name = 'library' then
        delete from public.library
          where profile_id = p.profile_id and kind >= 128 and synced_at < now() - interval '90 days';
      elsif tg_table_name = 'playlists' then
        delete from public.playlists
          where profile_id = p.profile_id and deleted and synced_at < now() - interval '90 days';
      end if;
      execute format('select count(*) from public.%I where profile_id = $1', tg_table_name) into n using p.profile_id;
    end if;
    if n > per_profile then
      raise exception '%', code
        using hint = format('A profile can keep up to %s rows in %s.', per_profile, tg_table_name);
    end if;
    if per_account > 0 then
      execute format('select count(*) from public.%I t join public.profiles pr on pr.id = t.profile_id where pr.user_id = $1',
        tg_table_name) into n using p.user_id;
      if n > per_account then
        raise exception '%', code
          using hint = format('An account can keep up to %s rows in %s.', per_account, tg_table_name);
      end if;
    end if;
  end loop;
  return null;
end $$;

-- --- Grants -----------------------------------------------------------------

revoke all on function public.friend_tries_within(text, interval) from public, anon, authenticated;
revoke all on function public.friend_lock_pair(uuid, uuid) from public, anon, authenticated;
-- The progress triggers run as the signed-in caller and call these.
revoke all on function public.polar_varint(bytea, int) from public, anon;
revoke all on function public.polar_varint_bytes(bigint) from public, anon;
revoke all on function public.polar_entries(text, bytea, bigint) from public, anon;
revoke all on function public.polar_time_cap() from public, anon;
grant execute on function public.polar_varint(bytea, int) to authenticated;
grant execute on function public.polar_varint_bytes(bigint) to authenticated;
grant execute on function public.polar_entries(text, bytea, bigint) to authenticated;
grant execute on function public.polar_time_cap() to authenticated;
