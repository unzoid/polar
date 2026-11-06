// The account limits migration (supabase/migrations/20261107000000_account_limits.sql, #110) in
// PGlite: the row caps per profile and per account, the purge of old removals that makes room, the
// one-entry progress size, the value checks and supabase/admin's scripts. The tests share one database and run in order.
import { beforeAll, describe, expect, test } from "bun:test";
import { encodeEntries } from "../../src/lib/account/progressCodec";
import { as, migrations, sqlFile, supabaseDb, type Db } from "./supabaseStub";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const PB = "00000000-0000-0000-0000-0000000000b1";
const PA = "00000000-0000-0000-0000-0000000000a1";
const PA2 = "00000000-0000-0000-0000-0000000000a2";
const PA3 = "00000000-0000-0000-0000-0000000000a3";
const T = 1_762_000_000_000;

let db: Db;
const hex = (b: Uint8Array) => "\\x" + Buffer.from(b).toString("hex");
/** What the statement was refused with ('' when it went through). */
const refusal = async (sql: string) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};
const rows = async (table: string, profile: string) =>
  Number((await db.query<{ n: string }>(`select count(*)::text n from ${table} where profile_id = '${profile}'`)).rows[0].n);
/** Rows changed 91 days ago, past the last-write-wins trigger (which would stamp them now). */
const backdate = (where: string) =>
  db.exec(`set session_replication_role = replica; update ${where.replace(" where ", " set synced_at = now() - interval '91 days' where ")};
set session_replication_role = default;`);
/** `n` library rows numbered from `from` (the movie `tt<from>` …), in one statement. */
const library = (profile: string, n: number, from = 1, kind = 0) =>
  `insert into library(profile_id, meta_id, kind, added_at, updated_at)
   select '${profile}', 'tt' || i, ${kind}, 1, ${T} from generate_series(${from}, ${from + n - 1}) i`;
/** `n` progress rows, each one movie entry (version 1, form 0, position 1, duration 1, age 0). */
const progress = (profile: string, n: number, from = 1) =>
  `insert into progress(profile_id, meta_id, kind, entries, updated_at)
   select '${profile}', 'tt' || i, 0, '\\x0100010100'::bytea, ${T} from generate_series(${from}, ${from + n - 1}) i`;

beforeAll(async () => {
  db = await supabaseDb();
  for (const f of migrations()) await db.exec(sqlFile(`migrations/${f}`));
  await db.exec(`insert into auth.users values ('${A}');
insert into profiles(id, user_id, name) values ('${PA}','${A}','A'), ('${PA2}','${A}','A2'), ('${PA3}','${A}','A3');
grant all on all tables in schema public to authenticated;`);
  await as(db, A);
}, 30_000);

describe("row caps (#110)", () => {
  test("a profile keeps up to 5,000 library rows; past that the insert is refused, updates still go", async () => {
    expect(await refusal(library(PA, 5_000))).toBe("");
    expect(await refusal(library(PA, 1, 5_001))).toBe("library_limit");
    expect(await rows("library", PA)).toBe(5_000);
    // A whole push is one statement: two rows already there and one new, refused as a whole.
    expect(await refusal(`${library(PA, 3, 4_999)} on conflict (profile_id, meta_id) do update set updated_at = excluded.updated_at + 1`)).toBe(
      "library_limit",
    );
    expect(await refusal(`update library set kind = 128, updated_at = ${T + 1} where profile_id = '${PA}' and meta_id = 'tt1'`)).toBe("");
    expect(await refusal(`insert into library values ('${PA}','tt1',0,1,${T + 2}) on conflict (profile_id, meta_id) do update set kind = 0, updated_at = excluded.updated_at`)).toBe("");
  }, 60_000);

  test("removals changed more than 90 days ago make room at the cap; newer ones don't", async () => {
    await db.exec(`update library set kind = 128, updated_at = ${T + 3} where profile_id = '${PA}' and meta_id in ('tt2','tt3')`);
    expect(await refusal(library(PA, 1, 20_001))).toBe("library_limit");
    await as(db, null);
    await backdate(`library where profile_id = '${PA}' and meta_id in ('tt2','tt3')`);
    await as(db, A);
    expect(await refusal(library(PA, 1, 20_001))).toBe("");
    expect(await rows("library", PA)).toBe(4_999);
    expect(await refusal(library(PA, 1, 20_002))).toBe("");
    expect(await refusal(library(PA, 1, 20_003))).toBe("library_limit");
  }, 60_000);

  test("an account keeps up to 5,000 library rows across its profiles", async () => {
    expect(await refusal(library(PA2, 5_000))).toBe("");
    expect(await refusal(library(PA3, 1))).toBe("library_limit");
    expect(await rows("library", PA3)).toBe(0);
  }, 60_000);

  test("progress: 5,000 titles a profile, 5,000 an account", async () => {
    expect(await refusal(progress(PA, 5_000))).toBe("");
    expect(await refusal(progress(PA, 1, 5_001))).toBe("progress_limit");
    expect(await refusal(progress(PA2, 5_000))).toBe("");
    expect(await refusal(progress(PA3, 1))).toBe("progress_limit");
  }, 60_000);

  test("anime links: 5,000 a profile", async () => {
    const links = (n: number, from = 1) =>
      `insert into anime_links(profile_id, anilist, canonical, updated_at) select '${PA3}', i, 'kitsu:' || i, ${T} from generate_series(${from}, ${from + n - 1}) i`;
    expect(await refusal(links(5_000))).toBe("");
    expect(await refusal(links(1, 5_001))).toBe("anime_links_limit");
  }, 60_000);

  test("playlists: 1,000 rows a profile with removed ones, still 100 live", async () => {
    const lists = (n: number, from: number, deleted: boolean) =>
      `insert into playlists(id, profile_id, name, items, deleted, updated_at)
       select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, '${PA3}', 'L', '\\x01', ${deleted}, ${T}
       from generate_series(${from}, ${from + n - 1}) i`;
    expect(await refusal(lists(100, 1, false))).toBe("");
    expect(await refusal(lists(1, 101, false))).toBe("playlist_limit");
    expect(await refusal(lists(900, 101, true))).toBe("");
    expect(await refusal(lists(1, 1001, true))).toBe("playlist_limit");
    await as(db, null);
    await backdate(`playlists where deleted and profile_id = '${PA3}'`);
    await as(db, A);
    expect(await refusal(lists(1, 1001, true))).toBe("");
    expect(await rows("playlists", PA3)).toBe(101);
  }, 60_000);

  test("a removed playlist keeps no titles", async () => {
    const id = "00000000-0000-0000-0000-00000000f001";
    await db.exec(`insert into playlists(id, profile_id, name, items, updated_at) values ('${id}', '${PA}', 'L', '\\x010203', ${T})`);
    await db.exec(`update playlists set deleted = true, items = '\\x01020304', updated_at = ${T + 1} where id = '${id}'`);
    const r = (await db.query<{ items: Uint8Array }>(`select items from playlists where id = '${id}'`)).rows[0];
    expect([...r.items]).toEqual([1]);
  });
});

describe("value checks (#110)", () => {
  // Room again: the account is full from the tests above.
  beforeAll(() => db.exec(`delete from library where profile_id = '${PA2}'; delete from progress where profile_id = '${PA2}';`));
  const entry = (video: string) => hex(encodeEntries("tt5", [{ videoId: video, position: 1, duration: 1, updatedAt: T }]));

  test("in the one-entry mode a title's progress is up to 512 bytes; keeping every episode allows more", async () => {
    await db.exec(`delete from progress where profile_id = '${PA3}'`);
    expect(await refusal(`insert into progress values ('${PA3}','tt5',0,'${entry("x".repeat(480))}',${T})`)).toBe("");
    expect(await refusal(`insert into progress values ('${PA3}','tt6',0,'${entry("x".repeat(600))}',${T})`)).toBe("bad_entries");
    await as(db, null);
    await db.exec(sqlFile("optional/per_episode_progress.sql"));
    await as(db, A);
    expect(await refusal(`insert into progress values ('${PA3}','tt6',0,'${entry("x".repeat(600))}',${T})`)).toBe("");
    await as(db, null);
    await db.exec(sqlFile("optional/per_episode_progress_off.sql"));
    await as(db, A);
  });

  test("ids: no control characters, at most 200 bytes", async () => {
    await db.exec(`delete from library where profile_id = '${PA3}'`);
    expect(await refusal(`insert into library values ('${PA3}',E'tt1\\n',0,1,${T})`)).toMatch(/library_meta_id_format/);
    expect(await refusal(`insert into library values ('${PA3}','${"é".repeat(101)}',0,1,${T})`)).toMatch(/library_meta_id_format/);
    expect(await refusal(`insert into progress values ('${PA3}',E'tt\\t1',0,'\\x0100010100',${T})`)).toMatch(/progress_meta_id_format/);
    expect(await refusal(`insert into library values ('${PA3}','${"x".repeat(200)}',0,1,${T})`)).toBe("");
  });

  test("times: added_at is clamped to 1970 .. now + 5 min, negative updated_at is refused", async () => {
    await db.exec(`insert into library values ('${PA3}','tt2',0,-5,${T}), ('${PA3}','tt3',0,2000000000,${T})`);
    const added = (await db.query<{ meta_id: string; added_at: number }>(`select meta_id, added_at from library where meta_id in ('tt2','tt3') and profile_id = '${PA3}' order by meta_id`)).rows;
    expect(added[0].added_at).toBe(0);
    expect(added[1].added_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 301);
    expect(await refusal(`insert into library values ('${PA3}','tt4',0,1,-1)`)).toMatch(/library_times/);
    expect(await refusal(`insert into anime_links(profile_id, anilist, canonical, updated_at) values ('${PA}',1,'tt1',-1)`)).toMatch(/anime_links_times/);
  });

  test("profiles, playlists and settings", async () => {
    expect(await refusal(`update profiles set avatar = 'Big Avatar' where id = '${PA}'`)).toMatch(/profiles_avatar_format/);
    expect(await refusal(`update profiles set avatar = 'aurora' where id = '${PA}'`)).toBe("");
    expect(await refusal(`update profiles set name = E'A\\u0007' where id = '${PA}'`)).toMatch(/profiles_name_format/);
    expect(await refusal(`update profiles set position = 5000 where id = '${PA}'`)).toMatch(/profiles_position_range/);
    expect(await refusal(`insert into playlists(id, profile_id, name, items, updated_at) values (gen_random_uuid(), '${PA}', E'a\\nb', '\\x01', ${T})`)).toMatch(
      /playlists_name_format/,
    );
    expect(await refusal(`insert into profile_settings(profile_id, data, updated_at) values ('${PA}', '[]', ${T})`)).toMatch(/profile_settings_object/);
    expect(await refusal(`insert into profile_settings(profile_id, data, updated_at) values ('${PA}', '{"prefs":{}}', ${T})`)).toBe("");
  });

  test("supabase/checks/account_limits.sql finds nothing to fix and validates the checks", async () => {
    await as(db, null);
    const out = await db.exec(sqlFile("checks/account_limits.sql"));
    for (const r of out.slice(0, -1)) expect(r.rows.every((x: any) => Number(x.rows) === 0)).toBe(true);
    const left = await db.query(`select conname from pg_constraint where not convalidated and connamespace = 'public'::regnamespace`);
    expect(left.rows).toEqual([]);
  });
});

describe("admin scripts (#110)", () => {
  test("account_usage.sql lists accounts by size with their rows per table", async () => {
    await as(db, null);
    await db.exec(`insert into auth.users(id, email) values ('${B}', 'b@example.com');
insert into profiles(id, user_id, name) values ('${PB}','${B}','B');
insert into library values ('${PB}','tt1',0,1,${T});`);
    const [largest, signups] = await db.exec(sqlFile("admin/account_usage.sql"));
    const accounts = largest.rows as any[];
    expect(accounts.map((r) => r.user_id)).toEqual([A, B]);
    expect(accounts[0]).toMatchObject({ profiles: 3, anime_links: 5_000 });
    expect(accounts[1]).toMatchObject({ email: "b@example.com", profiles: 1, library: 1, progress: 0 });
    expect(Number((signups.rows[0] as any).accounts)).toBe(2);
  });

  test("delete_account.sql deletes an account's rows, keeping the sign-in or not", async () => {
    const script = sqlFile("admin/delete_account.sql").replace("00000000-0000-0000-0000-000000000000", B);
    await db.exec(script.replace("keep_sign_in boolean := false", "keep_sign_in boolean := true"));
    expect(await rows("library", PB)).toBe(0);
    expect((await db.query(`select 1 from profiles where user_id = '${B}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from auth.users where id = '${B}'`)).rows).toHaveLength(1);
    await db.exec(script);
    expect((await db.query(`select 1 from auth.users where id = '${B}'`)).rows).toHaveLength(0);
    expect(await rows("library", PA)).toBeGreaterThan(0); // nobody else's
    expect(await refusal(script)).toMatch(/No account has the id/);
  });
});
