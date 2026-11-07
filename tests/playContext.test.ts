import { describe, expect, test } from "bun:test";
import { playContextStore, type KeyValue } from "../src/lib/anime/playContext";

const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("playContext", () => {
  test("an IMDb-numbered episode keeps its number, MAL and Kitsu ids across a restart", () => {
    const disk = memory();
    playContextStore(disk).remember("tt0000102", { mal: 21, kitsu: 12 }, [["tt0000102:2:5", 66]]);
    const again = playContextStore(disk);
    expect(again.episode("tt0000102:2:5")).toEqual({ mal: 21, kitsu: 12, episode: 66 });
    expect(again.altIds("tt0000102:2:5")).toEqual(["kitsu:12:66"]);
    expect(again.episode("tt0000102:2:6")).toBeUndefined();
    expect(again.altIds("tt0000102:2:6")).toBeUndefined();
  });

  test("#83, #84: each episode keeps its AniList and MAL entry and that entry's episode count, across a restart", () => {
    const disk = memory();
    const s = playContextStore(disk);
    s.remember("tt0000104", { mal: 51, kitsu: 61, anilist: 71, count: 2 }, [
      ["tt0000104:1:1", 1],
      ["tt0000104:1:2", 2],
    ]);
    s.remember("tt0000104", { kitsu: 62, anilist: 72 }, [["tt0000104:2:1", 1]]);
    const again = playContextStore(disk);
    expect(again.listEpisode("tt0000104:1:2")).toEqual({ anilist: 71, mal: 51, episode: 2, total: 2 });
    expect(again.listEpisode("tt0000104:2:1")).toEqual({ anilist: 72, episode: 1, total: null });
    expect(again.episode("tt0000104:1:2")).toEqual({ mal: 51, kitsu: 61, episode: 2 });
    // Lined up with a MAL id only: a MAL list can still be told.
    s.remember("tt0000105", { mal: 1 }, [["tt0000105:1:1", 1]]);
    expect(s.listEpisode("tt0000105:1:1")).toEqual({ mal: 1, episode: 1, total: null });
    // Neither id (a Kitsu-only entry): nothing to tell a list.
    s.remember("tt0000107", { kitsu: 3 }, [["tt0000107:1:1", 1]]);
    expect(s.listEpisode("tt0000107:1:1")).toBeUndefined();
    expect(s.listEpisode("tt0000104:3:1")).toBeUndefined();
  });

  test("a Kitsu episode carries its own number and Kitsu id", () => {
    const disk = memory();
    const s = playContextStore(disk);
    s.remember("kitsu:7442", { mal: 16498, kitsu: 7442 }, [
      ["kitsu:7442:1", 1],
      ["kitsu:7442:2", 2],
    ]);
    expect(s.episode("kitsu:7442:2")).toEqual({ mal: 16498, kitsu: 7442, episode: 2 });
    expect(s.episode("kitsu:7442:30")).toEqual({ mal: 16498, kitsu: 7442, episode: 30 });
    expect(s.altIds("kitsu:7442:2")).toBeUndefined();
  });

  test("#225: each entry of one IMDb show keeps its own Kitsu id and numbering", () => {
    const disk = memory();
    const s = playContextStore(disk);
    // Two cours under one IMDb season: the first entry is episodes 1-3, the second 4-6 counted from 1 again.
    s.remember("tt0000103", { mal: 31, kitsu: 41, count: 3 }, [
      ["tt0000103:1:1", 1, 1],
      ["tt0000103:1:2", 2, 2],
      ["tt0000103:1:3", 3, 3],
    ]);
    s.remember("tt0000103", { mal: 32, kitsu: 42, count: 3 }, [
      ["tt0000103:1:4", 1, 4],
      ["tt0000103:1:5", 2, 5],
      ["tt0000103:1:6", 3, 6],
    ]);
    const again = playContextStore(disk);
    // Opening the second entry's page last doesn't ask for the first entry's episodes by the second's id.
    expect(again.altIds("tt0000103:1:2")).toEqual(["kitsu:41:2"]);
    expect(again.altIds("tt0000103:1:5")).toEqual(["kitsu:42:2"]);
    expect(again.episode("tt0000103:1:2")).toEqual({ mal: 31, kitsu: 41, episode: 2 });
    expect(again.absolute("tt0000103:1:5")).toBe(5);
    // Lining an entry up again replaces only its own episodes.
    again.remember("tt0000103", { mal: 32, kitsu: 42, count: 3 }, [["tt0000103:1:4", 1, 4]]);
    expect(again.altIds("tt0000103:1:5")).toBeUndefined();
    expect(again.altIds("tt0000103:1:1")).toEqual(["kitsu:41:1"]);
  });

  test("#225: numbers that would ask for another episode are thrown away", () => {
    const s = playContextStore(memory());
    s.remember("tt0000104", { kitsu: 51, count: 12 }, [
      // Past the entry's 12 episodes: counted across the franchise.
      ["tt0000104:2:1", 13],
      // Two videos on one number, and one video on two numbers.
      ["tt0000104:1:5", 5],
      ["tt0000104:1:6", 5],
      ["tt0000104:1:7", 7],
      ["tt0000104:1:7", 8],
      ["tt0000104:1:9", 9],
    ]);
    expect(s.altIds("tt0000104:2:1")).toBeUndefined();
    expect(s.altIds("tt0000104:1:5")).toBeUndefined();
    expect(s.altIds("tt0000104:1:6")).toBeUndefined();
    expect(s.altIds("tt0000104:1:7")).toBeUndefined();
    expect(s.altIds("tt0000104:1:9")).toEqual(["kitsu:51:9"]);
  });

  test("#225: a number an older version kept without its entry is never asked by", () => {
    const disk = memory();
    disk.data.set("polar.animePlayContext.v1", JSON.stringify({ tt0000105: { mal: 61, kitsu: 71, eps: { "tt0000105:2:5": 17 }, filler: [17], at: 1 } }));
    const s = playContextStore(disk);
    expect(s.altIds("tt0000105:2:5")).toBeUndefined();
    // AniSkip and skip-filler keep working with it until the page lines the show up again.
    expect(s.episode("tt0000105:2:5")).toEqual({ mal: 61, kitsu: undefined, episode: 17 });
    expect(s.isFiller("tt0000105:2:5")).toBe(true);
    s.remember("tt0000105", { mal: 62, kitsu: 72, count: 12 }, [["tt0000105:2:5", 5]]);
    expect(s.altIds("tt0000105:2:5")).toEqual(["kitsu:72:5"]);
    expect(s.isFiller("tt0000105:2:5")).toBe(false);
  });

  test("movies get the Kitsu movie id", () => {
    const s = playContextStore(memory());
    s.remember("tt1", { kitsu: 5 }, []);
    expect(s.altIds("tt1")).toEqual(["kitsu:5"]);
  });

  test("filler by video, kept when the episodes are lined up again; each entry sets its own", () => {
    const disk = memory();
    const s = playContextStore(disk);
    s.filler("tt9", ["tt9:1:2", "tt9:1:3", "tt9:1:4"], ["tt9:1:3", "tt9:1:2", "tt9:1:3"]);
    s.remember("tt9", { mal: 1 }, [
      ["tt9:1:2", 2],
      ["tt9:1:3", 3],
      ["tt9:1:4", 4],
    ]);
    // Another entry of the same show: its flags don't touch the first one's.
    s.filler("tt9", ["tt9:2:1"], ["tt9:2:1"]);
    const again = playContextStore(disk);
    expect(again.isFiller("tt9:1:2")).toBe(true);
    expect(again.isFiller("tt9:2:1")).toBe(true);
    expect(again.isFiller("tt9:1:4")).toBe(false);
    expect(again.isFiller("tt8:1:2")).toBe(false);
    again.filler("tt9", ["tt9:1:2", "tt9:1:3", "tt9:1:4"], []);
    expect(again.isFiller("tt9:1:2")).toBe(false);
    expect(again.isFiller("tt9:2:1")).toBe(true);
  });

  test("keeps the most recently opened titles when there are too many", () => {
    const disk = memory();
    let t = 0;
    const s = playContextStore(disk, () => ++t);
    for (let i = 0; i < 310; i++) s.remember(`kitsu:${i}`, { mal: i }, []);
    const saved = JSON.parse(disk.data.values().next().value!) as Record<string, unknown>;
    expect(Object.keys(saved).length).toBe(300);
    expect(saved["kitsu:0"]).toBeUndefined();
    expect(saved["kitsu:309"]).toBeDefined();
  });

  test("unreadable storage starts empty", () => {
    const disk = memory();
    disk.data.set("polar.animePlayContext.v1", "{not json");
    expect(playContextStore(disk).episode("tt1:1:1")).toBeUndefined();
    expect(playContextStore(undefined).isFiller("tt1:1:1")).toBe(false);
  });
});
