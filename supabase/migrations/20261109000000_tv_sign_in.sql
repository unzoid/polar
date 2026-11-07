-- Signing in on a TV from a signed-in phone or computer (#133). The TV asks
-- the tv-sign-in Edge Function (supabase/functions/tv-sign-in) for a short
-- code and shows it; the user types it on a device that's already signed in
-- and approves; the TV, asking every few seconds with a secret only it has,
-- then gets a one-time sign-in token for that account and exchanges it for a
-- session of its own. The phone's session never leaves the phone.
--
-- Only the Edge Function (the service role) reads or writes these tables:
-- row-level security is on with no policies, and the functions below can be
-- run by the service role alone. Codes and secrets are stored as SHA-256
-- hashes, the address a request came from as a keyed hash. A request lasts
-- five minutes and works once: it's deleted when the TV collects the answer,
-- and expired ones are deleted by the next request. Nothing here is kept with
-- the account's data.
--
-- Limits: five live requests from one address, 10,000 live in all; a
-- signed-in user can look up ten codes in ten minutes.

create table public.tv_sign_in (
  id bigint generated always as identity primary key,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  poll_hash text not null unique check (poll_hash ~ '^[0-9a-f]{64}$'),
  -- What the TV calls itself, shown when the user is asked to approve.
  device text not null check (char_length(device) between 1 and 40 and device !~ '[[:cntrl:]]'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  answer text check (answer in ('approved', 'denied')),
  user_id uuid references auth.users (id) on delete cascade,
  check ((answer = 'approved') = (user_id is not null))
);
create index tv_sign_in_ip on public.tv_sign_in (ip_hash);
create index tv_sign_in_expires on public.tv_sign_in (expires_at);

-- Code lookups by signed-in users, for their limit; older than ten minutes are deleted.
create table public.tv_sign_in_tries (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index tv_sign_in_tries_user on public.tv_sign_in_tries (user_id, at);

alter table public.tv_sign_in enable row level security;
alter table public.tv_sign_in_tries enable row level security;
revoke all on public.tv_sign_in, public.tv_sign_in_tries from anon, authenticated;

-- A new request; returns when it expires. Raises 'rate_limited'.
create function public.tv_sign_in_start(p_code_hash text, p_poll_hash text, p_device text, p_ip_hash text)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare
  expires timestamptz;
begin
  delete from public.tv_sign_in where expires_at <= now();
  if (select count(*) from public.tv_sign_in where ip_hash = p_ip_hash) >= 5
    or (select count(*) from public.tv_sign_in) >= 10000 then
    raise exception 'rate_limited';
  end if;
  insert into public.tv_sign_in (code_hash, poll_hash, device, ip_hash)
    values (p_code_hash, p_poll_hash, p_device, p_ip_hash)
    returning expires_at into expires;
  return expires;
end $$;

-- The device name of a live, unanswered request, for the user to approve;
-- null when there's none. Counts towards the user's limit (raises 'rate_limited').
create function public.tv_sign_in_look(p_user uuid, p_code_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.tv_sign_in_tries where user_id = p_user and at <= now() - interval '10 minutes';
  if (select count(*) from public.tv_sign_in_tries where user_id = p_user) >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into public.tv_sign_in_tries (user_id) values (p_user);
  return (select device from public.tv_sign_in
    where code_hash = p_code_hash and expires_at > now() and answer is null);
end $$;

-- Approve (for `p_user`'s account) or deny a live, unanswered request; false when there's none.
create function public.tv_sign_in_answer(p_user uuid, p_code_hash text, p_approve boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.tv_sign_in
    set answer = case when p_approve then 'approved' else 'denied' end,
        user_id = case when p_approve then p_user end
    where code_hash = p_code_hash and expires_at > now() and answer is null;
  return found;
end $$;

-- What the TV gets when it asks: 'pending', 'expired', 'denied', or
-- 'approved' with the account. An answer is handed out once: the request is
-- deleted with it.
create function public.tv_sign_in_claim(p_poll_hash text)
returns table (state text, user_id uuid) language plpgsql security invoker set search_path = '' as $$
declare
  r public.tv_sign_in;
begin
  select * into r from public.tv_sign_in t where t.poll_hash = p_poll_hash for update;
  if not found or r.expires_at <= now() then
    delete from public.tv_sign_in t where t.poll_hash = p_poll_hash;
    return query select 'expired'::text, null::uuid;
  elsif r.answer is null then
    return query select 'pending'::text, null::uuid;
  else
    delete from public.tv_sign_in t where t.id = r.id;
    return query select r.answer, r.user_id;
  end if;
end $$;

revoke all on function public.tv_sign_in_start(text, text, text, text) from public, anon, authenticated;
revoke all on function public.tv_sign_in_look(uuid, text) from public, anon, authenticated;
revoke all on function public.tv_sign_in_answer(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.tv_sign_in_claim(text) from public, anon, authenticated;
grant all on public.tv_sign_in, public.tv_sign_in_tries to service_role;
grant execute on function public.tv_sign_in_start(text, text, text, text) to service_role;
grant execute on function public.tv_sign_in_look(uuid, text) to service_role;
grant execute on function public.tv_sign_in_answer(uuid, text, boolean) to service_role;
grant execute on function public.tv_sign_in_claim(text) to service_role;
