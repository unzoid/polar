import { beforeAll, describe, expect, test } from "bun:test";
import type { MetaPreview } from "../src/lib/types";

/** playlists.ts keeps its state in localStorage from the moment it loads: give it one first. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let pl: typeof import("../src/lib/library/playlists");
beforeAll(async () => {
  pl = await import("../src/lib/library/playlists");
});

const title = (id: string) => ({ id, type: "movie", name: id }) as MetaPreview;
const saved = (space: string) => JSON.parse(store.get(`polar.playlists.${space}`) ?? "null");

describe("playlists across sign-in and sign-out (critique M12)", () => {
  test("the guest's playlists are copied into the first profile, waiting to be pushed", () => {
    const kept = pl.createPlaylist("Weekend", title("tt1"));
    const gone = pl.createPlaylist("Old");
    pl.deletePlaylist(gone.id);

    pl.importLocalPlaylists("p1");
    const p1 = saved("p1");
    expect(p1.playlists.map((p: { id: string }) => p.id)).toEqual([kept.id]);
    expect(p1.dirty).toEqual([kept.id]);
    expect(p1.pulledAt).toBeNull();
    // Copied, like the library: the device's own stay.
    expect(saved("local").playlists).toHaveLength(2);

    // Twice adds nothing.
    pl.importLocalPlaylists("p1");
    expect(saved("p1").playlists).toHaveLength(1);
  });

  test("importing into the active profile shows them at once", () => {
    pl.setPlaylistSpace("p2");
    expect(pl.playlistChanges().rows).toHaveLength(0);
    pl.importLocalPlaylists("p2");
    expect(pl.playlistChanges().rows.map((r) => r.name)).toEqual(["Weekend"]);
    pl.setPlaylistSpace(null);
  });

  test("forgetting a profile removes its copy; the active one falls back to the device's", () => {
    pl.setPlaylistSpace("p1");
    pl.createPlaylist("Mine");
    expect(saved("p1").playlists).toHaveLength(2);

    pl.forgetPlaylists("p1");
    expect(store.has("polar.playlists.p1")).toBe(false);
    expect(pl.playlistChanges().space).toBe("local");
    // Nothing was written back under the forgotten profile.
    expect(store.has("polar.playlists.p1")).toBe(false);

    pl.forgetPlaylists("p2");
    expect(store.has("polar.playlists.p2")).toBe(false);
    // The device's own are never forgotten.
    pl.forgetPlaylists("local");
    expect(saved("local").playlists).toHaveLength(2);
  });
});

describe("pushing a profile that isn't shown (sign-out)", () => {
  test("its changes come from storage and the receipt clears them there", () => {
    pl.setPlaylistSpace("p3");
    pl.createPlaylist("Later");
    pl.setPlaylistSpace(null);

    expect(pl.unpushedPlaylists("p3")).toBe(1);
    const lists = pl.playlistChanges("p3");
    expect(lists.space).toBe("p3");
    expect(lists.rows.map((r) => r.name)).toEqual(["Later"]);
    pl.markPlaylistsPushed("p3", lists.receipt);
    expect(pl.unpushedPlaylists("p3")).toBe(0);
    // The shown space wasn't touched.
    expect(pl.playlistChanges().space).toBe("local");
  });

  test("a receipt for a forgotten profile doesn't bring it back", () => {
    pl.setPlaylistSpace("p4");
    pl.createPlaylist("Gone");
    pl.setPlaylistSpace(null);
    const lists = pl.playlistChanges("p4");
    pl.forgetPlaylists("p4");
    pl.markPlaylistsPushed("p4", lists.receipt);
    expect(store.has("polar.playlists.p4")).toBe(false);
  });
});

describe("playlists from a newer version (critique H5)", () => {
  const v2 = Uint8Array.from([2, 9, 9, 9]);

  test("the codec says it can't read them instead of handing back an empty list", async () => {
    const { decodeItems, encodeItems } = await import("../src/lib/library/playlistCodec");
    expect(decodeItems(v2)).toBeNull();
    const ok = encodeItems([{ id: "tt0000100", type: "movie" }, { id: "kitsu:5", type: "series" }]);
    expect(decodeItems(ok)).toEqual([{ id: "tt0000100", type: "movie" }, { id: "kitsu:5", type: "series" }]);
    // Cut short: nothing half-read.
    expect(decodeItems(ok.subarray(0, ok.length - 2))).toBeNull();
    expect(decodeItems(new Uint8Array())).toBeNull();
  });

  test("they are kept as they came, take no titles, and a rename sends the same bytes back", async () => {
    pl.setPlaylistSpace("p5");
    pl.applyRemotePlaylists("p5", [{ id: "n1", name: "From later", items: v2, deleted: false, updatedAt: 10 }], "c1");
    const kept = saved("p5").playlists[0];
    expect(kept.items).toEqual([]);
    expect(kept.packed).toBe("\\x02090909");

    pl.addToPlaylist("n1", title("tt1"));
    expect(pl.unpushedPlaylists("p5")).toBe(0);
    const { playlistRows } = await import("../src/lib/library/playlistChecklist");
    expect(playlistRows(saved("p5").playlists, "tt1")).toEqual([]);

    pl.renamePlaylist("n1", "Renamed");
    const rows = pl.playlistChanges().rows;
    expect(rows.map((r) => [r.name, [...r.items]])).toEqual([["Renamed", [...v2]]]);

    // Read back from storage (restart) the same way.
    pl.setPlaylistSpace(null);
    pl.setPlaylistSpace("p5");
    expect(saved("p5").playlists[0].packed).toBe("\\x02090909");

    pl.deletePlaylist("n1");
    const gone = saved("p5").playlists[0];
    expect(gone.deleted && gone.packed === undefined).toBe(true);
    pl.setPlaylistSpace(null);
  });
});

describe("the playlist limit (critique H4)", () => {
  test("no more than MAX_PLAYLISTS live ones; a deleted one makes room", () => {
    pl.setPlaylistSpace("p6");
    for (let i = 0; i < pl.MAX_PLAYLISTS; i++) expect(pl.createPlaylist(`L${i}`)).not.toBeNull();
    expect(pl.createPlaylist("One too many")).toBeNull();
    pl.deletePlaylist(saved("p6").playlists[0].id);
    expect(pl.createPlaylist("Room again")).not.toBeNull();
    pl.setPlaylistSpace(null);
  });
});
