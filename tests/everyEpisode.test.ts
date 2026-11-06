import { expect, test } from "bun:test";
import { serverKeepsEveryEpisode } from "../src/lib/account/supabase";

/** A server stub answering `polar_every_episode()` with whatever `reply` holds, counting the questions. */
function server(reply: { data?: unknown; error?: { code: string; message: string } }) {
  const s = { reply, asked: 0, ask: async () => (s.asked++, { data: s.reply.data ?? null, error: s.reply.error ?? null }) };
  return s;
}
const missing = { code: "PGRST202", message: "Could not find the function public.polar_every_episode" };

test("every episode is sent only while the server says it keeps them", async () => {
  let now = 0;
  const s = server({ error: missing });
  const keeps = serverKeepsEveryEpisode(s.ask, () => now);
  expect(await keeps()).toBe(false);
  // The database is upgraded: the next question after the wait finds it, with no setting.
  s.reply = { data: true };
  expect(await keeps()).toBe(false);
  expect(s.asked).toBe(1);
  now += 10 * 60_000;
  expect(await keeps()).toBe(true);
  // per_episode_progress_off.sql drops the function: back to each title's newest.
  s.reply = { error: missing };
  now += 10 * 60_000;
  expect(await keeps()).toBe(false);
  expect(s.asked).toBe(3);
});

test("an error that isn't a missing function keeps the last answer and asks again next time", async () => {
  let now = 0;
  const s = server({ data: true });
  const keeps = serverKeepsEveryEpisode(s.ask, () => now);
  expect(await keeps()).toBe(true);
  now += 10 * 60_000;
  s.reply = { error: { code: "", message: "fetch failed" } };
  expect(await keeps()).toBe(true);
  s.reply = { data: false };
  expect(await keeps()).toBe(false);
  expect(s.asked).toBe(3);
});
