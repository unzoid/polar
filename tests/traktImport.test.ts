import { describe, expect, test } from "bun:test";
import { planTraktImport, readTraktImport, watchedEpisodes, watchedFilm } from "../src/lib/trakt/traktImport";

// #85: importing a linked Trakt account's watchlist and everything watched into the library.
const film = (imdb: string | undefined, title = "Night Train") => ({ title, ids: { trakt: 1, ...(imdb ? { imdb } : {}) } });

const watchlist = [
  { type: "movie", listed_at: "2026-01-02T00:00:00.000Z", movie: film("tt0000001") },
  { type: "show", listed_at: "2026-01-03T00:00:00.000Z", show: film("tt0000002", "Harbour Lights") },
  // A season of the same show listed earlier stands for the show, at its own time.
  { type: "season", listed_at: "2026-01-01T00:00:00.000Z", season: { number: 2 }, show: film("tt0000002", "Harbour Lights") },
  { type: "movie", listed_at: "2026-01-04T00:00:00.000Z", movie: film(undefined) },
];
const watchedMovies = [
  { plays: 2, last_watched_at: "2026-02-01T00:00:00.000Z", movie: film("tt0000003", "Paper Moon Lane") },
  { plays: 1, last_watched_at: "2026-02-02T00:00:00.000Z", movie: film(undefined) },
];
const watchedShows = [
  {
    plays: 3,
    last_watched_at: "2026-03-01T00:00:00.000Z",
    show: film("tt0000002", "Harbour Lights"),
    seasons: [
      { number: 0, episodes: [{ number: 1, plays: 1, last_watched_at: "2026-02-20T00:00:00.000Z" }] },
      { number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: "2026-02-21T00:00:00.000Z" }, { number: 2, plays: 1 }, { number: 0 }] },
    ],
  },
  { plays: 1, last_watched_at: "2026-03-01T00:00:00.000Z", show: film(undefined), seasons: [{ number: 1, episodes: [{ number: 1 }] }] },
];

function account(pages: unknown[][] = [watchlist]) {
  const asked: string[] = [];
  const get = async (path: string, caller: { token?: string }) => {
    asked.push(`${caller.token} ${path}`);
    if (path.startsWith("/sync/watchlist")) return pages[Number(/page=(\d+)/.exec(path)![1]) - 1] ?? [];
    if (path === "/sync/watched/movies") return watchedMovies;
    if (path === "/sync/watched/shows") return watchedShows;
    throw new Error(path);
  };
  return { asked, deps: { get } };
}

describe("reading a Trakt account for the import", () => {
  test("watchlist titles become library items, watched films and episodes watched marks; titles without an IMDb id are counted and left out", async () => {
    const { asked, deps } = account();
    const p = await readTraktImport("TOKEN", deps);
    expect(asked).toEqual([
      "TOKEN /sync/watchlist?sort_by=added&sort_how=asc&page=1&limit=100",
      "TOKEN /sync/watched/movies",
      "TOKEN /sync/watched/shows",
    ]);
    expect(p.library).toEqual([
      { id: "tt0000001", type: "movie", name: "Night Train", addedAt: Date.parse("2026-01-02T00:00:00.000Z") },
      { id: "tt0000002", type: "series", name: "Harbour Lights", addedAt: Date.parse("2026-01-01T00:00:00.000Z") },
    ]);
    expect(p.progress.map((r) => [r.videoId, r.updatedAt])).toEqual([
      ["tt0000003", Date.parse("2026-02-01T00:00:00.000Z")],
      ["tt0000002:0:1", Date.parse("2026-02-20T00:00:00.000Z")],
      ["tt0000002:1:1", Date.parse("2026-02-21T00:00:00.000Z")],
      // No time of its own: the show's last watch.
      ["tt0000002:1:2", Date.parse("2026-03-01T00:00:00.000Z")],
    ]);
    expect(p).toMatchObject({ listedFilms: 1, listedShows: 1, watchedFilms: 1, watchedEpisodes: 3, unlinked: 3 });
  });

  test("a long watchlist is read page by page until a short one", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ type: "movie", listed_at: "2026-01-02T00:00:00.000Z", movie: film(`tt1${String(i).padStart(6, "0")}`) }));
    const { asked, deps } = account([full, watchlist.slice(0, 1)]);
    const p = await readTraktImport("TOKEN", deps);
    expect(asked.filter((a) => a.includes("/sync/watchlist"))).toHaveLength(2);
    expect(p.listedFilms).toBe(101);
  });

  test("the plan hands over only what was chosen", async () => {
    const p = await readTraktImport("TOKEN", account().deps);
    expect(planTraktImport(p, { library: true, watched: false })).toEqual({ library: p.library, progress: [] });
    expect(planTraktImport(p, { library: false, watched: true })).toEqual({ library: [], progress: p.progress });
  });

  test("odd answers are skipped, not thrown", () => {
    expect(watchedFilm({ movie: film("tt0000001") })).toBeUndefined();
    expect(watchedFilm(null)).toBeUndefined();
    expect(watchedEpisodes({ show: film("tt0000002"), seasons: "x" })).toEqual([]);
    expect(watchedEpisodes({ show: film("tt0000002"), seasons: [{ number: -1, episodes: [{ number: 1, last_watched_at: "2026-01-01T00:00:00.000Z" }] }] })).toEqual([]);
  });
});
