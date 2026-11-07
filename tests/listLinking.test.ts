import "./storageStub";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SignedOut, type Viewer } from "../src/lib/lists/anilistList";
import { changeEntry, fitScore, linkAniList, linkState, NotASignIn, removeEntry, scoreScale, unlinkAniList, type LinkingDeps } from "../src/lib/lists/linking";
import type { Link } from "../src/lib/lists/linkStore";
import { entriesKey, keepEntry, seenEntry, setListSyncDeps } from "../src/lib/lists/listSync";
import { enqueue, pendingOps, queueKey } from "../src/lib/lists/queue";

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (claims: object) => `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.c2lnbmF0dXJlc2lnbmF0dXJl`;
const NOW = 1_800_000_000_000;
const who: Viewer = { id: 7, name: "Someone", scoreFormat: "POINT_5", adult: false };

function deps(over: Partial<LinkingDeps> = {}) {
  const links = new Map<string | null, Link>();
  const changed: (string | null)[] = [];
  const d: LinkingDeps = {
    now: () => NOW,
    viewer: async () => who,
    saveLink: async (s, l) => void links.set(s, l),
    removeLink: async (s) => void links.delete(s),
    storage: localStorage,
    changed: (s) => void changed.push(s),
    ...over,
  };
  return { d, links, changed };
}

beforeEach(() => {
  // The list sync keeps entries where the queue does: the stub's localStorage.
  setListSyncDeps({
    storage: localStorage,
    now: () => NOW,
    getLink: async () => undefined,
    listEpisode: () => undefined,
    flush: async () => "empty",
    changedSince: async () => [],
  });
});
afterEach(() => {
  for (const s of ["p", "q"]) {
    localStorage.removeItem(queueKey(s));
    localStorage.removeItem(entriesKey(s));
  }
  setListSyncDeps(undefined);
});

test("linking keeps the pasted sign-in with who AniList says it is", async () => {
  const t = deps();
  const token = jwt({ exp: NOW / 1000 + 3600 });
  const link = await linkAniList("p", `  ${token} `, t.d);
  expect(link).toEqual({ token, expiresAt: NOW + 3600_000, userId: 7, userName: "Someone", scoreFormat: "POINT_5", adult: false });
  expect(t.links.get("p")).toEqual(link);
  expect(t.changed).toEqual(["p"]);
});

test("what isn't a sign-in, or one AniList refuses, links nothing", async () => {
  const t = deps({ viewer: async () => Promise.reject(new SignedOut()) });
  expect(linkAniList("p", "not a code", t.d)).rejects.toBeInstanceOf(NotASignIn);
  expect(linkAniList("p", jwt({ exp: NOW / 1000 + 60 }), t.d)).rejects.toBeInstanceOf(SignedOut);
  await Promise.resolve();
  expect(t.links.size).toBe(0);
  expect(t.changed).toEqual([]);
});

test("unlinking drops the link, the waiting changes and the kept entries of that profile only", async () => {
  const t = deps();
  await linkAniList("p", jwt({ sub: "1" }), t.d);
  enqueue("p", { kind: "watched", mediaId: 5, episode: 1, total: 12 });
  enqueue("q", { kind: "watched", mediaId: 5, episode: 1, total: 12 });
  keepEntry("p", { id: 1, mediaId: 5, status: "CURRENT", progress: 1, score: 0, repeat: 0, updatedAt: 1 });
  await unlinkAniList("p", t.d);
  expect(t.links.has("p")).toBe(false);
  expect(pendingOps("p")).toEqual([]);
  expect(pendingOps("q")).toHaveLength(1);
  expect(seenEntry(5, "p")).toBeUndefined();
  expect(t.changed).toEqual(["p", "p"]);
});

test("a change from the page is queued and kept as AniList will have it", () => {
  const added = changeEntry("p", 5, null, { status: "PLANNING" }, NOW);
  expect(added).toMatchObject({ mediaId: 5, status: "PLANNING", progress: 0, score: 0 });
  const scored = changeEntry("p", 5, added, { score: 4 }, NOW);
  expect(scored).toMatchObject({ status: "PLANNING", score: 4 });
  expect(seenEntry(5, "p")).toEqual(scored);
  // One after another, they go out as one.
  expect(pendingOps("p")).toEqual([{ kind: "set", mediaId: 5, change: { status: "PLANNING", score: 4 } }]);
  // A new entry with only a score still goes out with a status.
  changeEntry("p", 6, null, { score: 2 }, NOW);
  expect(pendingOps("p").at(-1)).toEqual({ kind: "set", mediaId: 6, change: { status: "PLANNING", score: 2 } });
  removeEntry("p", 5);
  expect(seenEntry(5, "p")).toBeUndefined();
  expect(pendingOps("p").at(-1)).toEqual({ kind: "remove", mediaId: 5 });
});

test("the link's state", () => {
  const link: Link = { token: "TOKEN", expiresAt: NOW + 1, userId: 1, userName: "", scoreFormat: "POINT_10", adult: false };
  expect(linkState(undefined, NOW)).toBe("none");
  expect(linkState(link, NOW)).toBe("linked");
  expect(linkState({ ...link, expiresAt: NOW }, NOW)).toBe("expired");
  expect(linkState({ ...link, refused: true }, NOW)).toBe("refused");
});

test("scores fit the account's format", () => {
  expect(scoreScale("POINT_100")).toEqual({ max: 100, step: 1 });
  expect(scoreScale("POINT_3").labels).toHaveLength(3);
  expect(scoreScale("POINT_5").labels).toHaveLength(5);
  expect(scoreScale("anything else")).toEqual({ max: 10, step: 1 });
  expect(fitScore(7.46, scoreScale("POINT_10_DECIMAL"))).toBe(7.5);
  expect(fitScore(7.6, scoreScale("POINT_10"))).toBe(8);
  expect(fitScore(140, scoreScale("POINT_100"))).toBe(100);
  expect(fitScore(-3, scoreScale("POINT_10"))).toBe(0);
  expect(fitScore(Number("x"), scoreScale("POINT_10"))).toBeNull();
});
