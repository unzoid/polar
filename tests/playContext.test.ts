import { describe, expect, test } from "bun:test";
import { playContextStore, type KeyValue } from "../src/lib/anime/playContext";

const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("playContext", () => {
  test("an IMDb-numbered episode keeps its absolute number, MAL and Kitsu ids across a restart", () => {
    const disk = memory();
    playContextStore(disk).remember("tt0000102", { mal: 21, kitsu: 12 }, [["tt0000102:2:5", 66]]);
    const again = playContextStore(disk);
    expect(again.episode("tt0000102:2:5")).toEqual({ mal: 21, kitsu: 12, episode: 66 });
    expect(again.altIds("tt0000102:2:5")).toEqual(["kitsu:12:66"]);
    expect(again.episode("tt0000102:2:6")).toBeUndefined();
    expect(again.altIds("tt0000102:2:6")).toBeUndefined();
  });

  test("a Kitsu episode carries its own number and isn't stored per episode", () => {
    const disk = memory();
    const s = playContextStore(disk);
    s.remember("kitsu:7442", { mal: 16498, kitsu: 7442 }, [
      ["kitsu:7442:1", 1],
      ["kitsu:7442:2", 2],
    ]);
    expect(s.episode("kitsu:7442:2")).toEqual({ mal: 16498, kitsu: 7442, episode: 2 });
    expect(s.episode("kitsu:7442:30")?.episode).toBe(30);
    expect(s.altIds("kitsu:7442:2")).toBeUndefined();
    expect(disk.data.values().next().value).not.toContain("kitsu:7442:1");
  });

  test("movies get the Kitsu movie id", () => {
    const s = playContextStore(memory());
    s.remember("tt1", { kitsu: 5 }, []);
    expect(s.altIds("tt1")).toEqual(["kitsu:5"]);
  });

  test("filler by absolute number, kept when the episodes are lined up again", () => {
    const disk = memory();
    const s = playContextStore(disk);
    s.filler("tt9", [3, 2, 3]);
    s.remember("tt9", { mal: 1 }, [
      ["tt9:1:2", 2],
      ["tt9:1:3", 3],
      ["tt9:1:4", 4],
    ]);
    const again = playContextStore(disk);
    expect(again.isFiller("tt9:1:2")).toBe(true);
    expect(again.isFiller("tt9:1:4")).toBe(false);
    expect(again.isFiller("tt8:1:2")).toBe(false);
    again.filler("tt9", []);
    expect(again.isFiller("tt9:1:2")).toBe(false);
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
