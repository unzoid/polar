import { describe, expect, test } from "bun:test";
import {
  aliasTable,
  canonicalId,
  dedupeByTitle,
  formatVideoId,
  parseTitleId,
  parseVideoId,
  sameTitle,
  titleOfVideo,
  type AnimeLink,
} from "../src/lib/identity";

describe("id grammar", () => {
  test("title ids", () => {
    expect(parseTitleId("tt0000103")).toEqual({ kind: "imdb", value: "tt0000103" });
    expect(parseTitleId("kitsu:7442")).toEqual({ kind: "kitsu", value: "7442" });
    expect(parseTitleId("anilist:21")).toEqual({ kind: "anilist", value: "21" });
    expect(parseTitleId("mal:21")).toEqual({ kind: "mal", value: "21" });
    for (const bad of ["", "tt", "kitsu:", "kitsu:x", "tmdb:1", "kitsu:1:2", "tt12:1:1"]) expect(parseTitleId(bad)).toBeNull();
  });

  test("video ids round-trip", () => {
    for (const id of ["tt1", "tt1:2:3", "kitsu:5", "kitsu:5:12"]) expect(formatVideoId(parseVideoId(id)!)).toBe(id);
    expect(parseVideoId("tt1:2")).toBeNull();
    expect(parseVideoId("kitsu:5:x")).toBeNull();
    expect(titleOfVideo("tt1:2:3")).toBe("tt1");
    expect(titleOfVideo("kitsu:5:12")).toBe("kitsu:5");
    expect(titleOfVideo("something-else")).toBe("something-else");
  });
});

const link = (l: Partial<AnimeLink> & Pick<AnimeLink, "canonical" | "anilist">): AnimeLink => ({ updatedAt: 1, ...l });

describe("aliases", () => {
  test("a Kitsu show that gained an IMDb page is one title", () => {
    const aliases = aliasTable([link({ canonical: "tt100", anilist: 1, mal: 2, kitsu: 3 })]);
    expect(canonicalId("kitsu:3", aliases)).toBe("tt100");
    expect(canonicalId("anilist:1", aliases)).toBe("tt100");
    expect(canonicalId("mal:2", aliases)).toBe("tt100");
    expect(sameTitle("kitsu:3", "tt100", aliases)).toBe(true);
  });

  test("Kitsu-only anime is canonical as itself", () => {
    const aliases = aliasTable([link({ canonical: "kitsu:3", anilist: 1, kitsu: 3 })]);
    expect(canonicalId("kitsu:3", aliases)).toBe("kitsu:3");
    expect(canonicalId("anilist:1", aliases)).toBe("kitsu:3");
  });

  test("two IMDb shows are never joined (Paleblade and Hundred-Night Ash War)", () => {
    // One AniList entry first linked to Paleblade's IMDb id, then to HNAW's.
    const aliases = aliasTable([
      link({ canonical: "tt0000103", anilist: 41467, updatedAt: 1 }),
      link({ canonical: "tt0000111", anilist: 41467, updatedAt: 2 }),
    ]);
    expect(canonicalId("anilist:41467", aliases)).toBe("tt0000111");
    expect(canonicalId("tt0000103", aliases)).toBe("tt0000103");
    expect(sameTitle("tt0000103", "tt0000111", aliases)).toBe(false);
  });

  test("the newest link for an alias wins, whatever the input order", () => {
    const a = link({ canonical: "tt1", anilist: 9, kitsu: 5, updatedAt: 5 });
    const b = link({ canonical: "kitsu:5", anilist: 9, kitsu: 5, updatedAt: 1 });
    expect(canonicalId("anilist:9", aliasTable([a, b]))).toBe("tt1");
    expect(canonicalId("anilist:9", aliasTable([b, a]))).toBe("tt1");
  });

  test("chains resolve and loops stop", () => {
    const chain = new Map([
      ["anilist:1", "kitsu:2"],
      ["kitsu:2", "tt3"],
    ]);
    expect(canonicalId("anilist:1", chain)).toBe("tt3");
    const loop = new Map([
      ["kitsu:1", "kitsu:2"],
      ["kitsu:2", "kitsu:1"],
    ]);
    expect(canonicalId("kitsu:1", loop)).toBe("kitsu:1");
  });

  test("dedupe keeps the first of each show", () => {
    const aliases = aliasTable([link({ canonical: "tt100", anilist: 1, kitsu: 3 })]);
    const items = [{ id: "anilist:1", n: "anime card" }, { id: "tt100", n: "cinemeta" }, { id: "tt200", n: "other" }];
    expect(dedupeByTitle(items, (i) => i.id, aliases).map((i) => i.n)).toEqual(["anime card", "other"]);
  });
});
