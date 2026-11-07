import "./storageStub";
import { afterEach, describe, expect, test } from "bun:test";
import { ListError, SignedOut, type Link, type ListEntry, type Relay, type RelayRequest } from "../src/lib/lists";
import { linkMal, NotASignIn, type LinkingDeps } from "../src/lib/lists/linking";
import { readLink } from "../src/lib/lists/linkStore";
import { noteWatched, setListSpace, setListSyncDeps, syncList } from "../src/lib/lists/listSync";
import {
  malChangedSince,
  malDeleteEntry,
  malEntryFor,
  malForm,
  malSaveEntry,
  malViewer,
  malWholeList,
  readMalItem,
  readMalStatus,
} from "../src/lib/lists/malList";
import {
  finishMalSignIn,
  MAL_REDIRECT,
  NoPendingSignIn,
  pendingKey,
  readMalCode,
  readTokens,
  startMalSignIn,
  type TokenRelay,
} from "../src/lib/lists/malSignIn";
import { enqueue, flush, pendingOps, type QueueDeps } from "../src/lib/lists/queue";
import { liveLink, listClient, type ListClient, type LiveLinkDeps } from "../src/lib/lists/services";

// #84: a MyAnimeList list, through the native relay (here a stand-in), signed in with PKCE.
const NOW = 1_800_000_000_000;
const CLIENT = "0123456789abcdef";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

/** A relay answering from `answer`, keeping what was asked. */
function relay(answer: (req: RelayRequest) => { status: number; body?: unknown }) {
  const asked: RelayRequest[] = [];
  const send: Relay = async (req) => {
    asked.push(req);
    const { status, body } = answer(req);
    return { status, body: body === undefined ? "" : JSON.stringify(body) };
  };
  return { send, asked };
}

const status = { status: "watching", score: 7, num_episodes_watched: 3, is_rewatching: false, num_times_rewatched: 0, updated_at: "2026-01-02T03:04:05+00:00" };

describe("reading MAL's answers", () => {
  test("a list status is an entry keyed by its anime", () => {
    expect(readMalStatus(status, 21)).toEqual({ id: 21, mediaId: 21, status: "CURRENT", progress: 3, score: 7, repeat: 0, updatedAt: 1767323045 });
    expect(readMalStatus({ ...status, status: "completed", is_rewatching: true }, 21)?.status).toBe("REPEATING");
    expect(readMalStatus({ ...status, status: "on_hold" }, 21)?.status).toBe("PAUSED");
    expect(readMalStatus({ ...status, status: "plan_to_watch" }, 21)?.status).toBe("PLANNING");
    expect(readMalStatus({ ...status, status: "something" }, 21)).toBeUndefined();
    expect(readMalStatus(status, 0)).toBeUndefined();
    expect(readMalStatus(null, 21)).toBeUndefined();
  });

  test("a list item keeps what the import needs of its anime", () => {
    const item = {
      node: {
        id: 30,
        title: "Kaze no Tani",
        alternative_titles: { en: "Valley Wind" },
        main_picture: { large: "https://media.example.com/30.jpg" },
        num_episodes: 0,
        media_type: "movie",
        nsfw: "white",
      },
      list_status: { ...status, status: "completed" },
    };
    expect(readMalItem(item)).toMatchObject({
      mediaId: 30,
      status: "COMPLETED",
      episodes: null,
      format: "MOVIE",
      title: "Valley Wind",
      poster: "https://media.example.com/30.jpg",
      isAdult: false,
    });
    expect(readMalItem({ ...item, node: { ...item.node, nsfw: "black", alternative_titles: {} } })).toMatchObject({ isAdult: true, title: "Kaze no Tani" });
    expect(readMalItem({ node: item.node })).toBeUndefined();
  });

  test("a change is sent as only the fields it changes, a rewatch as a finished entry rewatched", () => {
    expect(malForm({ progress: 4 })).toEqual([["num_watched_episodes", "4"]]);
    expect(malForm({ status: "CURRENT", progress: 1 })).toEqual([
      ["status", "watching"],
      ["is_rewatching", "false"],
      ["num_watched_episodes", "1"],
    ]);
    expect(malForm({ status: "REPEATING", progress: 1 })).toEqual([
      ["status", "completed"],
      ["is_rewatching", "true"],
      ["num_watched_episodes", "1"],
    ]);
    expect(malForm({ status: "COMPLETED", progress: 12, repeat: 2 })).toContainEqual(["num_times_rewatched", "2"]);
    expect(malForm({ score: 7.6 })).toEqual([["score", "8"]]);
    expect(malForm({ score: 40 })).toEqual([["score", "10"]]);
  });
});

describe("asking MAL", () => {
  test("who is signed in, one entry, saving and removing", async () => {
    const r = relay((req) => {
      if (req.path === "users/@me") return { status: 200, body: { id: 77, name: "Someone" } };
      if (req.path === "anime/21" && req.method === "GET") return { status: 200, body: { id: 21, my_list_status: status } };
      if (req.path === "anime/22") return { status: 200, body: { id: 22 } };
      if (req.method === "PATCH") return { status: 200, body: { ...status, num_episodes_watched: 4 } };
      if (req.method === "DELETE") return { status: req.path.includes("/23/") ? 404 : 200 };
      return { status: 404 };
    });
    const caller = { token: "TOKEN", relay: r.send };
    expect(await malViewer(caller)).toEqual({ id: 77, name: "Someone", scoreFormat: "POINT_10", adult: false });
    expect((await malEntryFor(77, 21, caller))?.progress).toBe(3);
    expect(await malEntryFor(77, 22, caller)).toBeNull();
    expect(await malEntryFor(77, 99, caller)).toBeNull();
    expect((await malSaveEntry(21, { progress: 4 }, caller)).progress).toBe(4);
    expect(r.asked.at(-1)).toMatchObject({ method: "PATCH", path: "anime/21/my_list_status", form: [["num_watched_episodes", "4"]], token: "TOKEN" });
    await malDeleteEntry(21, caller);
    // Already gone: a retry after a lost answer.
    await malDeleteEntry(23, caller);
  });

  test("a refused token, a busy MAL and no connection each say so", async () => {
    const caller = (status: number) => ({ token: "TOKEN", relay: relay(() => ({ status, body: { error: "x", message: "m" } })).send });
    expect(malViewer(caller(401))).rejects.toBeInstanceOf(SignedOut);
    // MAL's "DoS detected" 403 is a busy service: tried again later, like a 429.
    expect(malViewer(caller(403))).rejects.toMatchObject({ status: 429 });
    expect(malViewer(caller(500))).rejects.toBeInstanceOf(ListError);
    const down: Relay = async () => Promise.reject({ code: "upstream", message: "no route" });
    expect(malViewer({ token: "TOKEN", relay: down })).rejects.toBeInstanceOf(TypeError);
  });

  test("the whole list pages until MAL has no next page; changes are those after the last look", async () => {
    const item = (id: number, updated: string) => ({ node: { id, title: `Show ${id}` }, list_status: { ...status, updated_at: updated } });
    const r = relay((req) => {
      const offset = Number(req.query.find(([k]) => k === "offset")?.[1] ?? 0);
      if (offset === 0 && req.query.some(([k]) => k === "sort"))
        return { status: 200, body: { data: [item(1, "2026-01-03T00:00:00Z"), item(2, "2026-01-01T00:00:00Z")] } };
      return {
        status: 200,
        body:
          offset === 0
            ? { data: [item(1, "2026-01-01T00:00:00Z")], paging: { next: "https://api.myanimelist.net/v2/next" } }
            : { data: [item(2, "2026-01-01T00:00:00Z")], paging: {} },
      };
    });
    const caller = { token: "TOKEN", relay: r.send };
    expect((await malWholeList(77, caller)).map((e) => e.mediaId)).toEqual([1, 2]);
    expect(r.asked.map((a) => a.query.find(([k]) => k === "offset")?.[1])).toEqual(["0", "1000"]);
    expect(r.asked[0].query).toContainEqual(["nsfw", "true"]);
    const since = Date.parse("2026-01-02T00:00:00Z") / 1000;
    expect((await malChangedSince(77, since, caller)).map((e) => e.mediaId)).toEqual([1]);
  });
});

describe("signing in (#84)", () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i);

  test("without a client id there is no sign-in page", () => {
    const s = memory();
    expect(startMalSignIn("p", { storage: s, clientId: "", now: NOW })).toBeNull();
    expect(s.m.size).toBe(0);
  });

  test("the sign-in page carries the verifier as a plain challenge and the state, both kept for the code", () => {
    const s = memory();
    const url = new URL(startMalSignIn("p", { storage: s, clientId: CLIENT, now: NOW, random: bytes })!);
    expect(url.origin + url.pathname).toBe("https://myanimelist.net/v1/oauth2/authorize");
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("code_challenge_method")).toBe("plain");
    expect(q.get("redirect_uri")).toBe(MAL_REDIRECT);
    const kept = JSON.parse(s.getItem(pendingKey("p"))!);
    expect(q.get("code_challenge")).toBe(kept.verifier);
    expect(kept.verifier).toHaveLength(96);
    expect(kept.verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(q.get("state")).toBe(kept.state);
  });

  test("the pasted address gives its code, only when the state is this sign-in's", () => {
    expect(readMalCode(`${MAL_REDIRECT}?code=def50200abc&state=S1`, "S1")).toBe("def50200abc");
    expect(readMalCode(`${MAL_REDIRECT}?code=def50200abc&state=S2`, "S1")).toBeNull();
    expect(readMalCode("  def50200abcdef  ", "S1")).toBe("def50200abcdef");
    expect(readMalCode("https://example.com/?error=access_denied", "S1")).toBeNull();
    expect(readMalCode("hello there", "S1")).toBeNull();
    expect(readMalCode(`${MAL_REDIRECT}?code=<script>&state=S1`, "S1")).toBeNull();
  });

  test("tokens are read with their lifetimes", () => {
    expect(readTokens(JSON.stringify({ access_token: "A", refresh_token: "R", expires_in: 2678400 }), NOW)).toEqual({
      token: "A",
      refreshToken: "R",
      expiresAt: NOW + 2_678_400_000,
      refreshBy: NOW + 30 * 24 * 60 * 60_000,
    });
    expect(readTokens(JSON.stringify({ access_token: "A" }), NOW)).toBeNull();
    expect(readTokens("not json", NOW)).toBeNull();
  });

  test("the code is traded with the kept verifier, then the link keeps who MAL says it is", async () => {
    const s = memory();
    const url = new URL(startMalSignIn("p", { storage: s, clientId: CLIENT, now: NOW, random: bytes })!);
    const state = url.searchParams.get("state")!;
    const forms: [string, string][][] = [];
    const tokenRelay: TokenRelay = async (form) => {
      forms.push(form);
      return { status: 200, body: JSON.stringify({ access_token: "A", refresh_token: "R", expires_in: 3600 }) };
    };
    const saved = new Map<string | null, Link>();
    const deps: LinkingDeps = {
      now: () => NOW,
      viewer: async ({ token }) => ({ id: token === "A" ? 77 : 0, name: "Someone", scoreFormat: "POINT_10", adult: false }),
      saveLink: async (sp, l) => void saved.set(sp, l),
      removeLink: async () => {},
      storage: s,
      changed: () => {},
      tokenRelay,
    };
    expect(linkMal("p", "nothing useful", deps)).rejects.toBeInstanceOf(NotASignIn);
    await Promise.resolve();
    const link = await linkMal("p", `${MAL_REDIRECT}?code=def50200abc&state=${state}`, deps);
    expect(Object.fromEntries(forms.at(-1)!)).toEqual({
      client_id: expect.any(String),
      grant_type: "authorization_code",
      code: "def50200abc",
      code_verifier: url.searchParams.get("code_challenge")!,
      redirect_uri: MAL_REDIRECT,
    });
    expect(link).toMatchObject({ token: "A", refreshToken: "R", userId: 77, userName: "Someone", scoreFormat: "POINT_10" });
    expect(readLink(JSON.stringify(link))).toEqual(link);
    expect(saved.get("p")).toEqual(link);
    // The verifier is used once.
    expect(s.getItem(pendingKey("p"))).toBeNull();
    expect(linkMal("p", `${MAL_REDIRECT}?code=def50200abc&state=${state}`, deps)).rejects.toBeInstanceOf(NoPendingSignIn);
  });

  test("a code MAL refuses, or one pasted too late, links nothing", async () => {
    const s = memory();
    startMalSignIn("p", { storage: s, clientId: CLIENT, now: NOW });
    const refused: TokenRelay = async () => ({ status: 400, body: JSON.stringify({ error: "invalid_grant" }) });
    expect(finishMalSignIn("p", "def50200abc", { storage: s, now: NOW, relay: refused })).rejects.toBeInstanceOf(SignedOut);
    expect(finishMalSignIn("p", "def50200abc", { storage: s, now: NOW + 31 * 60_000, relay: refused })).rejects.toBeInstanceOf(NoPendingSignIn);
    expect(finishMalSignIn("q", "def50200abc", { storage: s, now: NOW, relay: refused })).rejects.toBeInstanceOf(NoPendingSignIn);
  });
});

describe("keeping the link alive", () => {
  const DAY = 24 * 60 * 60_000;
  const base: Link = {
    token: "OLD",
    expiresAt: NOW + 10 * DAY,
    refreshToken: "R1",
    refreshBy: NOW + 20 * DAY,
    userId: 77,
    userName: "x",
    scoreFormat: "POINT_10",
    adult: false,
  };

  function setup(link: Link | undefined, refresh: ListClient["refresh"]) {
    let kept = link;
    let refreshes = 0;
    const deps: LiveLinkDeps = {
      now: () => NOW,
      getLink: async () => kept,
      saveLink: async (_s, _sp, l) => void (kept = l),
      client: (service) => ({
        ...listClient(service),
        refresh: refresh && (async (l, now) => (refreshes++, refresh(l, now))),
      }),
    };
    return { deps, kept: () => kept, refreshes: () => refreshes };
  }
  const renewed: ListClient["refresh"] = async (l) => ({ ...l, token: "NEW", expiresAt: NOW + 30 * DAY, refreshToken: "R2" });

  test("a link far from running out is used as it is", async () => {
    const t = setup(base, renewed);
    expect((await liveLink("mal", "p", false, t.deps))?.token).toBe("OLD");
    expect(t.refreshes()).toBe(0);
  });

  test("one about to run out, or already run out, is refreshed once even when asked for twice at once", async () => {
    const t = setup({ ...base, expiresAt: NOW - 1 }, renewed);
    const [a, b] = await Promise.all([liveLink("mal", "p", false, t.deps), liveLink("mal", "p", false, t.deps)]);
    expect(a?.token).toBe("NEW");
    expect(b?.token).toBe("NEW");
    expect(t.refreshes()).toBe(1);
    expect(t.kept()?.refreshToken).toBe("R2");
  });

  test("a refresh MAL refuses marks the link refused; one that can't reach MAL keeps a still-good token", async () => {
    const refused = setup({ ...base, expiresAt: NOW + DAY }, async () => Promise.reject(new SignedOut("MyAnimeList")));
    expect(await liveLink("mal", "p", false, refused.deps)).toBeUndefined();
    expect(refused.kept()?.refused).toBe(true);
    const offline = setup({ ...base, expiresAt: NOW + DAY }, async () => Promise.reject(new TypeError("down")));
    expect((await liveLink("mal", "p", false, offline.deps))?.token).toBe("OLD");
    expect(offline.kept()?.refused).toBeUndefined();
    // Asked to renew a refused token while MAL can't be reached: the failure, not a refusal.
    expect(liveLink("mal", "p", true, offline.deps)).rejects.toBeInstanceOf(TypeError);
    await Promise.resolve();
    expect(offline.kept()?.refused).toBeUndefined();
  });

  test("past the refresh token's month there is nothing to renew; AniList's links never renew", async () => {
    const gone = setup({ ...base, expiresAt: NOW - 1, refreshBy: NOW - 1 }, renewed);
    expect(await liveLink("mal", "p", false, gone.deps)).toBeUndefined();
    const anilist = setup({ ...base, refreshToken: undefined, refreshBy: undefined }, undefined);
    expect((await liveLink("anilist", "p", false, anilist.deps))?.token).toBe("OLD");
    expect(await liveLink("anilist", "p", true, anilist.deps)).toBeUndefined();
  });
});

describe("the queue and the list sync with MAL", () => {
  afterEach(() => setListSyncDeps(undefined));

  test("a token MAL refuses mid-send is renewed once and the send goes on", async () => {
    const storage = memory();
    let link: Link = {
      token: "OLD",
      expiresAt: NOW + 1000,
      refreshToken: "R",
      refreshBy: NOW + 1000,
      userId: 77,
      userName: "",
      scoreFormat: "POINT_10",
      adult: false,
    };
    const tokens: string[] = [];
    const d: QueueDeps = {
      storage,
      liveLink: async (_s, renew) => (renew ? (link = { ...link, token: "NEW" }) : link),
      saveLink: async (_s, l) => void (link = l),
      client: {
        name: "MyAnimeList",
        entryFor: async () => null,
        saveEntry: async (_m, _c, caller) => {
          tokens.push(caller.token);
          if (caller.token === "OLD") throw new SignedOut("MyAnimeList");
          return {} as ListEntry;
        },
        deleteEntry: async () => {},
      },
    };
    enqueue("mal", "p", { kind: "set", mediaId: 21, change: { score: 8 } }, storage);
    expect(await flush("mal", "p", d)).toBe("done");
    expect(tokens).toEqual(["OLD", "NEW"]);
    expect(pendingOps("mal", "p", storage)).toEqual([]);
    expect(link.refused).toBeUndefined();

    // A renew that can't reach MAL keeps everything for later, the link unrefused.
    d.liveLink = async (_s, renew) => (renew ? Promise.reject(new TypeError("down")) : { ...link, token: "OLD" });
    enqueue("mal", "p", { kind: "set", mediaId: 21, change: { score: 9 } }, storage);
    expect(await flush("mal", "p", d)).toBe("offline");
    expect(pendingOps("mal", "p", storage)).toHaveLength(1);
    expect(link.refused).toBeUndefined();
  });

  test("an episode watched goes to each linked service under that service's id", async () => {
    const storage = memory();
    const link: Link = { token: "TOKEN", expiresAt: NOW + 1000, userId: 7, userName: "", scoreFormat: "POINT_10", adult: false };
    setListSyncDeps({
      storage,
      getLink: async (service) => (service === "mal" ? link : undefined),
      liveLink: async () => undefined,
      listEpisode: (v) =>
        v === "kitsu:3:2" ? { anilist: 5, mal: 21, episode: 2, total: 12 } : v === "kitsu:4:1" ? { anilist: 6, episode: 1, total: 1 } : undefined,
      flush: async () => "done",
      changedSince: async () => [],
    });
    setListSpace("p");
    await syncList();
    await noteWatched(["kitsu:3:2", "kitsu:4:1"]);
    expect(pendingOps("mal", "p", storage)).toEqual([{ kind: "watched", mediaId: 21, episode: 2, total: 12 }]);
    expect(pendingOps("anilist", "p", storage)).toEqual([]);
  });
});
