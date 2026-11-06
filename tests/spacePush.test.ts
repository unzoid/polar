import { describe, expect, test } from "bun:test";
import { AccountError, type PushResult } from "../src/lib/account/backend";
import { pushEach, pushSpace, unpushedCount, type PushDeps } from "../src/lib/account/spacePush";
import type { AnimeLink } from "../src/lib/library/identity";
import type { LocalChanges, Progress, Pushed, SyncLibraryItem } from "../src/lib/types";

const item = (id: string, updatedAt = 1) => ({ id, updatedAt }) as unknown as SyncLibraryItem;
const entry = (videoId: string, updatedAt = 1) => ({ videoId, updatedAt }) as unknown as Progress;
const link = (anilist: number, updatedAt = 1) => ({ anilist, updatedAt }) as unknown as AnimeLink;

/** A device with spaces of unpushed rows, and a server that takes them unless told otherwise. */
function fake(spaces: Record<string, Partial<LocalChanges>>, server: { down?: Set<string>; noLinks?: boolean; unsent?: string[]; full?: PushResult["full"] } = {}) {
  const pushed: Record<string, LocalChanges[keyof LocalChanges][]> = {};
  const marked: Record<string, Pushed> = {};
  const deps: PushDeps = {
    async changes(space) {
      const s = spaces[space] ?? {};
      return { library: s.library ?? [], progress: s.progress ?? [], links: s.links ?? [], pulledAt: null };
    },
    async push(space, changes) {
      if (server.down?.has(space)) throw new Error("offline");
      pushed[space] = [changes.library, changes.progress, changes.links];
      return { links: !server.noLinks, unsent: server.unsent ?? [], ...(server.full && { full: server.full }) };
    },
    async markPushed(space, receipt) {
      marked[space] = receipt;
      const s = spaces[space];
      const has = (ids: [unknown, number][], id: unknown, at: number) => ids.some(([i, t]) => i === id && t === at);
      spaces[space] = {
        library: s.library?.filter((i) => !has(receipt.library, i.id, i.updatedAt)),
        progress: s.progress?.filter((p) => !has(receipt.progress, p.videoId, p.updatedAt)),
        links: s.links?.filter((l) => !has(receipt.links, l.anilist, l.updatedAt)),
      };
    },
  };
  return { deps, pushed, marked };
}

describe("pushSpace", () => {
  test("pushes the changes and marks each by the time it carried", async () => {
    const { deps, pushed, marked } = fake({ a: { library: [item("tt1", 5)], progress: [entry("tt2:1:1", 6)] } });
    await pushSpace("a", deps);
    expect(pushed.a).toEqual([[item("tt1", 5)], [entry("tt2:1:1", 6)], []]);
    expect(marked.a).toEqual({ library: [["tt1", 5]], progress: [["tt2:1:1", 6]], links: [] });
    expect(await unpushedCount(["a"], deps.changes)).toBe(0);
  });

  test("nothing changed: no request, nothing marked", async () => {
    const { deps, pushed, marked } = fake({ a: {} });
    await pushSpace("a", deps);
    expect(pushed.a).toBeUndefined();
    expect(marked.a).toBeUndefined();
  });

  test("progress of a title the backend couldn't send stays unpushed; the rest is marked (#94)", async () => {
    const titled = (metaId: string, videoId: string) => ({ ...entry(videoId), metaId }) as Progress;
    const progress = [titled("tt2", "tt2:1:1"), titled("tt5", "tt5"), titled("tt5", "tt5:x")];
    const { deps, marked } = fake({ a: { library: [item("tt1")], progress } }, { unsent: ["tt5"] });
    await pushSpace("a", deps);
    expect(marked.a).toEqual({ library: [["tt1", 1]], progress: [["tt2:1:1", 1]], links: [] });
    expect(await unpushedCount(["a"], deps.changes)).toBe(2);
  });

  test("a server without the links table leaves the links unpushed", async () => {
    const { deps, marked } = fake({ a: { library: [item("tt1")], links: [link(1)] } }, { noLinks: true });
    await pushSpace("a", deps);
    expect(marked.a.links).toEqual([]);
    expect(await unpushedCount(["a"], deps.changes)).toBe(1);
  });

  test("a kind the account has no room for stays unpushed, the rest is marked, and the error comes back (#110)", async () => {
    const error = new AccountError("library_limit", "The account's library is full.");
    const { deps, marked } = fake(
      { a: { library: [item("tt1")], progress: [entry("tt2:1:1")], links: [link(1)] } },
      { full: { kinds: ["library", "links"], error } },
    );
    expect((await pushSpace("a", deps)).full).toBe(error);
    expect(marked.a).toEqual({ library: [], progress: [["tt2:1:1", 1]], links: [] });
    expect(await unpushedCount(["a"], deps.changes)).toBe(2);
  });

  test("a failed push is not marked", async () => {
    const { deps } = fake({ a: { library: [item("tt1")] } }, { down: new Set(["a"]) });
    await expect(pushSpace("a", deps)).rejects.toThrow("offline");
    expect(await unpushedCount(["a"], deps.changes)).toBe(1);
  });
});

describe("before sign-out", () => {
  test("one profile failing doesn't stop the others, and what's left is counted", async () => {
    const { deps } = fake(
      {
        a: { library: [item("tt1")], progress: [entry("tt1"), entry("tt2")] },
        b: { progress: [entry("tt3")], links: [link(5)] },
        c: { library: [item("tt4")] },
      },
      { down: new Set(["a"]) },
    );
    await pushEach(["a", "b", "c"], (s) => pushSpace(s, deps));
    expect(await unpushedCount(["a", "b", "c"], deps.changes)).toBe(3);
  });
});
