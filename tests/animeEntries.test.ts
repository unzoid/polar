import { describe, expect, test } from "bun:test";
import { entryMeta, entryStore, runsOf } from "../src/lib/anime/entries";
import { cardsShown } from "../src/lib/anime/franchise";
import type { AnimeCard } from "../src/lib/anime/anilist";
import type { KeyValue } from "../src/lib/anime/playContext";

const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

const eps = (title: string, season: number, from: number, to: number, number = 1): [string, number][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [`${title}:${season}:${from + i}`, number + i]);

const tower = { english: "Tower of Glass" };
const tower2 = { english: "Tower of Glass Season 2" };
const towerB = { english: "Tower of Glass Part 2" };

describe("anime entries (#22, seasons as separate shows)", () => {
  test("an entry's episodes are kept as runs of consecutive episodes", () => {
    expect(runsOf("tt0000101", eps("tt0000101", 1, 1, 12))).toEqual([[1, 1, 12, 1]]);
    // The second cour of a season, numbered from 1 within its entry.
    expect(runsOf("tt0000101", eps("tt0000101", 1, 13, 24))).toEqual([[1, 13, 24, 1]]);
    // A gap, a jump in the entry's numbering, another season, a duplicate, another title: each starts a run or is left out.
    expect(
      runsOf("tt0000101", [
        ...eps("tt0000101", 1, 1, 3),
        ["tt0000101:1:5", 5],
        ["tt0000101:1:6", 9],
        ["tt0000101:2:1", 10],
        ["tt0000101:2:1", 10],
        ["tt0000999:1:1", 1],
        ["tt0000101", 1],
      ]),
    ).toEqual([
      [1, 1, 3, 1],
      [1, 5, 5, 5],
      [1, 6, 6, 9],
      [2, 1, 1, 10],
    ]);
    expect(
      runsOf("kitsu:12", [
        ["kitsu:12:1", 1],
        ["kitsu:12:2", 2],
      ]),
    ).toEqual([[0, 1, 2, 1]]);
  });

  test("a video of a stored title says which entry it's part of, and its number there, across a restart", () => {
    const disk = memory();
    const s = entryStore(disk, () => 1);
    s.remember("tt0000101", 11, { title: tower, cover: "https://media.example.com/1.jpg" }, eps("tt0000101", 1, 1, 12));
    s.remember("tt0000101", 12, { title: towerB }, eps("tt0000101", 1, 13, 24));
    s.remember("tt0000101", 13, { title: tower2 }, eps("tt0000101", 2, 1, 12, 1));
    const again = entryStore(disk);
    expect(again.entryAt("tt0000101:1:3")).toEqual({ anilist: 11, title: tower, cover: "https://media.example.com/1.jpg", number: 3 });
    expect(again.entryAt("tt0000101:1:14")).toEqual({ anilist: 12, title: towerB, cover: undefined, number: 2 });
    expect(again.entryAt("tt0000101:2:12")?.anilist).toBe(13);
    // Not lined up here: the card shows as stored.
    expect(again.entryAt("tt0000101:3:1")).toBeUndefined();
    expect(again.entryAt("tt0000102:1:1")).toBeUndefined();
    expect(again.entryAt("tt0000101")).toBeUndefined();
    expect(again.entry("tt0000101", 12)?.runs).toEqual([[1, 13, 24, 1]]);
    expect(again.entry("tt0000101", 99)).toBeUndefined();
  });

  test("when two entries claim an episode, the one lined up last wins", () => {
    let t = 1;
    const s = entryStore(memory(), () => t);
    s.remember("tt0000101", 11, { title: tower }, eps("tt0000101", 1, 1, 24));
    t = 2;
    s.remember("tt0000101", 12, { title: towerB }, eps("tt0000101", 1, 13, 24));
    expect(s.entryAt("tt0000101:1:20")?.anilist).toBe(12);
    expect(s.entryAt("tt0000101:1:2")?.anilist).toBe(11);
  });

  test("a damaged store is read as far as it fits", () => {
    const disk = memory();
    disk.setItem(
      "polar.animeEntries.v1",
      JSON.stringify({ tt0000101: { "11": { title: tower, runs: [[1, 1, 12, 1], ["x"]], at: 1 }, bad: { title: tower, runs: [] } }, tt0000102: 5 }),
    );
    const s = entryStore(disk);
    expect(s.entry("tt0000101", 11)?.runs).toEqual([[1, 1, 12, 1]]);
    expect(s.entryAt("tt0000101:1:12")?.number).toBe(12);
  });
});

describe("a title's page as one entry's (TV mode, #22)", () => {
  test("only the entry's episodes, as one season numbered as in the entry, each keeping its video id", () => {
    const video = (season: number, episode: number) => ({ id: `tt0000101:${season}:${episode}`, title: `Episode ${episode}`, season, episode });
    const meta = {
      id: "tt0000101",
      name: "Tower of Glass",
      poster: "https://media.example.com/show.jpg",
      background: "https://media.example.com/show-bg.jpg",
      logo: "https://media.example.com/logo.png",
      videos: [video(1, 12), video(1, 13), video(1, 24), video(2, 1)],
    };
    const s = entryStore(memory());
    const shown = { title: towerB, cover: "https://media.example.com/2.jpg", banner: "https://media.example.com/2-bg.jpg" };
    s.remember("tt0000101", 12, shown, eps("tt0000101", 1, 13, 24));
    const page = entryMeta(meta, s.entry("tt0000101", 12)!, "Tower of Glass Part 2");
    expect(page.name).toBe("Tower of Glass Part 2");
    expect(page.poster).toBe("https://media.example.com/2.jpg");
    // Its own banner, not the title's background every season shares (#194).
    expect(page.background).toBe("https://media.example.com/2-bg.jpg");
    expect(page.logo).toBeUndefined();
    expect(page.videos.map((v) => [v.id, v.season, v.episode])).toEqual([
      ["tt0000101:1:13", 1, 1],
      ["tt0000101:1:24", 1, 12],
    ]);
  });
});

describe("cards shown in anime lists (#22)", () => {
  const card = (id: number, english: string, chain: number[] = []): AnimeCard => ({ id, title: { english }, coverImage: {}, chain });
  const list = [card(1, "Tower of Glass", [2]), card(2, "Tower of Glass Season 2", [1]), card(3, "Paper Moon")];

  test("one card per franchise by default, every entry with seasons as separate shows", () => {
    expect(cardsShown(list, false).map((a) => a.id)).toEqual([1, 3]);
    expect(cardsShown(list, true).map((a) => a.id)).toEqual([1, 2, 3]);
  });
});

test("an entry kept before banners were stored keeps the title's background on its page (#194)", () => {
  const storage = memory();
  const old = { title: towerB, cover: "https://media.example.com/2.jpg", runs: [[1, 13, 24, 1]], at: 1 };
  storage.setItem("polar.animeEntries.v1", JSON.stringify({ tt0000101: { 12: old } }));
  const record = entryStore(storage).entry("tt0000101", 12)!;
  expect(record.banner).toBeUndefined();
  const meta = { name: "Tower of Glass", background: "https://media.example.com/show-bg.jpg", videos: [] };
  expect(entryMeta(meta, record, "Tower of Glass Part 2").background).toBe("https://media.example.com/show-bg.jpg");
});
