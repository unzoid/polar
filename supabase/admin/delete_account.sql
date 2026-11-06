-- Deletes one account's data (#110), for cleaning up: run in the dashboard's
-- SQL editor after putting the account's id (from account_usage.sql) below.
-- With keep_sign_in false the account goes as a whole, as when its owner
-- deletes it in the app; true deletes its profiles and every row under them
-- but leaves the sign-in, so the person can sign in again to an empty account.
-- It can't be undone.

do $$
declare
  target uuid := '00000000-0000-0000-0000-000000000000';
  keep_sign_in boolean := false;
  n int;
begin
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'No account has the id %.', target;
  end if;
  select count(*) into n from public.profiles where user_id = target;
  -- Profiles take their library, progress, anime links, playlists and settings with them.
  if keep_sign_in then
    delete from public.profiles where user_id = target;
  else
    delete from auth.users where id = target;
  end if;
  raise notice 'Deleted % profile(s)% of account %.', n, case when keep_sign_in then '' else ' and the sign-in' end, target;
end $$;
