// supabase/migrations/20261109120000_friend_tries_and_cap_locks.sql in PGlite: how many friend codes
// nobody has an account may try, how many invites it may send, answers that tell the other side only
// when there was something to answer, friend codes from random bytes only, the locks the caps take
// and the codec functions closed to callers who aren't signed in. The tests share one database.
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
const count = async (sql: string) => Number(await one<string>(`(${sql})::text`));
/** Codes nobody has: valid letters, never handed out (friend_new_code makes no Is or Os). */
const unknown = (i: number) => `XXXX${String(i).padStart(4, "0").replace(/[01]/g, (d) => (d === "0" ? "A" : "B"))}`;

beforeAll(async () => {
  db = await supabaseDb();
  for (const f of migrations()) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into auth.users(id) values ('${A}'), ('${B}'), ('${C}');
insert into profiles(id, user_id, name, avatar) values ('${PA}','${A}','Ada','blue'),
  ('${PB}','${B}','Bo','green'), ('${PC}','${C}','Cy','red');`);
}, 30_000);

describe("friend codes nobody has", () => {
  test("answered 'unknown', and 20 an hour an account; then even a real code waits", async () => {
    await as(db, A);
    const a = await code(PA);
    await as(db, B);
    for (let i = 0; i < 20; i++) expect(await request(PB, unknown(i))).toBe("unknown");
    expect(await refusal(`select friend_request('${PB}', '${unknown(20)}')`)).toBe("friend_tries_limit");
    expect(await refusal(`select friend_request('${PB}', '${a}')`)).toBe("friend_tries_limit");
    // Another account has its own tries.
    await as(db, C);
    expect(await request(PC, unknown(0))).toBe("unknown");
    // An hour on, B may try again.
    await as(db, null);
    await db.exec(`update friend_tries set at = at - interval '61 minutes' where user_id = '${B}'`);
    await as(db, B);
    expect(await request(PB, a)).toBe("sent");
    await as(db, null);
    expect(await count(`select count(*) from friend_tries where user_id = '${B}'`)).toBe(0);
  });

  test("codes that work aren't counted", async () => {
    await as(db, B);
    const b = await code(PB);
    await as(db, C);
    for (let i = 0; i < 25; i++) expect(await request(PC, b)).toBe(i === 0 ? "sent" : "already");
    await as(db, null);
    expect(await count(`select count(*) from friend_tries where user_id = '${C}'`)).toBe(1);
  });

  test("nobody reads or writes the tries directly", async () => {
    await as(db, B);
    expect(await refusal(`select * from friend_tries`)).toContain("permission denied");
    expect(await refusal(`delete from friend_tries`)).toContain("permission denied");
    expect(await refusal(`select friend_tries_within('code', interval '1 hour')`)).toContain("permission denied");
    await as(db, null);
  });
});

describe("answers and invites", () => {
  test("answering a request nobody sent tells nobody", async () => {
    await as(db, null);
    await db.exec(`delete from realtime.sent`);
    await as(db, C);
    await db.exec(`select friend_respond('${PC}', '${PA}', true); select friend_respond('${PC}', '${PA}', false)`);
    await as(db, null);
    expect((await db.query(`select * from realtime.sent`)).rows).toHaveLength(0);
    // A real answer still does.
    await as(db, A);
    await db.exec(`select friend_respond('${PA}', '${PB}', true)`);
    await as(db, null);
    expect((await db.query<{ topic: string }>(`select topic from realtime.sent where event = 'changed'`)).rows).toEqual([{ topic: `invites:${PB}` }]);
  });

  test("30 invites in 10 minutes an account", async () => {
    await as(db, A);
    for (let i = 0; i < 30; i++) expect(await refusal(`select friend_invite('${PA}', '${PB}', 'ABC123')`)).toBe("");
    expect(await refusal(`select friend_invite('${PA}', '${PB}', 'ABC123')`)).toBe("friend_invite_limit");
    await as(db, null);
    expect(await count(`select count(*) from realtime.sent where event = 'invite'`)).toBe(30);
    await db.exec(`update friend_tries set at = at - interval '11 minutes' where user_id = '${A}'`);
    await as(db, A);
    expect(await refusal(`select friend_invite('${PA}', '${PB}', 'ABC123')`)).toBe("");
  });
});

describe("codes", () => {
  test("every character of a new code can be any of the 32", async () => {
    await as(db, null);
    const codes = (await db.query<{ c: string }>(`select friend_new_code() as c from generate_series(1, 3000)`)).rows.map((r) => r.c);
    for (let i = 0; i < 8; i++) expect(new Set(codes.map((c) => c[i])).size).toBe(32);
  });
});

describe("caps under a lock", () => {
  const advisoryLocks = () => count(`select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`);

  test("adding a profile, library or progress rows, or asking a friend, holds a lock until the end", async () => {
    await as(db, A);
    await db.exec(`begin; insert into profiles(user_id, name) values ('${A}', 'Second')`);
    expect(await advisoryLocks()).toBeGreaterThan(0);
    await db.exec(`rollback`);
    expect(await advisoryLocks()).toBe(0);
    await db.exec(`begin; insert into library(profile_id, meta_id, kind, added_at, updated_at) values ('${PA}', 'tt0000001', 0, 0, 1)`);
    expect(await advisoryLocks()).toBeGreaterThan(0);
    await db.exec(`rollback`);
    await as(db, C);
    const c = await code(PC);
    await as(db, A);
    await db.exec(`begin; select friend_request('${PA}', '${c}')`);
    expect(await advisoryLocks()).toBeGreaterThanOrEqual(2);
    await db.exec(`rollback`);
    await as(db, null);
  });

  test("the caps still count as before", async () => {
    await as(db, A);
    for (let i = 0; i < 4; i++) await db.exec(`insert into profiles(user_id, name) values ('${A}', 'P${i}')`);
    expect(await refusal(`insert into profiles(user_id, name) values ('${A}', 'Sixth')`)).toBe("profile_limit");
    await as(db, null);
  });
});

describe("the progress codec", () => {
  test("not callable without signing in; signed-in pushes still decode", async () => {
    await as(db, null);
    for (const f of ["polar_time_cap()", "polar_varint_bytes(1)", "polar_varint('\\x01'::bytea, 0)", "polar_entries('tt1', '\\x01'::bytea, 0)"]) {
      expect(await refusal(`set role anon; select ${f}`)).toContain("permission denied");
      await db.exec(`reset role`);
    }
    await as(db, A);
    // One film entry: version, flags 0, position 60, duration 120, age 0.
    await db.exec(`insert into progress(profile_id, meta_id, kind, entries, updated_at) values ('${PA}', 'tt0000002', 0, '\\x01003c7800'::bytea, 1000)`);
    expect(await count(`select count(*) from progress where profile_id = '${PA}'`)).toBe(1);
    await as(db, null);
  });
});
