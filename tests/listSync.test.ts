import "./storageStub";
import { expect, test } from "bun:test";
import { anilistAuthorizeUrl, readSignIn, ANILIST_TOKEN_LIFE } from "../src/lib/lists/signIn";
import { afterWatching } from "../src/lib/lists/progressRule";
import { enqueue, flush, pendingOps, type QueueDeps } from "../src/lib/lists/queue";
import { linkName, readLink, type Link } from "../src/lib/lists/linkStore";
import { ListError, SignedOut, type EntryChange, type ListEntry } from "../src/lib/lists/anilistList";

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: object) => `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.c2lnbmF0dXJlc2lnbmF0dXJl`;
const NOW = 1_800_000_000_000;

test("the sign-in page needs a registered client", () => {
  expect(anilistAuthorizeUrl("")).toBeNull();
  expect(anilistAuthorizeUrl("abc")).toBeNull();
  expect(anilistAuthorizeUrl("1234")).toBe("https://anilist.co/api/v2/oauth/authorize?client_id=1234&response_type=token");
});

test("a pasted token is read with its own expiry", () => {
  const token = jwt({ sub: "1", exp: NOW / 1000 + 3600 });
  expect(readSignIn(`  ${token}\n`, NOW)).toEqual({ token, expiresAt: NOW + 3600_000 });
});

test("a token without exp lasts AniList's year", () => {
  const token = jwt({ sub: "1" });
  expect(readSignIn(token, NOW)?.expiresAt).toBe(NOW + ANILIST_TOKEN_LIFE);
});

test("a redirect link's fragment gives the token and expires_in", () => {
  const token = jwt({ sub: "1", exp: NOW / 1000 + 10 });
  const got = readSignIn(`polarity://auth/anilist#access_token=${token}&token_type=Bearer&expires_in=31536000`, NOW);
  expect(got).toEqual({ token, expiresAt: NOW + 31_536_000_000 });
});

test("what isn't a token is refused", () => {
  expect(readSignIn("", NOW)).toBeNull();
  expect(readSignIn("hello there", NOW)).toBeNull();
  expect(readSignIn("https://example.com/#state=x", NOW)).toBeNull();
  expect(readSignIn(jwt({ exp: NOW / 1000 - 1 }), NOW)).toBeNull();
  expect(readSignIn(`${jwt({})}<script>`, NOW)).toBeNull();
});

const entry = (status: ListEntry["status"], progress: number, repeat = 0): ListEntry => ({
  id: 9,
  mediaId: 5,
  status,
  progress,
  score: 0,
  repeat,
  updatedAt: 0,
});

test("watching an episode moves the entry as the issue says", () => {
  expect(afterWatching(null, 1, 12)).toEqual({ status: "CURRENT", progress: 1 });
  expect(afterWatching(entry("PLANNING", 0), 3, 12)).toEqual({ status: "CURRENT", progress: 3 });
  expect(afterWatching(entry("PAUSED", 5), 3, 12)).toEqual({ status: "CURRENT", progress: 5 });
  expect(afterWatching(entry("CURRENT", 4), 5, 12)).toEqual({ progress: 5 });
  expect(afterWatching(entry("CURRENT", 6), 5, 12)).toBeNull();
  expect(afterWatching(entry("CURRENT", 11), 12, 12)).toEqual({ status: "COMPLETED", progress: 12 });
  expect(afterWatching(null, 1, 1)).toEqual({ status: "COMPLETED", progress: 1 });
  expect(afterWatching(entry("COMPLETED", 12), 1, 12)).toEqual({ status: "REPEATING", progress: 1 });
  expect(afterWatching(entry("COMPLETED", 12), 12, 12)).toBeNull();
  expect(afterWatching(entry("REPEATING", 3, 1), 12, 12)).toEqual({ status: "COMPLETED", progress: 12, repeat: 2 });
  expect(afterWatching(entry("CURRENT", 2), 30, null)).toEqual({ progress: 30 });
  expect(afterWatching(entry("CURRENT", 2), 0, 12)).toBeNull();
});

test("a link is read back only whole", () => {
  expect(linkName("anilist", null)).toBe("polar.link.anilist.local");
  expect(readLink("{")).toBeUndefined();
  expect(readLink(JSON.stringify({ token: "t", expiresAt: 1 }))).toBeUndefined();
  expect(readLink(JSON.stringify({ token: "t", expiresAt: 1, userId: 2, userName: "someone" }))).toEqual({
    token: "t",
    expiresAt: 1,
    userId: 2,
    userName: "someone",
    scoreFormat: "POINT_10",
    adult: false,
  });
});

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function deps(over: Partial<QueueDeps> = {}) {
  const storage = memory();
  let link: Link | undefined = { token: "TOKEN", expiresAt: NOW + 1000, userId: 7, userName: "x", scoreFormat: "POINT_10", adult: false };
  const saved: [number, EntryChange][] = [];
  const removed: number[] = [];
  const entries = new Map<number, ListEntry>();
  const d: QueueDeps = {
    storage,
    now: () => NOW,
    getLink: async () => link,
    saveLink: async (_s, l) => void (link = l),
    entryFor: async (_u, m) => entries.get(m) ?? null,
    saveEntry: async (m, c) => {
      saved.push([m, c]);
      return { ...entry("CURRENT", 0), mediaId: m };
    },
    deleteEntry: async (id) => void removed.push(id),
    ...over,
  };
  return { d, saved, removed, entries, link: () => link };
}

test("the queue keeps the later episode of an entry and drops what a removal covers", () => {
  const s = memory();
  enqueue("p", { kind: "watched", mediaId: 5, episode: 2, total: 12 }, s);
  enqueue("p", { kind: "watched", mediaId: 5, episode: 3, total: 12 }, s);
  enqueue("p", { kind: "watched", mediaId: 6, episode: 1, total: 12 }, s);
  expect(pendingOps("p", s).map((o) => o.kind === "watched" && o.episode)).toEqual([3, 1]);
  enqueue("p", { kind: "remove", mediaId: 5 }, s);
  expect(pendingOps("p", s)).toEqual([
    { kind: "watched", mediaId: 6, episode: 1, total: 12 },
    { kind: "remove", mediaId: 5 },
  ]);
  expect(pendingOps("other", s)).toEqual([]);
});

test("flush sends in order, reading each entry first", async () => {
  const t = deps();
  t.entries.set(5, entry("COMPLETED", 12));
  t.entries.set(8, entry("CURRENT", 1));
  enqueue("p", { kind: "watched", mediaId: 5, episode: 1, total: 12 }, t.d.storage);
  enqueue("p", { kind: "set", mediaId: 6, change: { score: 8 } }, t.d.storage);
  enqueue("p", { kind: "remove", mediaId: 8 }, t.d.storage);
  expect(await flush("p", t.d)).toBe("done");
  expect(t.saved).toEqual([
    [5, { status: "REPEATING", progress: 1 }],
    [6, { score: 8 }],
  ]);
  expect(t.removed).toEqual([9]);
  expect(pendingOps("p", t.d.storage)).toEqual([]);
});

test("offline keeps the queue; a refused token marks the link and keeps it too", async () => {
  const off = deps({ entryFor: async () => Promise.reject(new TypeError("Failed to fetch")) });
  enqueue("p", { kind: "watched", mediaId: 5, episode: 1, total: 12 }, off.d.storage);
  expect(await flush("p", off.d)).toBe("offline");
  expect(pendingOps("p", off.d.storage)).toHaveLength(1);

  const busy = deps({ saveEntry: async () => Promise.reject(new ListError("busy", 503)) });
  enqueue("p", { kind: "set", mediaId: 5, change: { score: 1 } }, busy.d.storage);
  expect(await flush("p", busy.d)).toBe("offline");
  expect(pendingOps("p", busy.d.storage)).toHaveLength(1);

  const out = deps({ entryFor: async () => Promise.reject(new SignedOut()) });
  enqueue("p", { kind: "watched", mediaId: 5, episode: 1, total: 12 }, out.d.storage);
  expect(await flush("p", out.d)).toBe("signed-out");
  expect(out.link()?.refused).toBe(true);
  expect(pendingOps("p", out.d.storage)).toHaveLength(1);
  expect(await flush("p", out.d)).toBe("signed-out");
});

test("a change AniList rejects is dropped so the rest still go", async () => {
  let first = true;
  const t = deps({
    saveEntry: async (m, c) => {
      if (first) {
        first = false;
        throw new ListError("validation", 400);
      }
      t.saved.push([m, c]);
      return entry("CURRENT", 0);
    },
  });
  enqueue("p", { kind: "set", mediaId: 5, change: { score: 99 } }, t.d.storage);
  enqueue("p", { kind: "set", mediaId: 6, change: { score: 1 } }, t.d.storage);
  expect(await flush("p", t.d)).toBe("done");
  expect(t.saved).toEqual([[6, { score: 1 }]]);
});

test("the queue never holds the token", () => {
  const s = memory();
  enqueue("p", { kind: "watched", mediaId: 5, episode: 1, total: 12 }, s);
  expect(s.getItem("polar.lists.queue.anilist.p")).not.toContain("TOKEN");
});
