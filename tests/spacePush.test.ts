import { describe, expect, test } from "bun:test";
import { pushEach, pushSpace, unpushedCount, type PushDeps } from "../src/lib/account/spacePush";
import type { AnimeLink } from "../src/lib/library/identity";
import type { LocalChanges, Progress, SyncLibraryItem } from "../src/lib/types";

const item = (id: string) => ({ id }) as unknown as SyncLibraryItem;
const entry = (id: string) => ({ id }) as unknown as Progress;
const link = (id: string) => ({ anilist: id }) as unknown as AnimeLink;

/** A device with spaces of unpushed rows, and a server that takes them unless told otherwise. */
function fake(spaces: Record<string, Partial<LocalChanges>>, server: { down?: Set<string>; noLinks?: boolean } = {}) {
  const pushed: Record<string, LocalChanges[keyof LocalChanges][]> = {};
  const deps: PushDeps = {
    async changes(space) {
      const s = spaces[space] ?? {};
      return { library: s.library ?? [], progress: s.progress ?? [], links: s.links ?? [], cursor: 7, pulledAt: null };
    },
    async push(space, changes) {
      if (server.down?.has(space)) throw new Error("offline");
      pushed[space] = [changes.library, changes.progress, changes.links];
      return { links: !server.noLinks };
    },
    async markPushed(space) {
      spaces[space] = {};
    },
  };
  return { deps, pushed };
}

describe("pushSpace", () => {
  test("pushes the changes and marks them pushed", async () => {
    const { deps, pushed } = fake({ a: { library: [item("tt1")], progress: [entry("tt2")] } });
    const r = await pushSpace("a", deps);
    expect(pushed.a).toEqual([[item("tt1")], [entry("tt2")], []]);
    expect(r.linksUnsent).toBe(false);
    expect(await unpushedCount(["a"], deps.changes)).toBe(0);
  });

  test("nothing changed: no request, still marked", async () => {
    const { deps, pushed } = fake({ a: {} });
    await pushSpace("a", deps);
    expect(pushed.a).toBeUndefined();
  });

  test("a server without the links table leaves the links unsent", async () => {
    const { deps } = fake({ a: { links: [link("1")] } }, { noLinks: true });
    expect((await pushSpace("a", deps)).linksUnsent).toBe(true);
  });

  test("links unsent before stay unsent until they can go in full", async () => {
    const { deps, pushed } = fake({ a: {}, b: {} });
    expect((await pushSpace("a", deps, { wasUnsent: true })).linksUnsent).toBe(true);
    const all = [link("1"), link("2")];
    expect((await pushSpace("b", deps, { wasUnsent: true, allLinks: all })).linksUnsent).toBe(false);
    expect(pushed.b[2]).toEqual(all);
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
        b: { progress: [entry("tt3")], links: [link("5")] },
        c: { library: [item("tt4")] },
      },
      { down: new Set(["a"]) },
    );
    await pushEach(["a", "b", "c"], (s) => pushSpace(s, deps));
    expect(await unpushedCount(["a", "b", "c"], deps.changes)).toBe(3);
  });
});
