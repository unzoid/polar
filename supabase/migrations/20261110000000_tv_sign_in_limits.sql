-- TV sign-in limits (#133), tightened:
--
-- - Answering a code counts towards the user's ten tries in ten minutes like
--   looking one up, when there's no such request; an answer to a request
--   that's there always goes through.
-- - Full (10,000 live requests): the oldest unanswered ones make way for new
--   ones instead of every new request being turned away until they expire.
--   Approved requests waiting for their TV stay.
-- - Requests are started one at a time, so parallel ones can't get past the
--   per-address and overall counts.
-- - Tries older than ten minutes are deleted whoever made them.

create index tv_sign_in_tries_at on public.tv_sign_in_tries (at);

create or replace function public.tv_sign_in_start(p_code_hash text, p_poll_hash text, p_device text, p_ip_hash text)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare
  expires timestamptz;
  live int;
begin
  perform pg_advisory_xact_lock(hashtext('tv_sign_in_start'));
  delete from public.tv_sign_in where expires_at <= now();
  if (select count(*) from public.tv_sign_in where ip_hash = p_ip_hash) >= 5 then
    raise exception 'rate_limited';
  end if;
  live := (select count(*) from public.tv_sign_in);
  if live >= 10000 then
    delete from public.tv_sign_in where id in (
      select id from public.tv_sign_in where answer is null order by id limit live - 9999);
    if not found then
      raise exception 'rate_limited';
    end if;
  end if;
  insert into public.tv_sign_in (code_hash, poll_hash, device, ip_hash)
    values (p_code_hash, p_poll_hash, p_device, p_ip_hash)
    returning expires_at into expires;
  return expires;
end $$;

-- Counts a try for the user, raising 'rate_limited' past ten in ten minutes.
create function public.tv_sign_in_try(p_user uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.tv_sign_in_tries where at <= now() - interval '10 minutes';
  if (select count(*) from public.tv_sign_in_tries where user_id = p_user) >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into public.tv_sign_in_tries (user_id) values (p_user);
end $$;

create or replace function public.tv_sign_in_look(p_user uuid, p_code_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  perform public.tv_sign_in_try(p_user);
  return (select device from public.tv_sign_in
    where code_hash = p_code_hash and expires_at > now() and answer is null);
end $$;

create or replace function public.tv_sign_in_answer(p_user uuid, p_code_hash text, p_approve boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.tv_sign_in
    set answer = case when p_approve then 'approved' else 'denied' end,
        user_id = case when p_approve then p_user end
    where code_hash = p_code_hash and expires_at > now() and answer is null;
  if found then
    return true;
  end if;
  perform public.tv_sign_in_try(p_user);
  return false;
end $$;

revoke all on function public.tv_sign_in_try(uuid) from public, anon, authenticated;
grant execute on function public.tv_sign_in_try(uuid) to service_role;
