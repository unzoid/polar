import { beforeAll, describe, expect, test } from "bun:test";
import { count, likeTemplate, listOf, storedJson } from "../src/lib/parse";
import { fromLibraryRow, fromLinkRow, fromPlaylistRow, fromProgressRow } from "../src/lib/account/supabase";
import { readProfile } from "../src/lib/account/backend";
import { playContextStore } from "../src/lib/anime/playContext";

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

let playlists: typeof import("../src/lib/playlists");
let prefs: typeof import("../src/lib/prefs");
let keybinds: typeof import("../src/lib/keybinds");
beforeAll(async () => {
  playlists = await import("../src/lib/playlists");
  prefs = await import("../src/lib/prefs");
  keybinds = await import("../src/lib/keybinds");
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
  const lib = { meta_id: "tt1", type: "movie", name: "One", poster: null, added_at: "10", deleted: false, updated_at: 12, synced_at: "s" };

  test("library rows: numbers from bigint strings, tombstones with an empty type, misfits left out", () => {
    expect(fromLibraryRow(lib)).toEqual({ id: "tt1", type: "movie", name: "One", poster: null, addedAt: 10, deleted: false, updatedAt: 12 });
    expect(fromLibraryRow({ ...lib, type: "", deleted: true })?.type).toBe("");
    for (const bad of [{ type: "show" }, { type: null }, { meta_id: "" }, { added_at: -1 }, { poster: 3 }, { updated_at: "soon" }]) {
      expect(fromLibraryRow({ ...lib, ...bad })).toBeUndefined();
    }
    expect(fromLibraryRow(null)).toBeUndefined();
  });

  const prog = {
    video_id: "tt2:1:3",
    meta_id: "tt2",
    type: "series",
    name: "Two",
    background: null,
    poster: "p",
    season: 1,
    episode: 3,
    episode_title: null,
    position: 12.5,
    duration: 1400,
    updated_at: "99",
    synced_at: "s",
  };

  test("progress rows: season and episode must fit a u32 or be null", () => {
    expect(fromProgressRow(prog)).toMatchObject({ videoId: "tt2:1:3", type: "series", season: 1, episode: 3, poster: "p", position: 12.5, updatedAt: 99 });
    expect(fromProgressRow({ ...prog, season: null, episode: null })).toMatchObject({ season: undefined, episode: undefined });
    for (const bad of [{ season: -1 }, { episode: 2 ** 33 }, { position: "x" }, { duration: Infinity }, { type: "" }, { video_id: 1 }]) {
      expect(fromProgressRow({ ...prog, ...bad })).toBeUndefined();
    }
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
