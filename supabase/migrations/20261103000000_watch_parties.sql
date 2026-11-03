-- Watch parties: Realtime Broadcast + Presence on private `party:<code>`
-- channels. Nothing is stored; these policies only decide who may join a
-- room. Any signed-in user who knows a code can join it (the code is the
-- invitation); anonymous clients can't.

create policy "party rooms: signed-in users listen"
  on realtime.messages for select to authenticated
  using (realtime.topic() like 'party:%' and extension in ('broadcast', 'presence'));

create policy "party rooms: signed-in users talk"
  on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'party:%' and extension in ('broadcast', 'presence'));
