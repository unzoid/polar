// The TV sign-in migration (supabase/migrations/20261109000000_tv_sign_in.sql, #133) in PGlite: only
// the service role gets in, a request works once and expires, an answer goes to the TV once, and the
// limits per address, overall and per user. The tests share one database and run in order.
import { beforeAll, describe, expect, test } from "bun:test";
import { as, migrations, SERVICE, sqlFile, supabaseDb, type Db } from "./supabaseStub";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

let db: Db;
/** A 64-hex-digit stand-in for a SHA-256 hash. */
const h = (n: number | string) => String(n).padStart(64, "0");
const refusal = async (sql: string) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};
const one = async <T>(sql: string) => (await db.query<Record<string, T>>(sql)).rows[0];
const start = (code: number, poll: number, ip = 1, device = "Living room TV") =>
  db.exec(`select tv_sign_in_start('${h(code)}', '${h(poll)}', '${device.replace(/'/g, "''")}', '${h(`ff${ip}`)}')`);
const look = async (user: string, code: number) => (await one<string | null>(`select tv_sign_in_look('${user}', '${h(code)}') d`)).d;
const answer = async (user: string, code: number, approve: boolean) =>
  (await one<boolean>(`select tv_sign_in_answer('${user}', '${h(code)}', ${approve}) ok`)).ok;
const claim = async (poll: number) => (await db.query<{ state: string; user_id: string | null }>(`select * from tv_sign_in_claim('${h(poll)}')`)).rows[0];
const count = async (table: string) => Number((await one<string>(`select count(*)::text n from ${table}`)).n);
/** Moves every request's expiry into the past. */
const expireAll = async () => {
  await as(db, null);
  await db.exec(`update tv_sign_in set expires_at = now() - interval '1 second'`);
  await as(db, SERVICE);
};

beforeAll(async () => {
  db = await supabaseDb();
  for (const f of migrations()) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);
}, 30_000);

describe("who gets in", () => {
  test("signed-in users and anonymous clients can't read the table or run the functions", async () => {
    await as(db, A);
    expect(await refusal(`select * from tv_sign_in`)).toMatch(/permission denied/);
    expect(await refusal(`select tv_sign_in_look('${A}', '${h(1)}')`)).toMatch(/permission denied/);
    expect(await refusal(`select * from tv_sign_in_claim('${h(1)}')`)).toMatch(/permission denied/);
    await as(db, null);
    await db.exec(`set role anon`);
    expect(await refusal(`select tv_sign_in_start('${h(1)}', '${h(2)}', 'TV', '${h(3)}')`)).toMatch(/permission denied/);
    await as(db, SERVICE);
  });
});

describe("a request", () => {
  test("is pending until answered, then handed to the TV once with the approving account", async () => {
    await start(1, 101);
    expect(await claim(101)).toEqual({ state: "pending", user_id: null });
    expect(await look(A, 1)).toBe("Living room TV");
    expect(await answer(A, 1, true)).toBe(true);
    // Answered: nobody else can look it up or answer it.
    expect(await look(B, 1)).toBeNull();
    expect(await answer(B, 1, true)).toBe(false);
    expect(await claim(101)).toEqual({ state: "approved", user_id: A });
    // Collected: gone, so the same secret gets nothing more.
    expect(await claim(101)).toEqual({ state: "expired", user_id: null });
    expect(await count("tv_sign_in")).toBe(0);
  });

  test("denied: the TV hears so once, and no account is attached", async () => {
    await start(2, 102);
    expect(await answer(A, 2, false)).toBe(true);
    expect(await claim(102)).toEqual({ state: "denied", user_id: null });
    expect(await count("tv_sign_in")).toBe(0);
  });

  test("expires: it can't be looked up, answered or collected, and the next request deletes it", async () => {
    await start(3, 103);
    await expireAll();
    expect(await look(A, 3)).toBeNull();
    expect(await answer(A, 3, true)).toBe(false);
    expect(await claim(103)).toEqual({ state: "expired", user_id: null });
    await start(4, 104);
    await expireAll();
    await start(5, 105);
    expect(await count("tv_sign_in")).toBe(1);
  });

  test("an unknown code or secret finds nothing", async () => {
    expect(await look(A, 999)).toBeNull();
    expect(await answer(A, 999, true)).toBe(false);
    expect(await claim(999)).toEqual({ state: "expired", user_id: null });
  });

  test("values are checked: hashes, device names, and an approval needs an account", async () => {
    expect(await refusal(`select tv_sign_in_start('abc', '${h(9)}', 'TV', '${h(9)}')`)).toMatch(/check/);
    expect(await refusal(`select tv_sign_in_start('${h(10)}', '${h(11)}', '', '${h(9)}')`)).toMatch(/check/);
    expect(await refusal(`select tv_sign_in_start('${h(10)}', '${h(11)}', '${"x".repeat(41)}', '${h(9)}')`)).toMatch(/check/);
    expect(await refusal(`select tv_sign_in_start('${h(10)}', '${h(11)}', E'TV\\nline', '${h(9)}')`)).toMatch(/check/);
    expect(await refusal(`insert into tv_sign_in (code_hash, poll_hash, device, ip_hash, answer) values ('${h(12)}', '${h(13)}', 'TV', '${h(9)}', 'approved')`)).toMatch(
      /check/,
    );
    // The same code twice is refused (the function picks another).
    expect(await refusal(`select tv_sign_in_start('${h(5)}', '${h(14)}', 'TV', '${h(9)}')`)).toMatch(/unique/);
  });
});

describe("limits", () => {
  test("five live requests from one address; others still get theirs", async () => {
    await expireAll();
    for (let i = 0; i < 5; i++) await start(20 + i, 120 + i, 7);
    expect(await refusal(`select tv_sign_in_start('${h(30)}', '${h(130)}', 'TV', '${h("ff7")}')`)).toBe("rate_limited");
    await start(31, 131, 8);
    // Once they've expired, that address can ask again.
    await expireAll();
    await start(32, 132, 7);
  });

  test("ten code lookups per user in ten minutes, counted per user", async () => {
    await as(db, null);
    await db.exec(`delete from tv_sign_in_tries`);
    await as(db, SERVICE);
    for (let i = 0; i < 9; i++) await look(A, 999);
    expect(await look(A, 32)).toBe("Living room TV");
    expect(await refusal(`select tv_sign_in_look('${A}', '${h(32)}')`)).toBe("rate_limited");
    expect(await look(B, 32)).toBe("Living room TV");
    // Lookups older than ten minutes stop counting, and are deleted.
    await as(db, null);
    await db.exec(`update tv_sign_in_tries set at = now() - interval '11 minutes'`);
    await as(db, SERVICE);
    expect(await look(A, 32)).toBe("Living room TV");
    expect(await count(`tv_sign_in_tries where user_id = '${A}'`)).toBe(1);
  });

  test("answers to codes that aren't there count towards the same limit; a right answer always goes through", async () => {
    await as(db, null);
    await db.exec(`delete from tv_sign_in_tries`);
    await as(db, SERVICE);
    for (let i = 0; i < 10; i++) expect(await answer(A, 900 + i, true)).toBe(false);
    expect(await refusal(`select tv_sign_in_answer('${A}', '${h(910)}', true)`)).toBe("rate_limited");
    expect(await refusal(`select tv_sign_in_look('${A}', '${h(910)}')`)).toBe("rate_limited");
    // A request they really have in front of them still takes their answer.
    await start(41, 141, 10);
    expect(await answer(A, 41, false)).toBe(true);
    expect(await claim(141)).toEqual({ state: "denied", user_id: null });
  });

  test("lookups older than ten minutes are deleted whoever made them", async () => {
    await as(db, null);
    await db.exec(`update tv_sign_in_tries set at = now() - interval '11 minutes'`);
    await as(db, SERVICE);
    await look(B, 999);
    expect(await count(`tv_sign_in_tries where user_id = '${A}'`)).toBe(0);
  });

  test("full: the oldest unanswered requests make way for new ones, answered ones stay", async () => {
    await expireAll();
    await start(50, 150, 11);
    await answer(A, 50, true);
    await as(db, null);
    // 9,999 more from many addresses (oldest first), as a flood would leave them.
    await db.exec(`insert into tv_sign_in (code_hash, poll_hash, device, ip_hash, created_at)
      select lpad(to_hex(1000000 + n), 64, '0'), lpad(to_hex(2000000 + n), 64, '0'), 'TV', lpad(to_hex(3000000 + n), 64, '0'),
        now() - interval '1 minute' + n * interval '1 millisecond'
      from generate_series(1, 9999) n`);
    await as(db, SERVICE);
    expect(await count("tv_sign_in")).toBe(10000);
    await start(51, 151, 12);
    expect(await count("tv_sign_in")).toBe(10000);
    expect(await count(`tv_sign_in where code_hash = '${h(51)}'`)).toBe(1);
    expect(await count(`tv_sign_in where code_hash = lpad(to_hex(1000001), 64, '0')`)).toBe(0);
    expect(await claim(150)).toEqual({ state: "approved", user_id: A });
    await expireAll();
  });

  test("a deleted account takes its lookups and approvals with it", async () => {
    await start(40, 140, 9);
    await answer(B, 40, true);
    await as(db, null);
    await db.exec(`delete from auth.users where id = '${B}'`);
    await as(db, SERVICE);
    expect(await count(`tv_sign_in_tries where user_id = '${B}'`)).toBe(0);
    expect(await claim(140)).toEqual({ state: "expired", user_id: null });
  });
});
