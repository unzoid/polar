import "./storageStub";
import { afterEach, describe, expect, test } from "bun:test";
import { TraktError, TraktSignedOut } from "../src/lib/trakt/api";
import { readTraktItem, scrobbleBody, syncBody, traktRefOf, videoIdOf } from "../src/lib/trakt/items";
import type { TraktLink } from "../src/lib/trakt/link";
import { enqueueTrakt, flushTrakt, pendingTraktOps, readTraktOp, traktQueueKey, type TraktQueueDeps } from "../src/lib/trakt/queue";
import { scrobble } from "../src/lib/trakt/scrobble";
import { noteTraktWatched, setTraktSpace, setTraktSyncDeps, syncTrakt } from "../src/lib/trakt/traktSync";

// #85: Polarity's titles on Trakt, scrobbles, and the changes waiting to go out.
const link: TraktLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: 2e12, slug: "someone", name: "Someone" };

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("titles and videos on Trakt", () => {
  test("IMDb films, shows and episodes go across; Kitsu anime and files don't", () => {
    expect(traktRefOf("tt0000001", "movie")).toEqual({ kind: "movie", imdb: "tt0000001" });
    expect(traktRefOf("tt0000002", "series")).toEqual({ kind: "show", imdb: "tt0000002" });
    expect(traktRefOf("tt0000002:3:4", "series")).toEqual({ kind: "episode", imdb: "tt0000002", season: 3, number: 4 });
    expect(traktRefOf("tt0000002:0:1", "series")).toEqual({ kind: "episode", imdb: "tt0000002", season: 0, number: 1 });
    expect(traktRefOf("kitsu:5:2", "series")).toBeUndefined();
    expect(traktRefOf("file:abc", "movie")).toBeUndefined();
    expect(videoIdOf({ kind: "episode", imdb: "tt0000002", season: 3, number: 4 })).toBe("tt0000002:3:4");
  });

  test("a scrobble names a film, or an episode by its show", () => {
    expect(scrobbleBody({ kind: "movie", imdb: "tt0000001" })).toEqual({ movie: { ids: { imdb: "tt0000001" } } });
    expect(scrobbleBody({ kind: "episode", imdb: "tt0000002", season: 1, number: 2 })).toEqual({
      show: { ids: { imdb: "tt0000002" } },
      episode: { season: 1, number: 2 },
    });
  });

  test("a sync batch puts episodes under their show and season", () => {
    const at = { watched_at: "2026-11-07T00:00:00.000Z" };
    expect(
      syncBody([
        { ref: { kind: "movie", imdb: "tt0000001" }, extra: at },
        { ref: { kind: "episode", imdb: "tt0000002", season: 1, number: 1 }, extra: at },
        { ref: { kind: "episode", imdb: "tt0000002", season: 1, number: 2 }, extra: at },
        { ref: { kind: "episode", imdb: "tt0000002", season: 2, number: 1 } },
        { ref: { kind: "show", imdb: "tt0000003" }, extra: { rating: 8 } },
      ]),
    ).toEqual({
      movies: [{ ids: { imdb: "tt0000001" }, ...at }],
      shows: [
        {
          ids: { imdb: "tt0000002" },
          seasons: [
            { number: 1, episodes: [{ number: 1, ...at }, { number: 2, ...at }] },
            { number: 2, episodes: [{ number: 1 }] },
          ],
        },
        { ids: { imdb: "tt0000003" }, rating: 8 },
      ],
    });
  });

  test("Trakt's own items are read by their IMDb id", () => {
    expect(readTraktItem({ type: "movie", movie: { ids: { imdb: "tt0000001", trakt: 1 } } })).toEqual({ kind: "movie", imdb: "tt0000001" });
    expect(readTraktItem({ type: "episode", episode: { season: 1, number: 2 }, show: { ids: { imdb: "tt0000002" } } })).toEqual({
      kind: "episode",
      imdb: "tt0000002",
      season: 1,
      number: 2,
    });
    expect(readTraktItem({ type: "show", show: { ids: { imdb: null, tmdb: 5 } } })).toBeUndefined();
    expect(readTraktItem({ type: "movie", movie: { ids: { imdb: "javascript:x" } } })).toBeUndefined();
    expect(readTraktItem({ type: "episode", episode: { season: 1 }, show: { ids: { imdb: "tt0000002" } } })).toBeUndefined();
  });
});

describe("scrobbling", () => {
  const ref = { kind: "episode" as const, imdb: "tt0000002", season: 1, number: 2 };

  test("sends the action with its progress; a stop past 80% counts as watched", async () => {
    const sent: [string, unknown][] = [];
    const deps = { liveLink: async () => link, send: async (path: string, body: unknown) => void sent.push([path, body]) };
    expect(await scrobble("start", ref, 12.3456, deps)).toBe("sent");
    expect(await scrobble("stop", ref, 79.9, deps)).toBe("sent");
    expect(await scrobble("stop", ref, 95, deps)).toBe("watched");
    expect(sent[0]).toEqual(["/scrobble/start", { show: { ids: { imdb: "tt0000002" } }, episode: { season: 1, number: 2 }, progress: 12.35 }]);
    expect(sent.map(([p]) => p)).toEqual(["/scrobble/start", "/scrobble/stop", "/scrobble/stop"]);
  });

  test("a 409 (just sent) counts; no link or no network sends nothing; a refused token is renewed once", async () => {
    const conflict = { liveLink: async () => link, send: async () => Promise.reject(new TraktError("dup", 409)) };
    expect(await scrobble("stop", ref, 90, conflict)).toBe("watched");
    expect(await scrobble("start", ref, 1, { liveLink: async () => undefined, send: async () => {} })).toBe("none");
    expect(await scrobble("stop", ref, 90, { liveLink: async () => link, send: async () => Promise.reject(new TypeError("net")) })).toBe("none");
    const renews: boolean[] = [];
    let calls = 0;
    const refused = {
      liveLink: async (renew: boolean) => (renews.push(renew), link),
      send: async () => {
        if (calls++ === 0) throw new TraktSignedOut();
      },
    };
    expect(await scrobble("pause", ref, 50, refused)).toBe("sent");
    expect(renews).toEqual([false, true]);
  });
});

describe("the queue", () => {
  const ep = (n: number) => ({ kind: "episode" as const, imdb: "tt0000002", season: 1, number: n });
  const at = { watched_at: "2026-11-07T00:00:00.000Z" };

  function deps(send: TraktQueueDeps["send"], over: Partial<TraktQueueDeps> = {}) {
    const storage = memory();
    const saved: TraktLink[] = [];
    const full: string[] = [];
    const d: TraktQueueDeps = {
      storage,
      liveLink: async () => link,
      saveLink: async (_s, l) => void saved.push(l),
      send,
      full: (list) => void full.push(list),
      ...over,
    };
    return { d, storage, saved, full };
  }

  test("a change replaces what was waiting for the same item on the same list; bad stored ops are dropped", () => {
    const storage = memory();
    enqueueTrakt("p", [{ list: "history", ref: ep(1), extra: at }, { list: "watchlist", ref: ep(1) }], storage);
    enqueueTrakt("p", [{ list: "history", remove: true, ref: ep(1) }], storage);
    expect(pendingTraktOps("p", storage)).toEqual([
      { list: "watchlist", ref: ep(1) },
      { list: "history", remove: true, ref: ep(1) },
    ]);
    expect(readTraktOp({ list: "history", ref: { kind: "movie", imdb: "nope" } })).toBeUndefined();
    expect(readTraktOp({ list: "other", ref: { kind: "movie", imdb: "tt1" } })).toBeUndefined();
    expect(readTraktOp({ list: "ratings", ref: { kind: "movie", imdb: "tt1" }, extra: { rating: 8, token: "x" } })).toEqual({
      list: "ratings",
      ref: { kind: "movie", imdb: "tt1" },
      extra: { rating: 8 },
    });
  });

  test("goes out in batches of the same list and direction, in order", async () => {
    const sent: [string, unknown][] = [];
    const { d, storage } = deps(async (path, body) => void sent.push([path, body]));
    enqueueTrakt(
      "p",
      [
        { list: "history", ref: ep(1), extra: at },
        { list: "history", ref: ep(2), extra: at },
        { list: "history", remove: true, ref: ep(3) },
        { list: "ratings", ref: { kind: "movie", imdb: "tt0000001" }, extra: { rating: 9 } },
      ],
      storage,
    );
    expect(await flushTrakt("p", d)).toBe("done");
    expect(sent.map(([p]) => p)).toEqual(["/sync/history", "/sync/history/remove", "/sync/ratings"]);
    expect(sent[0][1]).toEqual({ movies: [], shows: [{ ids: { imdb: "tt0000002" }, seasons: [{ number: 1, episodes: [{ number: 1, ...at }, { number: 2, ...at }] }] }] });
    expect(sent[1][1]).toEqual({ movies: [], shows: [{ ids: { imdb: "tt0000002" }, seasons: [{ number: 1, episodes: [{ number: 3 }] }] }] });
    expect(storage.m.has(traktQueueKey("p"))).toBe(false);
    expect(await flushTrakt("p", d)).toBe("empty");
  });

  test("offline or busy keeps the rest; a full list is said and dropped; other refusals are dropped", async () => {
    const offline = deps(async () => Promise.reject(new TraktError("busy", 429)));
    enqueueTrakt("p", [{ list: "history", ref: ep(1), extra: at }], offline.storage);
    expect(await flushTrakt("p", offline.d)).toBe("offline");
    expect(pendingTraktOps("p", offline.storage)).toHaveLength(1);

    const full = deps(async (path) => {
      if (path === "/sync/watchlist") throw new TraktError("limit", 420);
    });
    enqueueTrakt("p", [{ list: "watchlist", ref: ep(1) }, { list: "history", ref: ep(1), extra: at }], full.storage);
    expect(await flushTrakt("p", full.d)).toBe("done");
    expect(full.full).toEqual(["watchlist"]);
    expect(pendingTraktOps("p", full.storage)).toEqual([]);
  });

  test("a refused token is renewed once, else the link is marked refused and everything waits", async () => {
    let calls = 0;
    const renewed = deps(async () => {
      if (calls++ === 0) throw new TraktSignedOut();
    });
    enqueueTrakt("p", [{ list: "history", ref: ep(1), extra: at }], renewed.storage);
    expect(await flushTrakt("p", renewed.d)).toBe("done");
    expect(calls).toBe(2);

    const refused = deps(async () => Promise.reject(new TraktSignedOut()), {
      liveLink: async (_s, renew) => (renew ? undefined : link),
    });
    enqueueTrakt("p", [{ list: "history", ref: ep(1), extra: at }], refused.storage);
    expect(await flushTrakt("p", refused.d)).toBe("signed-out");
    expect(refused.saved).toEqual([{ ...link, refused: true }]);
    expect(pendingTraktOps("p", refused.storage)).toHaveLength(1);
  });

  test("with no link nothing goes out", async () => {
    const none = deps(async () => {}, { liveLink: async () => undefined });
    enqueueTrakt("p", [{ list: "history", ref: ep(1), extra: at }], none.storage);
    expect(await flushTrakt("p", none.d)).toBe("signed-out");
  });
});

describe("marks made by hand", () => {
  afterEach(() => setTraktSyncDeps(undefined));

  test("go to a linked profile's history queue, both ways, and out; unlinked profiles and Kitsu anime are left alone", async () => {
    const storage = memory();
    const flushed: (string | null)[] = [];
    let linked = true;
    setTraktSyncDeps({
      storage,
      linked: async () => linked,
      flush: async (space) => (flushed.push(space), "done"),
      now: () => Date.UTC(2026, 10, 7),
    });
    setTraktSpace("p");
    await syncTrakt();
    expect(flushed).toEqual([]);
    await noteTraktWatched(
      [
        { videoId: "tt0000002:1:1", type: "series" },
        { videoId: "kitsu:5:1", type: "series" },
        { videoId: "tt0000001", type: "movie" },
      ],
      true,
    );
    expect(pendingTraktOps("p", storage)).toEqual([
      { list: "history", ref: { kind: "episode", imdb: "tt0000002", season: 1, number: 1 }, extra: { watched_at: "2026-11-07T00:00:00.000Z" } },
      { list: "history", ref: { kind: "movie", imdb: "tt0000001" }, extra: { watched_at: "2026-11-07T00:00:00.000Z" } },
    ]);
    expect(flushed).toEqual(["p"]);
    await noteTraktWatched([{ videoId: "tt0000001", type: "movie" }], false);
    expect(pendingTraktOps("p", storage).at(-1)).toEqual({ list: "history", remove: true, ref: { kind: "movie", imdb: "tt0000001" } });

    linked = false;
    storage.m.clear();
    await noteTraktWatched([{ videoId: "tt0000001", type: "movie" }], true);
    expect(pendingTraktOps("p", storage)).toEqual([]);
  });
});
