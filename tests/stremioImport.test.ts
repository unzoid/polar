import { describe, expect, test } from "bun:test";
import { bitOrder, needsMeta, parseStremioExport, planImport, watchedCount, watchedVideoIds } from "../src/lib/library/stremioImport";
import type { Meta, Video } from "../src/lib/types";

// An invented export, shaped like the file Stremio writes: made-up ids, names and hosts.

/** Stremio's bit layout: lowest bit first, zlib-compressed, base64. */
async function bits(set: number[]): Promise<string> {
  const bytes = new Uint8Array((Math.max(...set) >> 3) + 1);
  for (const i of set) bytes[i >> 3] |= 1 << (i & 7);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return btoa(String.fromCharCode(...new Uint8Array(await new Response(stream).arrayBuffer())));
}

const video = (season: number, episode: number): Video => ({ id: `tt0000001:${season}:${episode}`, title: `Chapter ${episode}`, season, episode });
// Bit order: season 0 first, then season by season.
const videos = [video(2, 1), video(1, 1), video(1, 2), video(1, 3), video(0, 1), video(1, 4), video(1, 5), video(2, 2), video(2, 3)];
const show: Meta = { id: "tt0000001", type: "series", name: "The Lantern Keepers", runtime: "40 min", videos };

function entry(d: Record<string, unknown>) {
  return { _id: "0001", _mtime: "2026-01-01T00:00:00.000Z", user_id: "0001", d: { _mtime: "2026-01-02T00:00:00.000Z", ...d } };
}

async function sample() {
  // Special (bit 0) unwatched, 1:1–1:5 (bits 1–5) and 2:1 (bit 6) watched; anchor 2:1, length 7.
  const watched = `tt0000001:2:1:7:${await bits([1, 2, 3, 4, 5, 6])}`;
  return JSON.stringify({
    user: { _id: "0001", email: "someone@example.com" },
    addons: {
      addons: [
        { transportUrl: "https://catalog.example.org/manifest.json", flags: { protected: true }, manifest: { id: "org.example.catalog", name: "Built-in" } },
        { transportUrl: "https://addon.example.org/TOKEN/manifest.json", flags: {}, manifest: { id: "org.example.one", name: "Example One", description: "Invented." } },
        { transportUrl: "https://two.example.org/manifest.json", flags: {}, manifest: { id: "org.example.two", name: "Example Two" } },
        { transportUrl: "http://other.invalid/manifest.json", flags: {}, manifest: { id: "org.example.one", name: "Again" } },
      ],
    },
    library: [
      entry({
        _id: "tt0000001",
        _ctime: "2025-05-01T10:00:00.000Z",
        type: "series",
        name: "Lantern Keepers",
        poster: "https://images.example.org/1.jpg",
        removed: false,
        temp: false,
        state: { video_id: "tt0000001:2:2", timeOffset: 600_000, duration: 2_400_000, lastWatched: "2026-02-01T20:00:00.000Z", watched },
      }),
      entry({
        _id: "tt0000002",
        _ctime: "2025-06-01T10:00:00.000Z",
        type: "movie",
        name: "Night Ferry",
        removed: true,
        temp: true,
        state: { video_id: "tt0000002", timeOffset: 0, duration: 5_400_000, timesWatched: 1, lastWatched: "2026-01-15T20:00:00.000Z" },
      }),
      // Dismissed from Continue Watching and not in the library: its place isn't kept.
      entry({ _id: "tt0000003", type: "movie", name: "Paper Kite", removed: true, temp: false, state: { video_id: "tt0000003", timeOffset: 90_000, duration: 6_000_000 } }),
      entry({ _id: "kitsu:42", type: "series", name: "Star Orchard", removed: false, temp: false, state: {} }),
      entry({ _id: "other:abc", type: "series", name: "Elsewhere", removed: false, state: {} }),
      entry({ _id: "tt0000004", type: "channel", name: "A channel", removed: false, state: {} }),
    ],
  });
}

describe("Stremio export import (#12)", () => {
  test("reads titles and offers add-ons that aren't built in or installed", async () => {
    const exp = parseStremioExport(await sample(), ["org.example.two"]);
    expect(exp.items.map((i) => i.id)).toEqual(["tt0000001", "tt0000002", "tt0000003", "kitsu:42"]);
    expect(exp.skipped).toEqual({ ids: 1, types: 1, unreadable: 0 });
    expect(exp.addons.map((a) => [a.id, a.name])).toEqual([["org.example.one", "Example One"]]);
    const [first, second, third] = exp.items;
    expect(first).toMatchObject({ inLibrary: true, addedAt: Date.parse("2025-05-01T10:00:00.000Z"), resume: { videoId: "tt0000001:2:2", position: 600, duration: 2400 } });
    expect(second).toMatchObject({ inLibrary: false, watchedMovie: true, resume: undefined });
    expect(third.resume).toBeUndefined();
  });

  test("a film in the library is counted wherever the file keeps it (#152)", () => {
    const film = { _id: "tt0000005", type: "movie", name: "Night Ferry", removed: false, temp: false, _ctime: "2025-03-01T00:00:00.000Z", state: {} };
    // Stremio's own buckets: items keyed by id, recently played titles apart.
    const buckets = parseStremioExport(
      JSON.stringify({
        library: { uid: "0001", items: { tt0000005: film } },
        library_recent: { uid: "0001", items: { "kitsu:42": { _id: "kitsu:42", type: "series", name: "Star Orchard", removed: false, state: {} } } },
      }),
    );
    expect(buckets.items.map((i) => [i.id, i.inLibrary])).toEqual([
      ["tt0000005", true],
      ["kitsu:42", true],
    ]);
    // A wrapper holding the title's id itself, the item without one or a type; other casings; times in ms.
    const wrapped = parseStremioExport(
      JSON.stringify({
        library: [
          { __id: "tt0000006", _id: "0002", _mtimestamp: 1_750_000_000_000, d: { name: "Paper Kite", removed: false, state: { video_id: "tt0000006", timeOffset: 60_000, duration: 6_000_000 } } },
          { _id: "0003", d: { _id: "TT0000007", type: "Movie", name: "Glass Harbour", removed: false, _mtime: 1_760_000_000_000, state: {} } },
          { _id: "0004", d: { type: "movie", name: "No id" } },
        ],
      }),
    );
    expect(wrapped.items.map((i) => [i.id, i.type, i.inLibrary])).toEqual([
      ["tt0000006", "movie", true],
      ["tt0000007", "movie", true],
    ]);
    expect(wrapped.items[0]).toMatchObject({ lastWatched: 1_750_000_000_000, resume: { videoId: "tt0000006", position: 60, duration: 6000 } });
    expect(wrapped.items[1].lastWatched).toBe(1_760_000_000_000);
    expect(wrapped.skipped).toEqual({ ids: 0, types: 0, unreadable: 1 });
  });

  test("a series' ids are kept in Polarity's form, its episodes too", () => {
    const exp = parseStremioExport(
      JSON.stringify([{ _id: "TT0000008", type: "series", removed: true, temp: true, state: { video_id: "TT0000008:1:2", timeOffset: 5_000, duration: 10_000 } }]),
    );
    expect(exp.items[0]).toMatchObject({ id: "tt0000008", inLibrary: false, resume: { videoId: "tt0000008:1:2" } });
  });

  test("a file that isn't an export says so", () => {
    expect(() => parseStremioExport("not json")).toThrow("isn't JSON");
    expect(() => parseStremioExport('{"profiles": []}')).toThrow("isn't a Stremio export");
  });

  test("bits follow Stremio's video order: season 0 first", () => {
    expect(bitOrder(videos).slice(0, 3)).toEqual(["tt0000001:0:1", "tt0000001:1:1", "tt0000001:1:2"]);
  });

  test("watched episodes line up on the anchor, also after the list changed", async () => {
    const field = (await parseStremioExport(await sample())).items[0].watched!;
    expect(await watchedCount(field)).toBe(6);
    const expected = ["tt0000001:1:1", "tt0000001:1:2", "tt0000001:1:3", "tt0000001:1:4", "tt0000001:1:5", "tt0000001:2:1"];
    expect(await watchedVideoIds(field, videos)).toEqual(expected);
    // The special is gone from the list now: the anchor shifts the bits by one.
    expect(await watchedVideoIds(field, videos.filter((v) => v.season > 0))).toEqual(expected);
    // The anchor episode isn't listed at all: nothing can be matched.
    expect(await watchedVideoIds(field, videos.filter((v) => v.id !== "tt0000001:2:1"))).toEqual([]);
  });

  test("the plan keeps Stremio's times and Continue Watching's order", async () => {
    const exp = parseStremioExport(await sample());
    const choice = { library: true, resume: true, watched: true };
    expect(needsMeta(exp.items, choice).map((i) => i.id)).toEqual(["tt0000001"]);
    const plan = await planImport(exp, new Map([["tt0000001", show]]), choice);
    expect(plan.library.map((l) => [l.id, l.addedAt])).toEqual([
      ["tt0000001", Date.parse("2025-05-01T10:00:00.000Z")],
      ["kitsu:42", Date.parse("2026-01-02T00:00:00.000Z")],
    ]);
    const last = Date.parse("2026-02-01T20:00:00.000Z");
    const rows = Object.fromEntries(plan.progress.map((p) => [p.videoId, p]));
    expect(rows["tt0000001:2:2"]).toMatchObject({ position: 600, duration: 2400, season: 2, episode: 2, updatedAt: last, name: "The Lantern Keepers" });
    expect(rows["tt0000001:1:1"]).toMatchObject({ position: 2400, duration: 2400, season: 1, episode: 1, episodeTitle: "Chapter 1" });
    expect(rows["tt0000001:1:1"].updatedAt).toBeLessThan(rows["tt0000001:2:1"].updatedAt);
    expect(rows["tt0000001:2:1"].updatedAt).toBeLessThan(last);
    expect(rows["tt0000002"]).toMatchObject({ position: 1, duration: 1, updatedAt: Date.parse("2026-01-15T20:00:00.000Z") });
    expect(rows["tt0000003"]).toBeUndefined();
    expect(plan.unmatched).toBe(0);
  });

  test("only what was chosen; a show without metadata counts as unmatched", async () => {
    const exp = parseStremioExport(await sample());
    const plan = await planImport(exp, new Map([["tt0000001", null]]), { library: false, resume: false, watched: true });
    expect(plan.library).toEqual([]);
    expect(plan.progress.map((p) => p.videoId)).toEqual(["tt0000002"]);
    expect(plan.unmatched).toBe(1);
  });
});
