import type { Playlist } from "./playlists";

/** One playlist as a tickable row of the add-to-playlist lists (docs/ui-components.md U10). */
export interface PlaylistRow {
  id: string;
  name: string;
  /** How many titles it holds. */
  count: number;
  /** Whether the title is in it. */
  has: boolean;
}

/** Playlists from a newer version (`packed`) can't take titles here, so they aren't offered. */
export const playlistRows = (playlists: Playlist[], itemId: string): PlaylistRow[] =>
  playlists.filter((p) => !p.packed).map((p) => ({ id: p.id, name: p.name, count: p.items.length, has: p.items.some((i) => i.id === itemId) }));

export const inAnyPlaylist = (playlists: Playlist[], itemId: string) => playlists.some((p) => p.items.some((i) => i.id === itemId));

/** "New Playlist", or "New Playlist 2" and so on if that's taken. */
export function freshPlaylistName(taken: string[]) {
  const names = new Set(taken);
  let n = 1;
  while (names.has(n === 1 ? "New Playlist" : `New Playlist ${n}`)) n++;
  return n === 1 ? "New Playlist" : `New Playlist ${n}`;
}
