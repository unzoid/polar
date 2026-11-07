import "./storageStub";
import { afterEach, describe, expect, test } from "bun:test";
import { SimklError, SimklSignedOut } from "../src/lib/simkl/api";
import { sameSimklRef, simklRefOf, simklScrobbleBody, simklSyncBody } from "../src/lib/simkl/items";
import type { SimklLink } from "../src/lib/simkl/link";
import { enqueueSimkl, flushSimkl, pendingSimklOps, readSimklOp, simklQueueKey, type SimklQueueDeps } from "../src/lib/simkl/queue";
import { scrobbleSimkl } from "../src/lib/simkl/scrobble";
import { noteSimklWatched, setSimklSpace, setSimklSyncDeps, syncSimkl } from "../src/lib/simkl/simklSync";

// #86: Polarity's titles on Simkl, scrobbles, and the watched marks waiting to go out.
const link: SimklLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: 2e12, account: 42, name: "Someone" };

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("titles and videos on Simkl", () => {
  test("IMDb films, shows and episodes with seasons; Kitsu anime by number, episodes without; files not at all", () => {
    expect(simklRefOf("tt0000001", "movie")).toEqual({ kind: "movie", ids: { imdb: "tt0000001" } });
    expect(simklRefOf("tt0000002", "series")).toEqual({ kind: "show", ids: { imdb: "tt0000002" } });
    expect(simklRefOf("tt0000002:0:3", "series")).toEqual({ kind: "episode", ids: { imdb: "tt0000002" }, season: 0, number: 3 });
    expect(simklRefOf("kitsu:5:12", "series")).toEqual({ kind: "episode", ids: { kitsu: 5 }, number: 12 });
    expect(simklRefOf("kitsu:5", "movie")).toEqual({ kind: "movie", ids: { kitsu: 5 } });
    expect(simklRefOf("file:///films/a.mkv", "movie")).toBeUndefined();
    expect(sameSimklRef({ kind: "show", ids: { kitsu: 5 } }, { kind: "show", ids: { kitsu: 6 } })).toBe(false);
  });

  test("a scrobble names a film, an episode by its show and season, or an anime episode by its number", () => {
    expect(simklScrobbleBody({ kind: "movie", ids: { imdb: "tt0000001" } })).toEqual({ movie: { ids: { imdb: "tt0000001" } } });
    expect(simklScrobbleBody({ kind: "episode", ids: { imdb: "tt0000002" }, season: 2, number: 3 })).toEqual({
      show: { ids: { imdb: "tt0000002" } },
      episode: { season: 2, number: 3 },
    });
    expect(simklScrobbleBody({ kind: "episode", ids: { kitsu: 5 }, number: 12 })).toEqual({ anime: { ids: { kitsu: 5 } }, episode: { number: 12 } });
  });

  test("a sync batch puts films in movies, shows and anime in shows, episodes under their season or the anime", () => {
    const at = { watched_at: "2026-11-07T00:00:00.000Z" };
    expect(
      simklSyncBody([
        { ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: at },
        { ref: { kind: "episode", ids: { imdb: "tt0000002" }, season: 1, number: 1 }, extra: at },
        { ref: { kind: "episode", ids: { imdb: "tt0000002" }, season: 1, number: 2 } },
        { ref: { kind: "episode", ids: { kitsu: 5 }, number: 12 }, extra: at },
        { ref: { kind: "episode", ids: { kitsu: 5 }, number: 13 } },
      ]),
    ).toEqual({
      movies: [{ ids: { imdb: "tt0000001" }, ...at }],
      shows: [
        { ids: { imdb: "tt0000002" }, seasons: [{ number: 1, episodes: [{ number: 1, ...at }, { number: 2 }] }] },
        { ids: { kitsu: 5 }, episodes: [{ number: 12, ...at }, { number: 13 }] },
      ],
    });
  });
});

describe("scrobbling", () => {
  const ref = { kind: "episode" as const, ids: { imdb: "tt0000002" }, season: 1, number: 2 };

  test("sends the action with its progress; Simkl's answer to a stop says whether it counted", async () => {
    const sent: [string, unknown][] = [];
    let answer: unknown = { action: "start" };
    const deps = { liveLink: async () => link, send: async (path: string, body: unknown) => (sent.push([path, body]), answer) };
    expect(await scrobbleSimkl("start", ref, 12.3456, deps)).toBe("sent");
    expect(sent[0]).toEqual(["/scrobble/start", { show: { ids: { imdb: "tt0000002" } }, episode: { season: 1, number: 2 }, progress: 12.35 }]);
    answer = { action: "pause" };
    expect(await scrobbleSimkl("stop", ref, 95, deps)).toBe("sent");
    answer = { action: "scrobble" };
    expect(await scrobbleSimkl("stop", ref, 85, deps)).toBe("watched");
    // No answer to read: Simkl's 80% decides.
    answer = null;
    expect(await scrobbleSimkl("stop", ref, 79.9, deps)).toBe("sent");
    expect(await scrobbleSimkl("stop", ref, 80, deps)).toBe("watched");
    expect(await scrobbleSimkl("pause", ref, 99, deps)).toBe("sent");
  });

  test("a 409 stop (completed within the hour) counts; no link, no network or a busy Simkl sends nothing; a refused token is renewed once", async () => {
    const conflict = { liveLink: async () => link, send: async () => Promise.reject(new SimklError("done", 409)) };
    expect(await scrobbleSimkl("stop", ref, 90, conflict)).toBe("watched");
    expect(await scrobbleSimkl("start", ref, 1, conflict)).toBe("none");
    expect(await scrobbleSimkl("start", ref, 1, { liveLink: async () => undefined, send: async () => ({}) })).toBe("none");
    expect(await scrobbleSimkl("stop", ref, 90, { liveLink: async () => link, send: async () => Promise.reject(new TypeError("net")) })).toBe("none");
    expect(await scrobbleSimkl("start", ref, 1, { liveLink: async () => link, send: async () => Promise.reject(new SimklError("lock", 429)) })).toBe("none");
    const renews: boolean[] = [];
    let calls = 0;
    const refused = {
      liveLink: async (renew: boolean) => (renews.push(renew), link),
      send: async () => {
        if (calls++ === 0) throw new SimklSignedOut();
        return {};
      },
    };
    expect(await scrobbleSimkl("pause", ref, 50, refused)).toBe("sent");
    expect(renews).toEqual([false, true]);
  });
});

describe("the queue", () => {
  const ep = (n: number) => ({ kind: "episode" as const, ids: { imdb: "tt0000002" }, season: 1, number: n });
  const at = { watched_at: "2026-11-07T00:00:00.000Z" };

  function deps(send: SimklQueueDeps["send"], over: Partial<SimklQueueDeps> = {}) {
    const storage = memory();
    const saved: SimklLink[] = [];
    const d: SimklQueueDeps = { storage, liveLink: async () => link, saveLink: async (_s, l) => void saved.push(l), send, ...over };
    return { d, storage, saved };
  }

  test("a change replaces what was waiting for the same item; bad stored ops are dropped", () => {
    const storage = memory();
    enqueueSimkl(
      "p",
      [
        { list: "history", ref: ep(1), extra: at },
        { list: "history", ref: ep(2), extra: at },
      ],
      storage,
    );
    enqueueSimkl("p", [{ list: "history", remove: true, ref: ep(1) }], storage);
    expect(pendingSimklOps("p", storage)).toEqual([
      { list: "history", ref: ep(2), extra: at },
      { list: "history", remove: true, ref: ep(1) },
    ]);
    expect(readSimklOp({ list: "history", ref: { kind: "movie", ids: { imdb: "nope" } } })).toBeUndefined();
    expect(readSimklOp({ list: "history", ref: { kind: "movie", ids: { kitsu: -1 } } })).toBeUndefined();
    expect(readSimklOp({ list: "history", ref: { kind: "episode", ids: { imdb: "tt1" }, number: 1 } })).toBeUndefined();
    expect(readSimklOp({ list: "other", ref: { kind: "movie", ids: { imdb: "tt1" } } })).toBeUndefined();
    expect(readSimklOp({ list: "history", ref: { kind: "episode", ids: { kitsu: 5 }, number: 2 }, extra: { watched_at: "x", token: "y" } })).toEqual({
      list: "history",
      ref: { kind: "episode", ids: { kitsu: 5 }, number: 2 },
      extra: { watched_at: "x" },
    });
  });

  test("goes out in batches of the same direction, in order", async () => {
    const sent: [string, unknown][] = [];
    const { d, storage } = deps(async (path, body) => void sent.push([path, body]));
    enqueueSimkl(
      "p",
      [
        { list: "history", ref: ep(1), extra: at },
        { list: "history", ref: ep(2), extra: at },
        { list: "history", remove: true, ref: ep(3) },
        { list: "history", ref: { kind: "movie", ids: { imdb: "tt0000001" } }, extra: at },
      ],
      storage,
    );
    expect(await flushSimkl("p", d)).toBe("done");
    expect(sent.map(([p]) => p)).toEqual(["/sync/history", "/sync/history/remove", "/sync/history"]);
    expect(sent[0][1]).toEqual({
      movies: [],
      shows: [
        {
          ids: { imdb: "tt0000002" },
          seasons: [
            {
              number: 1,
              episodes: [
                { number: 1, ...at },
                { number: 2, ...at },
              ],
            },
          ],
        },
      ],
    });
    expect(sent[1][1]).toEqual({ movies: [], shows: [{ ids: { imdb: "tt0000002" }, seasons: [{ number: 1, episodes: [{ number: 3 }] }] }] });
    expect(storage.m.has(simklQueueKey("p"))).toBe(false);
    expect(await flushSimkl("p", d)).toBe("empty");
  });

  test("offline, busy or the day's allowance spent keeps the rest; other refusals are dropped", async () => {
    for (const e of [new SimklError("busy", 429, "user_limit_exceeded"), new SimklError("down", 503), new TypeError("net")]) {
      const offline = deps(async () => Promise.reject(e));
      enqueueSimkl("p", [{ list: "history", ref: ep(1), extra: at }], offline.storage);
      expect(await flushSimkl("p", offline.d)).toBe("offline");
      expect(pendingSimklOps("p", offline.storage)).toHaveLength(1);
    }
    const bad = deps(async () => Promise.reject(new SimklError("wrong", 400, "wrong_parameter")));
    enqueueSimkl("p", [{ list: "history", ref: ep(1), extra: at }], bad.storage);
    expect(await flushSimkl("p", bad.d)).toBe("done");
    expect(pendingSimklOps("p", bad.storage)).toEqual([]);
  });

  test("a refused token is renewed once, else the link is marked refused and everything waits", async () => {
    let calls = 0;
    const renewed = deps(async () => {
      if (calls++ === 0) throw new SimklSignedOut();
    });
    enqueueSimkl("p", [{ list: "history", ref: ep(1), extra: at }], renewed.storage);
    expect(await flushSimkl("p", renewed.d)).toBe("done");
    expect(calls).toBe(2);

    const refused = deps(async () => Promise.reject(new SimklSignedOut()), { liveLink: async (_s, renew) => (renew ? undefined : link) });
    enqueueSimkl("p", [{ list: "history", ref: ep(1), extra: at }], refused.storage);
    expect(await flushSimkl("p", refused.d)).toBe("signed-out");
    expect(refused.saved).toEqual([{ ...link, refused: true }]);
    expect(pendingSimklOps("p", refused.storage)).toHaveLength(1);

    const none = deps(async () => {}, { liveLink: async () => undefined });
    enqueueSimkl("p", [{ list: "history", ref: ep(1), extra: at }], none.storage);
    expect(await flushSimkl("p", none.d)).toBe("signed-out");
  });
});

describe("marks made by hand", () => {
  afterEach(() => setSimklSyncDeps(undefined));

  test("go to a linked profile's history queue, both ways, and out; unlinked or refused profiles and files are left alone", async () => {
    const storage = memory();
    const flushed: (string | null)[] = [];
    let current: SimklLink | undefined = link;
    setSimklSyncDeps({ storage, getLink: async () => current, flush: async (space) => (flushed.push(space), "done"), now: () => Date.UTC(2026, 10, 7) });
    setSimklSpace("p");
    await syncSimkl();
    expect(flushed).toEqual([]);
    await noteSimklWatched(
      [
        { videoId: "tt0000002:1:1", type: "series" },
        { videoId: "kitsu:5:1", type: "series" },
        { videoId: "file:///films/a.mkv", type: "movie" },
      ],
      true,
    );
    const at = { watched_at: "2026-11-07T00:00:00.000Z" };
    expect(pendingSimklOps("p", storage)).toEqual([
      { list: "history", ref: { kind: "episode", ids: { imdb: "tt0000002" }, season: 1, number: 1 }, extra: at },
      { list: "history", ref: { kind: "episode", ids: { kitsu: 5 }, number: 1 }, extra: at },
    ]);
    expect(flushed).toEqual(["p"]);
    await noteSimklWatched([{ videoId: "tt0000001", type: "movie" }], false);
    expect(pendingSimklOps("p", storage).at(-1)).toEqual({ list: "history", remove: true, ref: { kind: "movie", ids: { imdb: "tt0000001" } } });

    for (const l of [undefined, { ...link, refused: true as const }]) {
      current = l;
      storage.m.clear();
      await noteSimklWatched([{ videoId: "tt0000001", type: "movie" }], true);
      expect(pendingSimklOps("p", storage)).toEqual([]);
    }
  });
});
