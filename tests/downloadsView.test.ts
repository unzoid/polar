import { describe, expect, test } from "bun:test";
import {
  activeProgress,
  bytesOnDisk,
  downloadsSummary,
  filterTitles,
  groupDownloads,
  keepOpen,
  readDownloadsView,
  saveDownloadsView,
  sortTitles,
  watchedIds,
  watchedSet,
} from "../src/lib/library/downloadsView";
import type { Download } from "../src/lib/library/downloads";
import type { Progress } from "../src/lib/types";

const GB = 1_000_000_000;
const ep = (show: string, name: string, season: number, episode: number, extra: Partial<Download> = {}): Download => ({
  id: `${show}:${season}:${episode}`,
  metaId: show,
  type: "series",
  name,
  season,
  episode,
  quality: "1080p",
  file: `/downloads/${show}-${season}-${episode}.mkv`,
  received: GB,
  total: GB,
  state: "done",
  addedAt: 1000 + season * 10 + episode,
  ...extra,
});
const movie = (id: string, name: string, extra: Partial<Download> = {}): Download => ({
  id,
  metaId: id,
  type: "movie",
  name,
  quality: "1080p",
  file: `/downloads/${id}.mkv`,
  received: 2 * GB,
  total: 2 * GB,
  state: "done",
  addedAt: 500,
  ...extra,
});

const list = [
  ep("tt0000001", "The Lantern Keepers", 2, 1),
  ep("tt0000001", "The Lantern Keepers", 1, 2),
  ep("tt0000001", "The Lantern Keepers", 0, 1),
  ep("tt0000001", "The Lantern Keepers", 1, 1),
  ep("tt0000002", "Amélie's Orchard", 1, 1, { addedAt: 9000, total: 3 * GB, received: 3 * GB }),
  movie("tt0000003", "Northbound"),
];

describe("downloads grouped by title (#15)", () => {
  const watched = new Set(["tt0000001:1:1", "tt0000003"]);
  const titles = groupDownloads(list, watched, new Map([["tt0000003", 7000]]));

  test("one group per title, episodes in order with specials last", () => {
    expect(titles.map((t) => t.name)).toEqual(["The Lantern Keepers", "Amélie's Orchard", "Northbound"]);
    expect(titles[0].items.map((d) => d.id)).toEqual(["tt0000001:1:1", "tt0000001:1:2", "tt0000001:2:1", "tt0000001:0:1"]);
  });

  test("seasons only for a show spanning more than one, with their totals", () => {
    expect(titles[0].seasons.map((s) => [s.season, s.items.length, s.bytes, s.unwatched])).toEqual([
      [1, 2, 2 * GB, 1],
      [2, 1, GB, 1],
      [0, 1, GB, 1],
    ]);
    expect(titles[1].seasons).toEqual([]);
    expect(titles[2].seasons).toEqual([]);
  });

  test("totals, unwatched counts and dates per title", () => {
    expect(titles[0]).toMatchObject({ bytes: 4 * GB, unwatched: 3, addedAt: 1021, watchedAt: 0 });
    expect(titles[2]).toMatchObject({ bytes: 2 * GB, unwatched: 0, watchedAt: 7000 });
  });

  test("sorts: newest download first, title A-Z, biggest first, last watched first", () => {
    const names = (sort: Parameters<typeof sortTitles>[1]) => sortTitles(titles, sort).map((t) => t.name);
    expect(names("recent")).toEqual(["Amélie's Orchard", "The Lantern Keepers", "Northbound"]);
    expect(names("title")).toEqual(["Amélie's Orchard", "Northbound", "The Lantern Keepers"]);
    expect(names("size")).toEqual(["The Lantern Keepers", "Amélie's Orchard", "Northbound"]);
    expect(names("watched")).toEqual(["Northbound", "Amélie's Orchard", "The Lantern Keepers"]);
  });

  test("filters by kind and searches names and episode titles, ignoring case and accents", () => {
    expect(filterTitles(titles, "movie", "").map((t) => t.name)).toEqual(["Northbound"]);
    expect(filterTitles(titles, "series", "").length).toBe(2);
    expect(filterTitles(titles, "all", "AMELIE").map((t) => t.name)).toEqual(["Amélie's Orchard"]);
    const titled = groupDownloads([ep("tt0000004", "Small Hours", 1, 1, { episodeTitle: "Low Tide" })], new Set(), new Map());
    expect(filterTitles(titled, "all", "low tide").length).toBe(1);
  });

  test("Delete Watched takes only what's been watched", () => {
    expect(watchedIds(titles[0].items, watched)).toEqual(["tt0000001:1:1"]);
  });
});

describe("totals and watched marks", () => {
  test("a download still coming down counts what has arrived", () => {
    const moving = movie("tt0000005", "Copper Sky", { state: "downloading", received: GB / 2, total: 2 * GB });
    expect(bytesOnDisk(moving)).toBe(GB / 2);
    expect(downloadsSummary([...list, moving])).toEqual({ count: 7, bytes: 9.5 * GB });
  });

  test("overall progress over the downloads whose size is known", () => {
    const a = movie("a", "A", { state: "downloading", received: GB, total: 2 * GB });
    const b = movie("b", "B", { state: "paused", received: 0, total: 2 * GB });
    const c = movie("c", "C", { state: "downloading", received: 5, total: undefined });
    expect(activeProgress([a, b, c])).toBe(0.25);
    expect(activeProgress([c])).toBeUndefined();
  });

  test("watched at the threshold, from the titles' progress", () => {
    const p = (videoId: string, position: number, duration: number) => ({ videoId, position, duration }) as Progress;
    expect([...watchedSet([p("a", 90, 100), p("b", 89, 100), p("c", 5, 0)], 0.9)]).toEqual(["a"]);
  });
});

describe("the page's saved view", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  test("saved and read back; anything unknown falls back to the default", () => {
    const s = memory();
    expect(readDownloadsView(s)).toEqual({ open: [], sort: "recent", filter: "all" });
    saveDownloadsView({ open: ["tt0000001"], sort: "size", filter: "series" }, s);
    expect(readDownloadsView(s)).toEqual({ open: ["tt0000001"], sort: "size", filter: "series" });
    s.setItem("polar.downloads.view", JSON.stringify({ open: [1, "x"], sort: "nope", filter: 3 }));
    expect(readDownloadsView(s)).toEqual({ open: ["x"], sort: "recent", filter: "all" });
    s.setItem("polar.downloads.view", "{broken");
    expect(readDownloadsView(s).sort).toBe("recent");
  });

  test("open groups that are gone are forgotten", () => {
    const titles = groupDownloads(list, new Set(), new Map());
    expect(keepOpen(["tt0000001", "tt0000001/2", "tt0000009", "tt0000002/1"], titles)).toEqual(["tt0000001", "tt0000001/2"]);
  });
});
