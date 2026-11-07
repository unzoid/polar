import "./storageStub";
import { afterEach, describe, expect, test } from "bun:test";
import type { SimklLink } from "../src/lib/simkl/link";
import { simklPageUrl } from "../src/lib/simkl/page";
import { forgetSimklSeen, pullSimkl, simklItems, simklItemsKey, simklSeenKey, type SimklPullDeps } from "../src/lib/simkl/pull";
import { enqueueSimkl, flushSimkl, pendingSimklOps, readSimklOp } from "../src/lib/simkl/queue";
import { simklRatingRows, simklRatings, simklRatingsKey } from "../src/lib/simkl/ratings";
import { rateSimkl, setSimklSpace, setSimklStatus, setSimklSyncDeps } from "../src/lib/simkl/simklSync";

// #86: a title's list and rating on Simkl, from its page, and the ratings read from Simkl.
const link: SimklLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: 2e12, account: 42, name: "Someone" };

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

const T0 = "2026-03-01T00:00:00Z";
const T1 = "2026-03-02T00:00:00Z";
const T2 = "2026-03-03T00:00:00Z";

function acts(all: string, rated: Partial<Record<"tv_shows" | "movies" | "anime", string>> = {}) {
  const kind = (k: "tv_shows" | "movies" | "anime") => ({ all, ...(rated[k] ? { rated_at: rated[k] } : {}) });
  return { all, tv_shows: kind("tv_shows"), movies: kind("movies"), anime: kind("anime") };
}

const rated = (key: "movie" | "show", ids: Record<string, unknown>, user_rating: unknown) => ({
  user_rating,
  user_rated_at: T1,
  [key]: { title: "The Lantern Keepers", ids },
});

function pullDeps(answers: (path: string, query: Record<string, string>) => unknown) {
  const storage = memory();
  const got: string[] = [];
  const d: SimklPullDeps = {
    storage,
    get: async (path, query) => {
      got.push(`${path}?${new URLSearchParams(query)}`);
      return answers(path, query);
    },
    importLibrary: async () => {},
    quotaLow: () => false,
  };
  return { d, storage, got };
}

describe("ratings read from Simkl", () => {
  test("rows by every Polarity id a title has; out-of-range scores dropped; null is a rating taken off", () => {
    expect(
      simklRatingRows({
        movies: [rated("movie", { simkl: 1, imdb: "tt0000001" }, 8), rated("movie", { simkl: 2, imdb: "tt0000004" }, 11)],
        shows: [rated("show", { simkl: 3, imdb: "tt0000002", kitsu: 5 }, null)],
        anime: [rated("show", { simkl: 4, imdb: "tt0000003", kitsu: 6 }, 10), rated("show", { simkl: 5 }, 7)],
      }),
    ).toEqual([
      ["tt0000001", 8],
      ["tt0000002", null],
      ["kitsu:6", 10],
      ["tt0000003", 10],
    ]);
    expect(simklRatingRows(null)).toEqual([]);
  });

  test("the first look reads every kind's ratings whole and keeps them", async () => {
    const { d, storage } = pullDeps((path) => {
      if (path === "/sync/activities") return acts(T0);
      if (path === "/sync/ratings/movies/1,2,3,4,5,6,7,8,9,10") return { movies: [rated("movie", { imdb: "tt0000001" }, 8)] };
      if (path === "/sync/ratings/anime/1,2,3,4,5,6,7,8,9,10") return { anime: [rated("show", { kitsu: 6 }, 9)] };
      return {};
    });
    expect(simklRatings("p", storage)).toBeUndefined();
    await pullSimkl("p", link, d);
    expect(simklRatings("p", storage)).toEqual({ tt0000001: 8, "kitsu:6": 9 });
  });

  test("later looks read only the kinds whose ratings moved, since the last all; changes made here and not yet sent stay", async () => {
    const { d, storage, got } = pullDeps((path) => {
      if (path === "/sync/activities") return acts(T2, { movies: T2 });
      if (path === "/sync/ratings/movies") return { movies: [rated("movie", { imdb: "tt0000001" }, null), rated("movie", { imdb: "tt0000004" }, 6)] };
      return {};
    });
    storage.setItem(simklSeenKey("p"), JSON.stringify({ all: T1, kinds: { movies: { lists: "", removed: "", rated: T0 } } }));
    storage.setItem(simklRatingsKey("p"), JSON.stringify({ tt0000001: 8, tt0000002: 7, tt0000009: 3 }));
    enqueueSimkl("p", [{ list: "ratings", ref: { kind: "show", ids: { imdb: "tt0000002" } }, extra: { rating: 4, rated_at: T2 } }], storage);
    enqueueSimkl("p", [{ list: "ratings", remove: true, ref: { kind: "movie", ids: { imdb: "tt0000009" } } }], storage);
    await pullSimkl("p", link, d);
    expect(got.slice(1)).toEqual([`/sync/ratings/movies?date_from=${encodeURIComponent(T1)}`]);
    expect(simklRatings("p", storage)).toEqual({ tt0000002: 4, tt0000004: 6 });
  });

  test("ratings never read are read whole even when nothing else moved; unlinking forgets them", async () => {
    const { d, storage, got } = pullDeps((path) => (path === "/sync/activities" ? acts(T1) : {}));
    storage.setItem(simklSeenKey("p"), JSON.stringify({ all: T1, kinds: {} }));
    await pullSimkl("p", link, d);
    expect(got.slice(1)).toEqual([
      "/sync/ratings/shows/1,2,3,4,5,6,7,8,9,10?",
      "/sync/ratings/movies/1,2,3,4,5,6,7,8,9,10?",
      "/sync/ratings/anime/1,2,3,4,5,6,7,8,9,10?",
    ]);
    expect(simklRatings("p", storage)).toEqual({});
    forgetSimklSeen("p", storage);
    expect(simklRatings("p", storage)).toBeUndefined();
  });
});

describe("a title's list and rating from its page", () => {
  afterEach(() => setSimklSyncDeps(undefined));

  function syncDeps(l: SimklLink | undefined) {
    const storage = memory();
    setSimklSyncDeps({
      storage,
      getLink: async () => l,
      liveLink: async () => l,
      flush: async () => "done",
      pull: async () => null,
      now: () => Date.parse(T2),
    });
    setSimklSpace("p");
    return storage;
  }

  test("a list and a rating are kept at once and queued; an anime goes by its Kitsu number", async () => {
    const storage = syncDeps(link);
    await setSimklStatus({ id: "kitsu:5", type: "series" }, "watching");
    await rateSimkl({ id: "tt0000001", type: "movie" }, 9);
    await rateSimkl({ id: "tt0000001", type: "movie" }, 12);
    await rateSimkl({ id: "tt0000001:1:2", type: "series" }, 5);
    expect(simklItems("p", storage)["kitsu:5"]).toEqual({ kind: "anime", status: "watching" });
    expect(simklRatings("p", storage)).toEqual({ tt0000001: 9 });
    expect(pendingSimklOps("p", storage)).toEqual([
      { list: "watchlist", ref: { kind: "show", ids: { kitsu: 5 } }, extra: { to: "watching" } },
      { list: "ratings", ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: { rating: 9, rated_at: T2.replace("Z", ".000Z") } },
    ]);
  });

  test("taking a title off Simkl takes its rating off too; a title never rated sends no rating removal", async () => {
    const storage = syncDeps(link);
    storage.setItem(
      simklItemsKey("p"),
      JSON.stringify({ tt0000002: { kind: "shows", status: "completed", simkl: 7 }, tt0000003: { kind: "shows", status: "hold" } }),
    );
    storage.setItem(simklRatingsKey("p"), JSON.stringify({ tt0000002: 8 }));
    await setSimklStatus({ id: "tt0000002", type: "series" }, null);
    await setSimklStatus({ id: "tt0000003", type: "series" }, null);
    expect(simklItems("p", storage)).toEqual({});
    expect(simklRatings("p", storage)).toEqual({});
    expect(pendingSimklOps("p", storage)).toEqual([
      { list: "watchlist", remove: true, ref: { kind: "show", ids: { imdb: "tt0000002" } } },
      { list: "ratings", remove: true, ref: { kind: "show", ids: { imdb: "tt0000002" } } },
      { list: "watchlist", remove: true, ref: { kind: "show", ids: { imdb: "tt0000003" } } },
    ]);
  });

  test("without a usable link nothing is kept or queued", async () => {
    const storage = syncDeps({ ...link, refused: true });
    await setSimklStatus({ id: "tt0000001", type: "movie" }, "completed");
    await rateSimkl({ id: "tt0000001", type: "movie" }, 7);
    expect(simklItems("p", storage)).toEqual({});
    expect(simklRatings("p", storage)).toBeUndefined();
    expect(pendingSimklOps("p", storage)).toEqual([]);
  });

  test("ratings go to /sync/ratings and /sync/ratings/remove, lists to add-to-list; stored ratings out of range are dropped", async () => {
    const storage = memory();
    const sent: [string, unknown][] = [];
    enqueueSimkl(
      "p",
      [
        { list: "watchlist", ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: { to: "completed" } },
        { list: "ratings", ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: { rating: 9, rated_at: T2 } },
        { list: "ratings", ref: { kind: "show", ids: { kitsu: 5 } }, extra: { rating: 7, rated_at: T2 } },
        { list: "ratings", remove: true, ref: { kind: "show", ids: { imdb: "tt0000002" } } },
      ],
      storage,
    );
    const deps = { storage, liveLink: async () => link, saveLink: async () => {}, send: async (path: string, body: unknown) => void sent.push([path, body]) };
    expect(await flushSimkl("p", deps)).toBe("done");
    expect(sent).toEqual([
      ["/sync/add-to-list", { movies: [{ ids: { imdb: "tt0000001" }, to: "completed" }], shows: [] }],
      ["/sync/ratings", { movies: [{ ids: { imdb: "tt0000001" }, rating: 9, rated_at: T2 }], shows: [{ ids: { kitsu: 5 }, rating: 7, rated_at: T2 }] }],
      ["/sync/ratings/remove", { movies: [], shows: [{ ids: { imdb: "tt0000002" } }] }],
    ]);
    expect(readSimklOp({ list: "ratings", ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: { rating: 0 } })).toBeUndefined();
    expect(readSimklOp({ list: "ratings", ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: { rating: "9" } })).toBeUndefined();
  });
});

describe("the title's page on Simkl", () => {
  test("by Simkl's number when the lists gave it, else through Simkl's redirect by IMDb id or Kitsu number", () => {
    expect(simklPageUrl({ id: "tt0000002", type: "series" }, { kind: "shows", status: "watching", simkl: 7 }, "1.0.0", "CLIENT")).toBe(
      "https://simkl.com/tv/7",
    );
    expect(simklPageUrl({ id: "kitsu:5", type: "series" }, { kind: "anime", status: "watching", simkl: 9 }, "1.0.0", "CLIENT")).toBe(
      "https://simkl.com/anime/9",
    );
    expect(simklPageUrl({ id: "tt0000001", type: "movie" }, { kind: "movies", status: "completed", simkl: 4 }, "1.0.0", "CLIENT")).toBe(
      "https://simkl.com/movies/4",
    );
    const film = new URL(simklPageUrl({ id: "tt0000001", type: "movie" }, undefined, "1.0.0", "CLIENT") ?? "");
    expect(film.origin + film.pathname).toBe("https://api.simkl.com/redirect");
    expect(Object.fromEntries(film.searchParams)).toEqual({
      to: "simkl",
      imdb: "tt0000001",
      type: "movie",
      client_id: "CLIENT",
      "app-name": "polarity",
      "app-version": "1.0.0",
    });
    const anime = new URL(simklPageUrl({ id: "kitsu:5", type: "series" }, undefined, "1.0.0", "CLIENT") ?? "");
    expect(anime.searchParams.get("kitsu")).toBe("5");
    expect(anime.searchParams.get("type")).toBe("anime");
    expect(simklPageUrl({ id: "tt0000002:1:2", type: "series" }, undefined, "1.0.0", "CLIENT")).toBeUndefined();
    expect(simklPageUrl({ id: "file:abc", type: "movie" }, undefined, "1.0.0", "CLIENT")).toBeUndefined();
  });
});
