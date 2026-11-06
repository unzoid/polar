import { describe, expect, test } from "bun:test";
import { decodeEntries, encodeEntries, newestAt, type EntryToPack, type ProgressEntry } from "../src/lib/account/progressCodec";

const T = 1_762_000_000_000;

const roundTrip = (meta: string, entries: ProgressEntry[]) => decodeEntries(meta, encodeEntries(meta, entries), newestAt(entries));
const byId = (entries: ProgressEntry[] | null) => [...(entries ?? [])].sort((a, b) => a.videoId.localeCompare(b.videoId));

describe("progress entries codec", () => {
  test("every id form round-trips with its numbers and times", () => {
    const entries: ProgressEntry[] = [
      { videoId: "tt0000105:1:2", season: 1, episode: 2, position: 1234, duration: 3300, updatedAt: T },
      { videoId: "tt0000105:0:10", season: 0, episode: 10, position: 0, duration: 0, updatedAt: T - 5_000 },
      { videoId: "tt0000105", position: 60, duration: 7200, updatedAt: T - 1 },
      { videoId: "tt0000105:7", episode: 7, position: 5, duration: 1440, updatedAt: T - 86_400_000 },
      { videoId: "tt0000105:7b", season: 2, episode: 3, position: 9, duration: 10, updatedAt: T - 2 },
      { videoId: "kitsu:1:5", episode: 5, position: 9, duration: 10, updatedAt: T - 3 },
    ];
    expect(byId(roundTrip("tt0000105", entries))).toEqual(byId(entries));
  });

  test("a film from the native store (season and episode null) packs as one without them, and stays the same", () => {
    // Rust writes a missing Option as null (#94).
    const native: EntryToPack[] = [
      { videoId: "tt0000106", season: null, episode: null, position: 60, duration: 7200, updatedAt: T },
      { videoId: "tt0000106:extra", season: null, episode: null, position: 5, duration: 10, updatedAt: T - 1 },
    ];
    const bytes = encodeEntries("tt0000106", native);
    const film = [
      { videoId: "tt0000106", position: 60, duration: 7200, updatedAt: T },
      { videoId: "tt0000106:extra", position: 5, duration: 10, updatedAt: T - 1 },
    ];
    expect(bytes).toEqual(encodeEntries("tt0000106", film));
    const back = decodeEntries("tt0000106", bytes, T)!;
    expect(byId(back)).toEqual(byId(film));
    expect(encodeEntries("tt0000106", back)).toEqual(bytes);
  });

  test("numbers that differ from the id's are kept as given", () => {
    const entries: ProgressEntry[] = [
      { videoId: "kitsu:1:5", season: 1, episode: 17, position: 1, duration: 2, updatedAt: T },
      { videoId: "kitsu:1:01:2", season: 1, episode: 2, position: 1, duration: 2, updatedAt: T },
      { videoId: "kitsu:1:3:4", position: 1, duration: 2, updatedAt: T },
      { videoId: "kitsu:1:6", season: 3, episode: 6, position: 1, duration: 2, updatedAt: T },
    ];
    expect(byId(roundTrip("kitsu:1", entries))).toEqual(byId(entries));
  });

  test("a typical episode takes about 10 bytes", () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      videoId: `tt0000105:${1 + Math.floor(i / 10)}:${1 + (i % 10)}`,
      season: 1 + Math.floor(i / 10),
      episode: 1 + (i % 10),
      position: 1234.6,
      duration: 3300.2,
      updatedAt: T - i * 86_400_000,
    }));
    const bytes = encodeEntries("tt0000105", entries);
    expect(bytes.length).toBeLessThan(25 * 12);
    expect(decodeEntries("tt0000105", bytes, T)?.find((e) => e.episode === 1)?.position).toBe(1235);
  });

  test("a video listed twice keeps its newest entry; seconds are whole", () => {
    const out = roundTrip("tt1", [
      { videoId: "tt1", position: 10.4, duration: 99.5, updatedAt: T - 10 },
      { videoId: "tt1", position: 20.6, duration: -1, updatedAt: T },
    ]);
    expect(out).toEqual([{ videoId: "tt1", position: 21, duration: 0, updatedAt: T }]);
  });

  test("the same entries in any order give the same bytes", () => {
    const a: ProgressEntry = { videoId: "tt1:1:2", season: 1, episode: 2, position: 1, duration: 2, updatedAt: T };
    const b: ProgressEntry = { videoId: "tt1:1:10", season: 1, episode: 10, position: 1, duration: 2, updatedAt: T - 1 };
    const c: ProgressEntry = { videoId: "x", position: 1, duration: 2, updatedAt: T - 2 };
    expect(encodeEntries("tt1", [a, b, c])).toEqual(encodeEntries("tt1", [c, b, a]));
  });

  test("unknown versions and broken bytes decode to null, never to a partial list", () => {
    const good = encodeEntries("tt1", [{ videoId: "tt1:1:1", season: 1, episode: 1, position: 1, duration: 2, updatedAt: T }]);
    expect(decodeEntries("tt1", Uint8Array.from([2, ...good.slice(1)]), T)).toBeNull();
    expect(decodeEntries("tt1", good.slice(0, good.length - 1), T)).toBeNull();
    expect(decodeEntries("tt1", Uint8Array.from([1, 3, 5, 0x61]), T)).toBeNull();
    expect(decodeEntries("tt1", Uint8Array.from([1, 0x30, 0, 0, 0]), T)).toBeNull();
    expect(decodeEntries("tt1", new Uint8Array(), T)).toBeNull();
    expect(decodeEntries("tt1", Uint8Array.from([1]), T)).toEqual([]);
  });
});
