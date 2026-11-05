import { beforeAll, describe, expect, test } from "bun:test";
import { count, likeTemplate, listOf, storedJson } from "../src/lib/parse";
import { fromLibraryRow, fromLinkRow, fromPlaylistRow, fromProgressRow, toLibraryRow, toProgressRows } from "../src/lib/account/supabase";
import { readProfile } from "../src/lib/account/backend";
import { playContextStore } from "../src/lib/anime/playContext";
import type { Progress } from "../src/lib/types";

/**
 * prefs, keybinds and playlists read localStorage when they load, and other test files may have
 * loaded them already: the readers are tested directly, the stub only lets them load here.
 */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let playlists: typeof import("../src/lib/library/playlists");
let prefs: typeof import("../src/lib/settings/prefs");
let keybinds: typeof import("../src/lib/settings/keybinds");
beforeAll(async () => {
  playlists = await import("../src/lib/library/playlists");
  prefs = await import("../src/lib/settings/prefs");
  keybinds = await import("../src/lib/settings/keybinds");
});

describe("parse helpers", () => {
  test("count takes whole numbers ≥ 0, numeric strings included (Postgres bigint)", () => {
    expect([0, 42, "42", -1, 1.5, "", "x", null, NaN, 2 ** 60].map(count)).toEqual([
      0,
      42,
      42,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("listOf leaves out what the reader refuses", () => {
    expect(listOf([1, "2", -3, {}], count)).toEqual([1, 2]);
    expect(listOf({ length: 1 }, count)).toEqual([]);
  });

  test("storedJson: nothing for missing or unparseable", () => {
    const s = { getItem: (k: string) => ({ ok: "[1]", bad: "{" })[k] ?? null };
    expect(storedJson(s, "ok")).toEqual([1]);
    expect(storedJson(s, "bad")).toBeUndefined();
    expect(storedJson(s, "none")).toBeUndefined();
    expect(storedJson(undefined, "ok")).toBeUndefined();
  });

  test("likeTemplate keeps known keys of the same kind; optional ones take any primitive", () => {
    const template = { a: 1, b: "x", c: [] as string[], d: null as string | null, e: true };
    const got = likeTemplate(template, { a: "1", b: "y", c: {}, d: "key", e: false, f: 1 });
    expect(got).toEqual({ b: "y", d: "key", e: false });
    expect(likeTemplate(template, { d: { x: 1 } })).toEqual({});
    expect(likeTemplate(template, "nope")).toEqual({});
  });
});

describe("what localStorage kept (critique M9)", () => {
  test("a playlist space from before `dirty` loads instead of crashing the module", () => {
    const space = playlists.readSpace({ playlists: [{ id: "a", name: "Old", items: [], updatedAt: 1 }] });
    expect(space).toEqual({ playlists: [{ id: "a", name: "Old", items: [], updatedAt: 1 }], dirty: [], pulledAt: null });
  });

  test("bad playlists and items are left out, dirty ids only for playlists that exist", () => {
    const space = playlists.readSpace({
      playlists: [
        { id: "a", name: "Mixed", updatedAt: 5, deleted: true, items: [{ id: "tt1", type: "movie", name: "One" }, { id: "tt2", type: "show" }, null] },
        { name: "no id" },
        "junk",
      ],
      dirty: ["a", "gone", 3],
      pulledAt: 7,
    });
    expect(space).toEqual({
      playlists: [{ id: "a", name: "Mixed", updatedAt: 5, deleted: true, items: [{ id: "tt1", type: "movie", name: "One" }] }],
      dirty: ["a"],
      pulledAt: null,
    });
    expect(playlists.readSpace([1, 2])).toEqual({ playlists: [], dirty: [], pulledAt: null });
  });

  test("prefs of the wrong kind fall back to the default", () => {
    const p = prefs.readPrefs({ animeEnabled: "yes", animeTitles: "romaji", nope: 1 });
    expect(p).toEqual({ animeTitles: "romaji" });
    expect(prefs.readPrefs("{not json")).toEqual({});
  });

  test("key bindings: unknown actions and non-strings are dropped, at most two each", () => {
    const read = keybinds.readBindings({ search: ["/", 5, "x", "y"], nope: ["a"], toggleTv: "F10" });
    expect(read).toEqual({ search: ["/", "x"] });
    expect(keybinds.readBindings(null)).toEqual({});
  });

  test("cached profiles need an id; a strange avatar becomes a known one", () => {
    expect(readProfile({ name: "x" })).toBeUndefined();
    const p = readProfile({ id: "p1", name: 3, avatar: "???", position: "2" });
    expect(p).toMatchObject({ id: "p1", name: "", position: 2 });
    expect(typeof p?.avatar).toBe("string");
  });

  test("anime play context: damaged titles and fields are left out", () => {
    const data = new Map([
      ["polar.animePlayContext.v1", JSON.stringify({ tt1: { mal: "21", eps: { "tt1:1:2": 2, "tt1:1:3": "x" }, filler: [3, "4", -1], at: 9 }, tt2: 5 })],
    ]);
    const ctx = playContextStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) });
    expect(ctx.episode("tt1:1:2")).toMatchObject({ mal: 21, episode: 2 });
    expect(ctx.episode("tt1:1:3")).toBeUndefined();
  });
});

describe("pulled rows (critique M9)", () => {
  const lib = { meta_id: "tt1", kind: 0, added_at: "10", updated_at: 12_345, synced_at: "s" };

  test("library rows: no name or poster, seconds back to ms, removals by kind, misfits left out", () => {
    expect(fromLibraryRow(lib)).toEqual({ id: "tt1", type: "movie", name: "", poster: null, addedAt: 10_000, deleted: false, updatedAt: 12_345 });
    // Never changed since added: the exact time comes back from updated_at.
    expect(fromLibraryRow({ ...lib, added_at: 12 })?.addedAt).toBe(12_345);
    expect(fromLibraryRow({ ...lib, kind: 1 })?.type).toBe("series");
    expect(fromLibraryRow({ ...lib, kind: 129 })).toMatchObject({ type: "", deleted: true });
    for (const bad of [{ kind: 2 }, { kind: null }, { meta_id: "" }, { added_at: -1 }, { updated_at: "soon" }]) {
      expect(fromLibraryRow({ ...lib, ...bad })).toBeUndefined();
    }
    expect(fromLibraryRow(null)).toBeUndefined();
  });

  test("library rows round-trip apart from names and pictures", () => {
    const item = { id: "tt1", type: "series" as const, name: "One", poster: "p", addedAt: 10_000, deleted: false, updatedAt: 12_345 };
    const { profile_id, ...row } = toLibraryRow("p1", item);
    expect(profile_id).toBe("p1");
    expect(row).toEqual({ meta_id: "tt1", kind: 1, added_at: 10, updated_at: 12_345 });
    expect(fromLibraryRow(row)).toEqual({ ...item, name: "", poster: null });
    expect(toLibraryRow("p1", { ...item, type: "", deleted: true }).kind).toBe(128);
  });

  const watched = (videoId: string, season: number | undefined, episode: number | undefined, updatedAt: number): Progress => ({
    metaId: "tt2",
    videoId,
    type: "series",
    name: "Two",
    poster: "p",
    episodeTitle: "Ep",
    season,
    episode,
    position: 312.4,
    duration: 1400,
    updatedAt,
  });

  test("progress: one row per title holding its newest entry, unless every episode is asked for", () => {
    const list = [
      watched("tt2:1:3", 1, 3, 99),
      watched("tt2:1:4", 1, 4, 120),
      { ...watched("tt3", undefined, undefined, 5), metaId: "tt3", type: "movie" as const },
    ];
    const rows = toProgressRows("p1", list, false);
    expect(rows.map((r) => [r.meta_id, r.kind, r.updated_at])).toEqual([
      ["tt2", 1, 120],
      ["tt3", 0, 5],
    ]);
    expect(fromProgressRow(rows[0])).toEqual([
      { metaId: "tt2", type: "series", name: "", videoId: "tt2:1:4", season: 1, episode: 4, position: 312, duration: 1400, updatedAt: 120 },
    ]);
    const all = fromProgressRow(toProgressRows("p1", list, true)[0])!;
    expect(all.map((p) => [p.videoId, p.updatedAt])).toEqual([
      ["tt2:1:3", 99],
      ["tt2:1:4", 120],
    ]);
  });

  test("progress: a few seconds of another episode never becomes the title's one row (test report 1, item 4)", () => {
    const list = [watched("tt2:1:2", 1, 2, 100), { ...watched("tt2:2:1", 2, 1, 200), position: 12 }, { ...watched("tt4:1:1", 1, 1, 300), metaId: "tt4", position: 3 }];
    const rows = toProgressRows("p1", list, false);
    expect(rows.map((r) => [r.meta_id, r.updated_at])).toEqual([["tt2", 100]]);
    expect(fromProgressRow(rows[0])!.map((p) => p.videoId)).toEqual(["tt2:1:2"]);
    // Every episode, when asked for, still means every one.
    expect(toProgressRows("p1", list, true).map((r) => r.meta_id)).toEqual(["tt2", "tt4"]);
  });

  test("progress rows: unknown entries, kinds and numbers beyond a u32 are left out", () => {
    const row = toProgressRows("p1", [watched("tt2:1:3", 1, 3, 99)], false)[0];
    expect(fromProgressRow({ ...row, entries: "\\x02" })).toBeUndefined();
    expect(fromProgressRow({ ...row, entries: "zz" })).toBeUndefined();
    expect(fromProgressRow({ ...row, kind: 5 })).toBeUndefined();
    expect(fromProgressRow({ ...row, updated_at: "x" })).toBeUndefined();
    const huge = toProgressRows("p1", [watched("tt2:1:3", 2 ** 33, 3, 99)], false)[0];
    expect(fromProgressRow(huge)).toEqual([]);
  });

  test("link rows need canonical, anilist and a time", () => {
    expect(fromLinkRow({ anilist: 1, canonical: "", mal: null, kitsu: null, updated_at: 1 })).toBeUndefined();
    expect(fromLinkRow({ anilist: "x", canonical: "tt1", updated_at: 1 })).toBeUndefined();
  });

  test("playlist rows: items must be hex", () => {
    const row = { id: "p", name: "L", items: "\\x0102", deleted: false, updated_at: 3 };
    expect(fromPlaylistRow(row)).toEqual({ id: "p", name: "L", items: new Uint8Array([1, 2]), deleted: false, updatedAt: 3 });
    expect(fromPlaylistRow({ ...row, items: "\\x0g" })).toBeUndefined();
    expect(fromPlaylistRow({ ...row, items: "\\x012" })).toBeUndefined();
  });
});
