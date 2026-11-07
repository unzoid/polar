import "./storageStub";
import { afterEach, describe, expect, test } from "bun:test";
import type { SimklLink } from "../src/lib/simkl/link";
import { polarityIdOf, pullSimkl, readActivities, simklItems, simklItemsKey, simklSeenKey, type SimklPullDeps } from "../src/lib/simkl/pull";
import { enqueueSimkl, flushSimkl, pendingSimklOps, readSimklOp, simklQueueKey } from "../src/lib/simkl/queue";
import { noteSimklLibrary, setSimklSpace, setSimklSyncDeps, setSimklWatchlist, syncSimkl } from "../src/lib/simkl/simklSync";

// #86: what changed on Simkl coming into Polarity, and the library kept in step with Plan to Watch.
const link: SimklLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: 2e12, account: 42, name: "Someone" };

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

const T0 = "2026-03-01T00:00:00Z";
const T1 = "2026-03-02T00:00:00Z";
const T2 = "2026-03-03T00:00:00Z";

/** An activities answer: `all`, and per kind its lists' and removals' times. */
function acts(
  all: string,
  lists: Partial<Record<"tv_shows" | "movies" | "anime", { completed?: string; plantowatch?: string; removed_from_list?: string }>> = {},
) {
  return { all, settings: { all }, tv_shows: { all, ...lists.tv_shows }, movies: { all, ...lists.movies }, anime: { all, ...lists.anime } };
}

const show = (imdb: string, simkl: number, status: string, extra: Record<string, unknown> = {}) => ({
  status,
  show: { title: "The Lantern Keepers", ids: { simkl, imdb } },
  ...extra,
});
const film = (imdb: string, simkl: number, status: string, extra: Record<string, unknown> = {}) => ({
  status,
  movie: { title: "Night Train", ids: { simkl, imdb } },
  ...extra,
});

function pullDeps(answers: (path: string, query: Record<string, string>) => unknown, low = () => false) {
  const storage = memory();
  const got: string[] = [];
  const imported: [unknown[], unknown[]][] = [];
  const d: SimklPullDeps = {
    storage,
    get: async (path, query) => {
      got.push(`${path}?${new URLSearchParams(query)}`);
      return answers(path, query);
    },
    importLibrary: async (library, progress) => void imported.push([library, progress]),
    quotaLow: low,
  };
  return { d, storage, got, imported };
}

describe("what changed on Simkl", () => {
  test("activities: Simkl's all, and per kind the latest list change and removal", () => {
    expect(readActivities(acts(T2, { tv_shows: { completed: T1, plantowatch: T0, removed_from_list: T2 } }))).toEqual({
      all: T2,
      kinds: { shows: { lists: T1, removed: T2 }, movies: { lists: "", removed: "" }, anime: { lists: "", removed: "" } },
    });
    expect(readActivities({})).toBeUndefined();
  });

  test("titles are IMDb's, anime Kitsu's first; neither is nothing", () => {
    expect(polarityIdOf("shows", { simkl: 1, imdb: "tt0000002", kitsu: 5 })).toBe("tt0000002");
    expect(polarityIdOf("anime", { simkl: 1, imdb: "tt0000002", kitsu: "5" })).toBe("kitsu:5");
    expect(polarityIdOf("anime", { simkl: 1, imdb: "tt0000002" })).toBe("tt0000002");
    expect(polarityIdOf("movies", { simkl: 1, imdb: "nope" })).toBeUndefined();
  });

  test("the first look reads the lists whole without episodes, keeps where each title is, and imports nothing", async () => {
    const { d, storage, got, imported } = pullDeps((path) =>
      path === "/sync/activities" ? acts(T0) : path.endsWith("/shows") ? { shows: [show("tt0000002", 7, "watching")] } : {},
    );
    expect(await pullSimkl("p", link, d)).toBeNull();
    expect(got).toEqual([
      "/sync/activities?",
      "/sync/all-items/shows?extended=ids_only",
      "/sync/all-items/movies?extended=ids_only",
      "/sync/all-items/anime?extended=ids_only",
    ]);
    expect(simklItems("p", storage)).toEqual({ tt0000002: { kind: "shows", status: "watching", simkl: 7 } });
    expect(imported).toEqual([]);
    expect(storage.getItem(simklSeenKey("p"))).toContain(T0);
  });

  test("nothing moved: one read; a failed look keeps the old place so it is made again", async () => {
    const { d, storage, got } = pullDeps((path) => (path === "/sync/activities" ? acts(T0) : {}));
    await pullSimkl("p", link, d);
    got.length = 0;
    expect(await pullSimkl("p", link, d)).toEqual({ watched: 0, listed: 0 });
    expect(got).toEqual(["/sync/activities?"]);

    const failing = pullDeps((path) => {
      if (path === "/sync/activities") return acts(T1, { movies: { completed: T1 } });
      throw new TypeError("offline");
    });
    failing.storage.setItem(simklSeenKey("p"), storage.getItem(simklSeenKey("p")) ?? "");
    await expect(pullSimkl("p", link, failing.d)).rejects.toThrow();
    expect(failing.storage.getItem(simklSeenKey("p"))).toContain(T0);
  });

  test("later looks read only the kinds that moved, since the last all, and bring in what was watched since", async () => {
    const answers = (path: string, query: Record<string, string>): unknown => {
      if (path === "/sync/activities") return query.date_from ? {} : acts(T2, { tv_shows: { completed: T2 }, movies: { completed: T2 } });
      if (path === "/sync/all-items/shows")
        return {
          shows: [
            show("tt0000002", 7, "watching", {
              seasons: [
                {
                  number: 1,
                  episodes: [
                    { number: 1, watched_at: "2026-02-01T00:00:00Z" },
                    { number: 2, watched_at: T2 },
                  ],
                },
              ],
            }),
          ],
        };
      if (path === "/sync/all-items/movies")
        return { movies: [film("tt0000001", 8, "completed", { last_watched_at: T2 }), film("tt0000003", 9, "plantowatch")] };
      return {};
    };
    const { d, storage, got, imported } = pullDeps(answers);
    storage.setItem(simklSeenKey("p"), JSON.stringify({ all: T1, kinds: { shows: { lists: T1, removed: "" }, movies: { lists: T1, removed: "" } } }));
    expect(await pullSimkl("p", link, d)).toEqual({ watched: 2, listed: 0 });
    expect(got.slice(1)).toEqual([
      `/sync/all-items/shows?date_from=${encodeURIComponent(T1)}&extended=full&episode_watched_at=yes`,
      `/sync/all-items/movies?date_from=${encodeURIComponent(T1)}&extended=full&episode_watched_at=yes`,
    ]);
    const at = Date.parse(T2);
    expect(imported).toEqual([
      [
        [],
        [
          {
            metaId: "tt0000002",
            type: "series",
            name: "The Lantern Keepers",
            position: 1,
            duration: 1,
            videoId: "tt0000002:1:2",
            updatedAt: at,
            season: 1,
            episode: 2,
          },
          { metaId: "tt0000001", type: "movie", name: "Night Train", position: 1, duration: 1, videoId: "tt0000001", updatedAt: at },
        ],
      ],
    ]);
    expect(simklItems("p", storage).tt0000003).toEqual({ kind: "movies", status: "plantowatch", simkl: 9 });
  });

  test("Plan to Watch comes into the library only with the switch on, and only titles newly there", async () => {
    const answers = (path: string): unknown => {
      if (path === "/sync/activities") return acts(T2, { movies: { plantowatch: T2 } });
      return { movies: [film("tt0000003", 9, "plantowatch", { added_to_watchlist_at: T2 }), film("tt0000004", 10, "plantowatch")] };
    };
    const seen = JSON.stringify({ all: T1, kinds: { movies: { lists: T1, removed: "" } } });
    const off = pullDeps(answers);
    off.storage.setItem(simklSeenKey("p"), seen);
    expect(await pullSimkl("p", link, off.d)).toEqual({ watched: 0, listed: 0 });

    const on = pullDeps(answers);
    on.storage.setItem(simklSeenKey("p"), seen);
    on.storage.setItem(simklItemsKey("p"), JSON.stringify({ tt0000004: { kind: "movies", status: "plantowatch", simkl: 10 } }));
    expect(await pullSimkl("p", { ...link, watchlist: true }, on.d)).toEqual({ watched: 0, listed: 1 });
    expect(on.imported[0][0]).toEqual([{ id: "tt0000003", type: "movie", name: "Night Train", addedAt: Date.parse(T2) }]);
  });

  test("Kitsu anime episodes come by their number from a single season; anime known only by IMDb bring no episodes", async () => {
    const eps = { seasons: [{ number: 1, episodes: [{ number: 3, watched_at: T2 }] }] };
    const { d, storage, imported } = pullDeps((path) =>
      path === "/sync/activities"
        ? acts(T2, { anime: { completed: T2 } })
        : {
            anime: [
              { status: "watching", anime_type: "tv", show: { title: "Paper Moons", ids: { simkl: 11, kitsu: 5 } }, ...eps },
              { status: "watching", anime_type: "tv", show: { title: "Paper Moons II", ids: { simkl: 12, imdb: "tt0000005" } }, ...eps },
            ],
          },
    );
    storage.setItem(simklSeenKey("p"), JSON.stringify({ all: T1, kinds: { anime: { lists: T1, removed: "" } } }));
    await pullSimkl("p", link, d);
    expect(imported[0][1]).toEqual([
      { metaId: "kitsu:5", type: "series", name: "Paper Moons", position: 1, duration: 1, videoId: "kitsu:5:3", updatedAt: Date.parse(T2), episode: 3 },
    ]);
  });

  test("a removal on Simkl reads the kind's list as bare ids and drops what is gone from the kept lists only", async () => {
    const { d, storage, got, imported } = pullDeps((path, query) =>
      path === "/sync/activities"
        ? acts(T2, { tv_shows: { removed_from_list: T2 } })
        : query.extended === "simkl_ids_only"
          ? { shows: [{ show: { ids: { simkl: 7 } } }] }
          : {},
    );
    storage.setItem(simklSeenKey("p"), JSON.stringify({ all: T1, kinds: { shows: { lists: T1, removed: T0 } } }));
    storage.setItem(
      simklItemsKey("p"),
      JSON.stringify({
        tt0000002: { kind: "shows", status: "watching", simkl: 7 },
        tt0000006: { kind: "shows", status: "completed", simkl: 13 },
        tt0000001: { kind: "movies", status: "completed", simkl: 13 },
      }),
    );
    await pullSimkl("p", link, d);
    expect(got.slice(1)).toEqual(["/sync/all-items/shows?extended=simkl_ids_only"]);
    expect(Object.keys(simklItems("p", storage)).sort()).toEqual(["tt0000001", "tt0000002"]);
    expect(imported).toEqual([]);
  });

  test("nothing is read while the day's allowance is nearly spent", async () => {
    const { d, got } = pullDeps(
      () => acts(T0),
      () => true,
    );
    expect(await pullSimkl("p", link, d)).toBeNull();
    expect(got).toEqual([]);
  });
});

describe("the library and Plan to Watch", () => {
  afterEach(() => setSimklSyncDeps(undefined));

  function syncDeps(l: SimklLink | undefined) {
    const storage = memory();
    const calls: string[] = [];
    let current = l;
    setSimklSyncDeps({
      storage,
      getLink: async () => current,
      liveLink: async () => current,
      flush: async () => (calls.push("flush"), "done"),
      pull: async () => (calls.push("pull"), null),
      now: () => 0,
    });
    return { storage, calls, set: (x: SimklLink | undefined) => (current = x) };
  }

  test("a profile start looks at Simkl; a plain round doesn't", async () => {
    const { calls } = syncDeps(link);
    setSimklSpace("p");
    await syncSimkl();
    expect(calls).toEqual(["pull"]);
    calls.length = 0;
    await syncSimkl();
    expect(calls).toEqual([]);
  });

  test("with the switch on, titles Simkl doesn't list go onto Plan to Watch; off it only while still there", async () => {
    const { storage, set } = syncDeps(link);
    setSimklSpace("p");
    await noteSimklLibrary({ id: "tt0000001", type: "movie" }, true);
    expect(pendingSimklOps("p", storage)).toEqual([]);
    set({ ...link, watchlist: true });
    storage.setItem(simklItemsKey("p"), JSON.stringify({ tt0000002: { kind: "shows", status: "watching", simkl: 7 } }));
    await noteSimklLibrary({ id: "tt0000001", type: "movie" }, true);
    await noteSimklLibrary({ id: "tt0000002", type: "series" }, true);
    await noteSimklLibrary({ id: "tt0000002", type: "series" }, false);
    await noteSimklLibrary({ id: "kitsu:5", type: "series" }, true);
    expect(simklItems("p", storage)["kitsu:5"]).toEqual({ kind: "anime", status: "plantowatch" });
    await noteSimklLibrary({ id: "tt0000001", type: "movie" }, false);
    expect(pendingSimklOps("p", storage)).toEqual([
      { list: "watchlist", ref: { kind: "show", ids: { kitsu: 5 } }, extra: { to: "plantowatch" } },
      { list: "watchlist", remove: true, ref: { kind: "movie", ids: { imdb: "tt0000001" } } },
    ]);
    expect(simklItems("p", storage).tt0000001).toBeUndefined();
    expect(readSimklOp({ list: "watchlist", ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: { to: "watching" } })?.extra).toBeUndefined();
    expect(storage.getItem(simklQueueKey("p"))).not.toContain("TOKEN");
  });

  test("Plan to Watch goes to add-to-list; a title taken off leaves Simkl's lists through the history", async () => {
    const storage = memory();
    const sent: [string, unknown][] = [];
    enqueueSimkl(
      "p",
      [
        { list: "watchlist", ref: { kind: "show", ids: { kitsu: 5 } }, extra: { to: "plantowatch" } },
        { list: "watchlist", remove: true, ref: { kind: "movie", ids: { imdb: "tt0000001" } } },
      ],
      storage,
    );
    const deps = { storage, liveLink: async () => link, saveLink: async () => {}, send: async (path: string, body: unknown) => void sent.push([path, body]) };
    expect(await flushSimkl("p", deps)).toBe("done");
    expect(sent).toEqual([
      ["/sync/add-to-list", { movies: [], shows: [{ ids: { kitsu: 5 }, to: "plantowatch" }] }],
      ["/sync/history/remove", { movies: [{ ids: { imdb: "tt0000001" } }], shows: [] }],
    ]);
  });

  test("the switch is kept with the link", async () => {
    let saved: SimklLink | undefined;
    await setSimklWatchlist("p", true, { getLink: async () => link, saveLink: async (_s, l) => void (saved = l) });
    expect(saved?.watchlist).toBe(true);
    await setSimklWatchlist("p", false, { getLink: async () => ({ ...link, watchlist: true }), saveLink: async (_s, l) => void (saved = l) });
    expect(saved).toEqual(link);
  });
});
