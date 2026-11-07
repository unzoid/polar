// The friends migration (supabase/migrations/20261108000000_friends.sql, #135) in PGlite: friend
// codes, requests, accepting, removing, blocking, the caps, invites and who may listen to or show
// presence on the friends and invites topics. The tests share one database and run in order.
import { beforeAll, describe, expect, test } from "bun:test";
import { as, migrations, sqlFile, supabaseDb, type Db } from "./supabaseStub";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const PA = "00000000-0000-0000-0000-0000000000a1";
const PB = "00000000-0000-0000-0000-0000000000b1";
const PC = "00000000-0000-0000-0000-0000000000c1";

let db: Db;
/** What the statement was refused with ('' when it went through). */
const refusal = async (sql: string) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};
const one = async <T,>(sql: string) => (await db.query<{ v: T }>(`select ${sql} as v`)).rows[0].v;
const code = (p: string) => one<string>(`friend_on('${p}')`);
const request = (p: string, c: string) => one<string>(`friend_request('${p}', '${c}')`);
const list = async (p: string) =>
  (await db.query<{ id: string; name: string; state: string; incoming: boolean }>(`select id, name, state, incoming from friend_list('${p}')`)).rows;
/** As `user`, whether the topic may be listened to or shown presence on. */
const allowed = async (user: string, topic: string, track: boolean) => {
  await as(db, user);
  await db.exec(`select set_config('realtime.topic', '${topic}', false)`);
  return one<boolean>(`friend_topic_allowed(realtime.topic(), ${track})`);
};

beforeAll(async () => {
  db = await supabaseDb();
  for (const f of migrations()) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into auth.users(id) values ('${A}'), ('${B}'), ('${C}');
insert into profiles(id, user_id, name, avatar) values ('${PA}','${A}','Ada','blue'),
  ('${PB}','${B}','Bo','green'), ('${PC}','${C}','Cy','red');
grant all on all tables in schema public to authenticated;`);
}, 30_000);

describe("turning Friends on and off", () => {
  test("off until turned on; then a code, made once, eight characters without look-alikes", async () => {
    await as(db, A);
    expect((await db.query(`select * from friend_settings('${PA}')`)).rows).toEqual([]);
    const c = await code(PA);
    expect(c).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(await code(PA)).toBe(c);
    expect((await db.query(`select * from friend_settings('${PA}')`)).rows).toEqual([{ code: c, show_online: true, show_watching: true, joinable: true }]);
  });

  test("what friends see is kept per profile, and only while Friends is on", async () => {
    await as(db, A);
    await db.exec(`select friend_privacy('${PA}', true, false, true)`);
    expect((await db.query<{ show_watching: boolean }>(`select show_watching from friend_settings('${PA}')`)).rows[0].show_watching).toBe(false);
    await db.exec(`select friend_privacy('${PA}', true, true, true)`);
    await as(db, B);
    expect(await refusal(`select friend_privacy('${PB}', true, true, true)`)).toBe("friends_off");
    expect(await refusal(`select friend_code_reset('${PB}')`)).toBe("friends_off");
    expect(await refusal(`select friend_privacy('${PA}', false, false, false)`)).toBe("not_your_profile");
  });

  test("only the profile's own account reads or changes its code", async () => {
    await as(db, B);
    expect(await refusal(`select friend_on('${PA}')`)).toBe("not_your_profile");
    expect(await refusal(`select friend_code_reset('${PA}')`)).toBe("not_your_profile");
    expect(await refusal(`select * from friend_settings('${PA}')`)).toBe("not_your_profile");
    expect(await refusal(`select * from friend_settings`)).toBe("");
    expect((await db.query(`select * from friend_settings`)).rows).toHaveLength(0);
    await as(db, null);
    await db.exec(`reset role`);
    expect(await refusal(`set role anon; select friend_on('${PA}')`)).toContain("permission denied");
    await db.exec(`reset role`);
  });

  test("a new code replaces the old one; turning Friends off removes it and the settings", async () => {
    await as(db, A);
    const old = await code(PA);
    const fresh = await one<string>(`friend_code_reset('${PA}')`);
    expect(fresh).not.toBe(old);
    await as(db, B);
    expect(await refusal(`select friend_request('${PB}', '${old}')`)).toBe("friend_code_unknown");
    await as(db, A);
    await db.exec(`select friend_off('${PA}')`);
    expect((await db.query(`select * from friend_settings('${PA}')`)).rows).toEqual([]);
    await as(db, B);
    expect(await refusal(`select friend_request('${PB}', '${fresh}')`)).toBe("friend_code_unknown");
  });
});

describe("requests", () => {
  test("a request waits for an answer; both sides see it, with the other's name", async () => {
    await as(db, A);
    const c = await code(PA);
    await as(db, B);
    expect(await request(PB, c)).toBe("sent");
    expect(await request(PB, c.toLowerCase())).toBe("already");
    expect(await list(PB)).toEqual([{ id: PA, name: "Ada", state: "pending", incoming: false }]);
    await as(db, A);
    expect(await list(PA)).toEqual([{ id: PB, name: "Bo", state: "pending", incoming: true }]);
    // Not the other account's profile, and not its own code.
    expect(await refusal(`select friend_request('${PB}', '${c}')`)).toBe("not_your_profile");
    expect(await refusal(`select friend_request('${PA}', '${c}')`)).toBe("friend_self");
  });

  test("only the one asked accepts; then both are friends", async () => {
    await as(db, B);
    await db.exec(`select friend_respond('${PB}', '${PA}', true)`);
    expect((await list(PB))[0].state).toBe("pending");
    await as(db, A);
    await db.exec(`select friend_respond('${PA}', '${PB}', true)`);
    expect(await list(PA)).toEqual([{ id: PB, name: "Bo", state: "accepted", incoming: true }]);
    await as(db, B);
    expect((await list(PB))[0].state).toBe("accepted");
  });

  test("asking someone who asked first makes friends at once; declining removes the request", async () => {
    await as(db, C);
    const c = await code(PC);
    await as(db, A);
    const a = await code(PA);
    expect(await request(PA, c)).toBe("sent");
    await as(db, C);
    expect(await request(PC, a)).toBe("accepted");
    await db.exec(`select friend_remove('${PC}', '${PA}')`);
    expect(await list(PC)).toEqual([]);
    await as(db, A);
    expect(await request(PA, c)).toBe("sent");
    await as(db, C);
    await db.exec(`select friend_respond('${PC}', '${PA}', false)`);
    expect(await list(PC)).toEqual([]);
  });

  test("blocking hides you from them; their requests go nowhere until you unblock", async () => {
    await as(db, A);
    const a = await code(PA);
    await db.exec(`select friend_block('${PA}', '${PB}')`);
    expect(await list(PA)).toEqual([{ id: PB, name: "Bo", state: "blocked", incoming: true }]);
    await as(db, B);
    expect(await list(PB)).toEqual([]);
    expect(await request(PB, a)).toBe("sent");
    expect(await list(PB)).toEqual([]);
    // Removing doesn't lift a block, and only its blocker can.
    await db.exec(`select friend_remove('${PB}', '${PA}'); select friend_unblock('${PB}', '${PA}')`);
    await as(db, A);
    expect((await list(PA))[0].state).toBe("blocked");
    await db.exec(`select friend_unblock('${PA}', '${PB}')`);
    expect(await list(PA)).toEqual([]);
  });
});

describe("caps", () => {
  test("20 requests waiting, 50 friends, 100 rows a profile", async () => {
    await as(db, null);
    // Profiles to ask: 120 accounts with one profile each, each with a code.
    await db.exec(`insert into auth.users(id) select ('10000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 120) i;
insert into profiles(id, user_id, name) select ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  ('10000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'P' || i from generate_series(1, 120) i;
insert into friend_settings(profile_id, code) select ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  'ZZZZ' || translate(lpad(i::text, 4, '0'), '01', 'AB') from generate_series(1, 120) i;`);
    const p = (i: number) => `20000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
    const c = (i: number) => `ZZZZ${String(i).padStart(4, "0").replace(/0/g, "A").replace(/1/g, "B")}`;
    await as(db, B);
    for (let i = 1; i <= 20; i++) expect(await request(PB, c(i))).toBe("sent");
    expect(await refusal(`select friend_request('${PB}', '${c(21)}')`)).toBe("friend_requests_limit");
    // Accepted ones make room for more requests, up to 50 friends.
    const accept = (where = "") => as(db, null).then(() => db.exec(`update friendships set state = 'accepted' where a = '${PB}' ${where}`));
    await accept();
    await as(db, B);
    for (let i = 21; i <= 40; i++) expect(await request(PB, c(i))).toBe("sent");
    await accept();
    await as(db, B);
    for (let i = 41; i <= 50; i++) expect(await request(PB, c(i))).toBe("sent");
    await accept(`and b <> '${p(50)}'`);
    // The 50th friend still fits.
    await as(db, `10000000-0000-0000-0000-${String(50).padStart(12, "0")}`);
    await db.exec(`select friend_respond('${p(50)}', '${PB}', true)`);
    await as(db, null);
    expect(Number(await one<string>(`(select count(*) from friendships where (a = '${PB}' or b = '${PB}') and state = 'accepted')::text`))).toBe(50);
    await as(db, B);
    expect(await request(PB, c(51))).toBe("sent");
    await as(db, `10000000-0000-0000-0000-${String(51).padStart(12, "0")}`);
    expect(await refusal(`select friend_respond('${p(51)}', '${PB}', true)`)).toBe("friend_limit");
  }, 60_000);
});

describe("invites and topics", () => {
  test("a friend invites into a party; the server says who from, on the friend's invite topic", async () => {
    await as(db, C);
    const c = await code(PC);
    await as(db, A);
    expect(await request(PA, c)).toBe("sent");
    expect(await refusal(`select friend_invite('${PA}', '${PC}', 'ABC123')`)).toBe("not_friends");
    await as(db, C);
    await db.exec(`select friend_respond('${PC}', '${PA}', true)`);
    await as(db, A);
    expect(await refusal(`select friend_invite('${PA}', '${PC}', 'https://media.example.com/film.mkv')`)).toBe("bad_party_code");
    expect(await refusal(`select friend_invite('${PA}', '${PC}', 'ABC123')`)).toBe("");
    await as(db, null);
    const sent = (await db.query<{ payload: unknown; event: string; topic: string; private: boolean }>(`select * from realtime.sent where event = 'invite'`)).rows;
    expect(sent).toEqual([{ payload: { from: PA, party: "ABC123" }, event: "invite", topic: `invites:${PC}`, private: true }]);
  });

  test("requests, answers and removals tell the other side to read its list again; blocks don't", async () => {
    await as(db, null);
    const changed = (await db.query<{ topic: string; payload: unknown }>(`select topic, payload from realtime.sent where event = 'changed'`)).rows;
    expect(changed.length).toBeGreaterThan(5);
    expect(changed.every((c) => /^invites:[0-9a-f-]{36}$/.test(c.topic) && JSON.stringify(c.payload) === "{}")).toBe(true);
    await db.exec(`delete from realtime.sent`);
    await as(db, A);
    await db.exec(`select friend_block('${PA}', '${PC}'); select friend_unblock('${PA}', '${PC}')`);
    await as(db, null);
    expect((await db.query(`select * from realtime.sent`)).rows).toHaveLength(0);
    // Friends again for the tests below.
    await as(db, C);
    const c = await code(PC);
    await as(db, A);
    expect(await request(PA, c)).toBe("sent");
    await as(db, C);
    await db.exec(`select friend_respond('${PC}', '${PA}', true)`);
    await as(db, null);
    expect((await db.query<{ topic: string }>(`select topic from realtime.sent`)).rows.map((r) => r.topic)).toEqual([`invites:${PC}`, `invites:${PA}`]);
  });

  test("a profile's friends topic: its account shows presence, it and its friends listen, nobody else", async () => {
    const topic = `friends:${PA}`;
    expect(await allowed(A, topic, true)).toBe(true);
    expect(await allowed(A, topic, false)).toBe(true);
    expect(await allowed(C, topic, false)).toBe(true);
    expect(await allowed(C, topic, true)).toBe(false);
    expect(await allowed(B, topic, false)).toBe(false);
    expect(await allowed(B, `friends:${PB}`, true)).toBe(true);
  });

  test("a profile shown to nobody as online: friends can't listen to its topic", async () => {
    await as(db, A);
    await db.exec(`select friend_privacy('${PA}', false, true, true)`);
    expect(await allowed(C, `friends:${PA}`, false)).toBe(false);
    expect(await allowed(A, `friends:${PA}`, true)).toBe(true);
    await db.exec(`select friend_privacy('${PA}', true, true, true)`);
    expect(await allowed(C, `friends:${PA}`, false)).toBe(true);
    // Friends off: nobody but its own account either.
    await as(db, C);
    await db.exec(`select friend_off('${PC}')`);
    expect(await allowed(A, `friends:${PC}`, false)).toBe(false);
    await as(db, C);
    await code(PC);
  });

  test("an invite topic: only its own account listens; nobody sends there but the server", async () => {
    expect(await allowed(C, `invites:${PC}`, false)).toBe(true);
    expect(await allowed(C, `invites:${PC}`, true)).toBe(false);
    expect(await allowed(A, `invites:${PC}`, false)).toBe(false);
  });

  test("other topics and malformed ones aren't these policies'", async () => {
    expect(await allowed(A, "party:ABC123", false)).toBe(false);
    expect(await allowed(A, `friends:${PA}x`, false)).toBe(false);
    expect(await allowed(A, "friends:", true)).toBe(false);
    expect(await allowed(A, `friends:${PA.toUpperCase()}`, true)).toBe(false);
  });

  test("blocked, removed or still asking: no longer listening", async () => {
    await as(db, A);
    await db.exec(`select friend_block('${PA}', '${PC}')`);
    expect(await allowed(C, `friends:${PA}`, false)).toBe(false);
    expect(await allowed(A, `friends:${PC}`, false)).toBe(false);
    await as(db, A);
    await db.exec(`select friend_unblock('${PA}', '${PC}')`);
    expect(await allowed(C, `friends:${PA}`, false)).toBe(false);
  });

  test("a deleted profile takes its code and friendships with it", async () => {
    await as(db, null);
    await db.exec(`delete from profiles where id = '${PC}'`);
    expect(Number(await one<string>(`(select count(*) from friendships where a = '${PC}' or b = '${PC}')::text`))).toBe(0);
    expect(Number(await one<string>(`(select count(*) from friend_settings where profile_id = '${PC}')::text`))).toBe(0);
  });
});
