import { expect, test } from "bun:test";
import { freshPlaylistName, inAnyPlaylist, playlistRows } from "../src/lib/library/playlistChecklist";
import type { Playlist } from "../src/lib/library/playlists";

const list = (id: string, name: string, ids: string[]): Playlist => ({
  id,
  name,
  items: ids.map((i) => ({ id: i, type: "movie" })),
  updatedAt: 0,
});

test("rows say which playlists hold the title", () => {
  const playlists = [list("a", "Weekend", ["tt1", "tt2"]), list("b", "Later", [])];
  expect(playlistRows(playlists, "tt2")).toEqual([
    { id: "a", name: "Weekend", count: 2, has: true },
    { id: "b", name: "Later", count: 0, has: false },
  ]);
  expect([inAnyPlaylist(playlists, "tt2"), inAnyPlaylist(playlists, "tt3"), inAnyPlaylist([], "tt1")]).toEqual([true, false, false]);
});

test("a new playlist's name skips the taken ones", () => {
  expect(freshPlaylistName([])).toBe("New Playlist");
  expect(freshPlaylistName(["New Playlist"])).toBe("New Playlist 2");
  expect(freshPlaylistName(["New Playlist", "New Playlist 2", "New Playlist 4"])).toBe("New Playlist 3");
  expect(freshPlaylistName(["New Playlist 2"])).toBe("New Playlist");
});
