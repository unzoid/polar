// The compact storage migration (supabase/migrations/20261105000000_compact_storage.sql), its SQL
// codec against the TS one, sync_lww, row-level security, the playlist and settings limits,
// supabase/checks and the optional per-episode scripts, in PGlite. The tests share one database
// and run in order: each starts from what the one before left.
import { beforeAll, describe, expect, test } from "bun:test";
import { decodeEntries, encodeEntries, type ProgressEntry } from "../../src/lib/account/progressCodec";
import { as, fails, migrations, sqlFile, supabaseDb, type Db } from "./supabaseStub";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const PA = "00000000-0000-0000-0000-0000000000a1";
const PB = "00000000-0000-0000-0000-0000000000b1";
const T = 1_762_000_000_000;
const FIVE_MIN = 300_000;

type Row = { profile_id: string; meta_id: string; kind: number; entries: Uint8Array; updated_at: string };

let db: Db;
const progress = async () => (await db.query<Row>(`select profile_id, meta_id, kind, entries, updated_at::text from progress order by meta_id`)).rows;
const row = async (meta: string) => (await progress()).find((r) => r.meta_id === meta)!;
const entriesOf = (r: Row) => decodeEntries(r.meta_id, new Uint8Array(r.entries), Number(r.updated_at));
const synced = async (meta: string) => (await db.query<{ s: string }>(`select synced_at::text s from progress where meta_id = '${meta}'`)).rows[0].s;
const hex = (b: Uint8Array) => "\\x" + Buffer.from(b).toString("hex");
const push = (p: string, meta: string, kind: number, es: ProgressEntry[]) => {
  const at = Math.max(...es.map((e) => e.updatedAt));
  return db.exec(`insert into progress(profile_id, meta_id, kind, entries, updated_at) values ('${p}','${meta}',${kind},'${hex(encodeEntries(meta, es))}',${at})
    on conflict (profile_id, meta_id) do update set kind = excluded.kind, entries = excluded.entries, updated_at = excluded.updated_at`);
};
const ep = (s: number, e: number, pos: number, at: number): ProgressEntry => ({
  videoId: `tt0000105:${s}:${e}`,
  season: s,
  episode: e,
  position: pos,
  duration: 3000,
  updatedAt: at,
});
const count = async (sql: string) => (await db.query(sql)).rows.length;

test("every migration and optional script applies to an empty database", async () => {
  const empty = await supabaseDb();
  for (const f of migrations()) await empty.exec(sqlFile(`migrations/${f}`));
  await empty.exec(sqlFile("optional/per_episode_progress.sql"));
  await empty.exec(sqlFile("optional/per_episode_progress_off.sql"));
  await empty.close();
}, 30_000);

describe("compact storage migration", () => {
  beforeAll(async () => {
    // The tables as they were before the migration, with rows in them.
    db = await supabaseDb();
    const files = migrations();
    const compact = files.find((f) => f.includes("compact_storage"))!;
    for (const f of files.filter((f) => f < compact)) await db.exec(sqlFile(`migrations/${f}`));
    await db.exec(`insert into auth.users values ('${A}'), ('${B}');
insert into profiles(id, user_id, name) values ('${PA}','${A}','A'), ('${PB}','${B}','B');
insert into library_items(profile_id,user_id,meta_id,type,name,poster,added_at,deleted,updated_at) values
 ('${PA}','${A}','tt0000105','series','Gld','https://x/p.jpg',${T},false,${T}),
 ('${PA}','${A}','tt0000100','','',null,${T + 5},true,${T + 5});
insert into watch_progress(profile_id,user_id,video_id,meta_id,type,name,season,episode,position,duration,updated_at,stream) values
 ('${PA}','${A}','tt0000105:1:1','tt0000105','series','Gld',1,1,100.4,3000,${T},'{"url":"x"}'),
 ('${PA}','${A}','tt0000105:1:2','tt0000105','series','Gld',1,2,200.6,3100,${T + 1000},null),
 ('${PA}','${A}','kitsu:1:5','kitsu:1','series','Bluenote',null,5,'NaN',1440,${T + 2000},null),
 ('${PA}','${A}','tt0000100','tt0000100','movie','Stonewall',null,null,60,8520,${T + 3000},null);
insert into profile_settings(profile_id,user_id,data,updated_at) values ('${PA}','${A}',
 '{"settings":{"tmdbKey":"secret","omdbKey":"o","mdblistKey":null,"seekrKey":"s","autoplay":true},"addons":["https://a/manifest.json"],"prefs":{},"keybinds":{}}', ${T});
insert into playlists(id,profile_id,user_id,name,items,updated_at) values ('00000000-0000-0000-0000-00000000c001','${PA}','${A}','L','\\x01',${T});`);
    await db.exec(sqlFile(`migrations/${compact}`));
    await db.exec(`grant all on all tables in schema public to authenticated;`);
  }, 30_000);

  test("library rows are copied and the tombstone kept", async () => {
    const lib = (await db.query<any>(`select meta_id, kind, added_at from library order by meta_id`)).rows;
    expect(lib.map((r) => [r.meta_id, r.kind])).toEqual([
      ["tt0000100", 128],
      ["tt0000105", 1],
    ]);
    expect(lib[1].added_at).toBe(Math.floor(T / 1000));
  });

  test("progress keeps one row per title with its newest episode, and TS decodes it", async () => {
    const rows = await progress();
    expect(rows).toHaveLength(3);
    expect(entriesOf(await row("tt0000105"))).toEqual([
      { videoId: "tt0000105:1:2", season: 1, episode: 2, position: 201, duration: 3100, updatedAt: T + 1000 },
    ]);
    expect(entriesOf(await row("kitsu:1"))).toEqual([{ videoId: "kitsu:1:5", episode: 5, position: 0, duration: 1440, updatedAt: T + 2000 }]);
    expect(entriesOf(await row("tt0000100"))).toEqual([{ videoId: "tt0000100", position: 60, duration: 8520, updatedAt: T + 3000 }]);
  });

  test("the SQL encoder writes the same bytes as the TS one", async () => {
    const sqlBytes = (await db.query<{ b: Uint8Array }>(`select '\\x01'::bytea || body || '\\x00'::bytea b from polar_entry('tt1','tt1:2:3',2,3,10.5,20)`))
      .rows[0].b;
    const ts = encodeEntries("tt1", [{ videoId: "tt1:2:3", season: 2, episode: 3, position: 10.5, duration: 20, updatedAt: 1 }]);
    expect(Buffer.from(sqlBytes).equals(Buffer.from(ts))).toBe(true);
  });

  test("keys and add-on links leave the settings, the rest stays", async () => {
    const s = (await db.query<any>(`select data from profile_settings`)).rows[0].data;
    expect("addons" in s).toBe(false);
    expect(Object.keys(s.settings)).toEqual(["autoplay"]);
    expect(s.settings.autoplay).toBe(true);
  });

  test("old tables and user_id columns outside profiles are gone", async () => {
    expect(await count(`select 1 from information_schema.tables where table_name in ('library_items','watch_progress')`)).toBe(0);
    expect(await count(`select 1 from information_schema.columns where column_name = 'user_id' and table_name <> 'profiles' and table_schema='public'`)).toBe(
      0,
    );
  });

  test("supabase/checks/compact_storage.sql runs clean", async () => {
    const checks = await db.exec(sqlFile("checks/compact_storage.sql"));
    expect(checks).toHaveLength(6);
    expect((checks[0].rows[0] as any).progress_titles).toBe(3);
    expect(checks[1].rows).toHaveLength(0);
    expect((checks[2].rows[0] as any).settings_with_secrets).toBe(0);
    expect((checks[3].rows[0] as any).leftovers).toBe(0);
    expect(checks[4].rows.every((r: any) => r.relrowsecurity)).toBe(true);
  });

  test("one-entry mode: newer pushes replace, older ones are ignored, the future is clamped", async () => {
    await as(db, A);
    await push(PA, "tt0000105", 1, [ep(1, 1, 50, T + 500)]);
    expect(entriesOf(await row("tt0000105"))![0].videoId).toBe("tt0000105:1:2");
    await push(PA, "tt0000105", 1, [ep(1, 3, 10, T + 9000), ep(1, 1, 5, T + 8000)]);
    const es = entriesOf(await row("tt0000105"))!;
    expect(es.map((e) => [e.videoId, e.updatedAt])).toEqual([["tt0000105:1:3", T + 9000]]);
    await push(PA, "tt9", 0, [{ videoId: "tt9", position: 1, duration: 2, updatedAt: Date.now() + 3_600_000 }]);
    expect(Number((await row("tt9")).updated_at)).toBeLessThanOrEqual(Date.now() + FIVE_MIN + 1000);
  });

  test("malformed rows are refused", async () => {
    expect(await fails(db, `insert into progress values ('${PA}','tt8',0,'\\x02',1)`)).toBe(true); // unknown version
    expect(await fails(db, `insert into progress values ('${PA}','tt8',0,'\\x010000',1)`)).toBe(true); // broken entries
    const movie = hex(encodeEntries("tt8", [{ videoId: "tt8", position: 1, duration: 1, updatedAt: 1 }]));
    expect(await fails(db, `insert into progress values ('${PA}','tt8',3,'${movie}',1)`)).toBe(true); // bad kind
    await db.exec(`insert into library values ('${PA}','tt7',0,1,${T})`);
    expect(await fails(db, `insert into library values ('${PA}','tt6',2,1,${T})`)).toBe(true);
  });

  test("anime links: the newer decision wins, alias ids and AniList id 0 are refused", async () => {
    const link = (profile: string, anilist: number, canonical: string, at: number) =>
      `insert into anime_links(profile_id, anilist, canonical, updated_at) values ('${profile}', ${anilist}, '${canonical}', ${at})
       on conflict (profile_id, anilist) do update set canonical = excluded.canonical, updated_at = excluded.updated_at`;
    const canonical = async () =>
      (await db.query<{ canonical: string }>(`select canonical from anime_links where profile_id = '${PA}' and anilist = 1`)).rows[0]?.canonical;
    await db.exec(link(PA, 1, "kitsu:1", T));
    await db.exec(link(PA, 1, "tt0000101", T - 1));
    expect(await canonical()).toBe("kitsu:1");
    await db.exec(link(PA, 1, "tt0000101", T + 1));
    expect(await canonical()).toBe("tt0000101");
    expect(await fails(db, link(PA, 2, "mal:5", T))).toBe(true);
    expect(await fails(db, link(PA, 0, "tt1", T))).toBe(true);
  });

  test("row-level security: another account sees and writes none of A's rows", async () => {
    await as(db, B);
    for (const table of ["progress", "library", "profile_settings", "playlists", "anime_links"]) expect(await count(`select * from ${table}`)).toBe(0);
    expect(await fails(db, `insert into library values ('${PA}','tt5',0,1,${T})`)).toBe(true);
    expect(await fails(db, `insert into anime_links(profile_id, anilist, canonical, updated_at) values ('${PA}', 5, 'tt1', 1)`)).toBe(true);
  });

  test("deleting a profile deletes its rows", async () => {
    await as(db, B);
    await db.exec(
      `insert into anime_links(profile_id, anilist, canonical, updated_at) values ('${PB}', 5, 'tt1', 1); insert into library values ('${PB}','tt5',0,1,${T})`,
    );
    expect(await count(`select * from anime_links`)).toBe(1);
    await as(db, null);
    await db.exec(`delete from profiles where id = '${PB}'`);
    expect(await count(`select * from anime_links where profile_id = '${PB}'`)).toBe(0);
    expect(await count(`select * from library where profile_id = '${PB}'`)).toBe(0);
  });

  test("at most 100 live playlists; updates and deleted ones don't count", async () => {
    await as(db, A);
    const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
    for (let i = 2; i <= 100; i++)
      await db.exec(`insert into playlists(id,profile_id,name,items,updated_at) values ('${id(0xc000 + i)}','${PA}','L${i}','\\x01',${T})`);
    const extra = `insert into playlists(id,profile_id,name,items,updated_at) values ('${id(0xd001)}','${PA}','X','\\x01',${T})`;
    expect(await fails(db, extra)).toBe(true);
    const rename = `insert into playlists(id,profile_id,name,items,updated_at) values ('${id(0xc001)}','${PA}','L2','\\x01',${T + 1})
      on conflict (id) do update set name = excluded.name, updated_at = excluded.updated_at`;
    expect(await fails(db, rename)).toBe(false);
    await db.exec(`update playlists set deleted = true, updated_at = ${T + 2} where id = '${id(0xc001)}'`);
    expect(await fails(db, extra)).toBe(false);
  }, 30_000);

  test("settings writes answer with what was stored; too large ones are refused naming the table", async () => {
    const put = (at: number) =>
      db.query<any>(
        `insert into profile_settings(profile_id,data,updated_at) values ('${PA}','{"settings":{}}',${at}) on conflict (profile_id) do update set data = excluded.data, updated_at = excluded.updated_at returning updated_at`,
      );
    expect((await put(1)).rows).toHaveLength(0);
    const future = Date.now() + 3_600_000;
    const back = Number((await put(future)).rows[0]?.updated_at);
    expect(back).toBeLessThan(future);
    expect(back).toBeLessThanOrEqual(Date.now() + FIVE_MIN + 1000);
    await db.exec(`delete from profile_settings where profile_id = '${PA}'`);
    const big = `insert into profile_settings(profile_id,data,updated_at) values ('${PA}', jsonb_build_object('x', (select string_agg(md5(i::text), '') from generate_series(1, 2000) i)), 1)`;
    const error = await db.exec(big).then(
      () => null,
      (e: any) => e,
    );
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("profile_settings");
  });

  test("per-episode mode merges both sides per episode and keeps the stored entry on ties", async () => {
    await as(db, null);
    await db.exec(sqlFile("optional/per_episode_progress.sql"));
    await as(db, A);
    await push(PA, "tt0000105", 1, [ep(1, 1, 100, T + 10_000), ep(1, 2, 200, T + 11_000)]);
    let es = entriesOf(await row("tt0000105"))!;
    expect(es).toHaveLength(3);
    expect(es.find((e) => e.episode === 3)?.position).toBe(10);
    const before = await synced("tt0000105");
    await push(PA, "tt0000105", 1, [ep(1, 1, 100, T + 10_000)]);
    expect(await synced("tt0000105")).toBe(before); // a re-sent push writes nothing
    await push(PA, "tt0000105", 1, [ep(1, 1, 999, T + 10_000), ep(1, 2, 1, T + 5)]);
    es = entriesOf(await row("tt0000105"))!;
    expect(es.find((e) => e.episode === 1)?.position).toBe(100);
    expect(es.find((e) => e.episode === 2)?.position).toBe(200);
    await push(PA, "tt0000105", 1, [ep(2, 1, 7, T + 20_000)]);
    const r = await row("tt0000105");
    expect(Number(r.updated_at)).toBe(T + 20_000); // the row's time follows its newest entry
    expect(entriesOf(r)).toHaveLength(4);
  });

  test("turning per-episode mode off keeps the newest entry, and one-entry mode is back", async () => {
    await as(db, null);
    await db.exec(sqlFile("optional/per_episode_progress_off.sql"));
    const es = entriesOf(await row("tt0000105"))!;
    expect(es.map((e) => [e.videoId, e.updatedAt])).toEqual([["tt0000105:2:1", T + 20_000]]);
    await as(db, A);
    await push(PA, "tt0000105", 1, [ep(2, 2, 7, T + 30_000), ep(1, 1, 7, T + 29_000)]);
    expect(entriesOf(await row("tt0000105"))).toHaveLength(1);
  });
});
