import { useSyncExternalStore } from "react";
import type { RemotePlaylist } from "../account/backend";
import { count, contentType, isRecord, listOf, str, storedJson, strings } from "../parse";
import { decodeItems, encodeItems, fromHex, toHex, type PlaylistRef } from "./playlistCodec";
import type { MetaPreview } from "../types";

/**
 * Playlists: named, ordered lists of titles, per profile. Local-first like
 * the library: kept in localStorage (with names and posters, so they draw at
 * once) and synced in the background by account/sync.ts, which only ever
 * sends the packed titles (playlistCodec), never the artwork.
 */
export interface PlaylistItem extends PlaylistRef {
  /** Display cache; titles that arrive by sync are looked up instead. */
  name?: string;
  poster?: string;
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
  updatedAt: number;
  deleted?: boolean;
  /**
   * Titles from a newer version of Polar, as they came (Postgres hex): `items` is empty, the
   * titles can't change here, and a rename sends these bytes back untouched (critique H5).
   */
  packed?: string;
}

export interface Space {
  playlists: Playlist[];
  /** Ids changed here since the last push. */
  dirty: string[];
  pulledAt: string | null;
}

export const MAX_PLAYLIST_ITEMS = 500;
/** The account keeps up to 100 live playlists a profile (the server refuses more: `playlist_limit`). */
export const MAX_PLAYLISTS = 100;
const LOCAL = "local";
const HEX = /^\\x([0-9a-f]{2})*$/i;
const storageKey = (space: string) => `polar.playlists.${space}`;

function load(space: string): Space {
  return readSpace(storedJson(localStorage, storageKey(space)));
}

/** A stored space as far as it can be read: playlists or items that don't fit are left out (critique M9). */
export function readSpace(v: unknown): Space {
  if (!isRecord(v)) return { playlists: [], dirty: [], pulledAt: null };
  const playlists = listOf(v.playlists, readPlaylist);
  const ids = new Set(playlists.map((p) => p.id));
  return { playlists, dirty: strings(v.dirty).filter((id) => ids.has(id)), pulledAt: str(v.pulledAt) ?? null };
}

function readPlaylist(v: unknown): Playlist | undefined {
  if (!isRecord(v)) return;
  const id = str(v.id);
  if (!id) return;
  const items = listOf(v.items, readItem);
  const packed = str(v.packed);
  return {
    id,
    name: str(v.name) ?? "",
    items,
    updatedAt: count(v.updatedAt) ?? 0,
    ...(v.deleted === true && { deleted: true }),
    ...(packed && HEX.test(packed) && { items: [], packed }),
  };
}

function readItem(v: unknown): PlaylistItem | undefined {
  if (!isRecord(v)) return;
  const [id, type, name, poster] = [str(v.id), contentType(v.type), str(v.name), str(v.poster)];
  if (!id || !type) return;
  return { id, type, ...(name && { name }), ...(poster && { poster }) };
}

let spaceId = LOCAL;
let state = load(spaceId);
let visible: Playlist[] = [];
const listeners = new Set<() => void>();

function publish(next: Space) {
  state = next;
  visible = next.playlists.filter((p) => !p.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
  localStorage.setItem(storageKey(spaceId), JSON.stringify(next));
  listeners.forEach((l) => l());
}
publish(state);

/** Called by sync when a profile is chosen (or left: back to the device's own). */
export function setPlaylistSpace(space: string | null) {
  const id = space ?? LOCAL;
  if (id === spaceId) return;
  spaceId = id;
  publish(load(id));
}

/**
 * Drop a profile's playlists from this device (sign-out, deleted profile). Removing the active
 * one goes back to the device's own.
 */
export function forgetPlaylists(space: string) {
  if (space === LOCAL) return;
  localStorage.removeItem(storageKey(space));
  if (space === spaceId) {
    spaceId = LOCAL;
    publish(load(LOCAL));
  }
}

/**
 * First profile of a new account: the playlists made before signing up become its own (copied,
 * like the library), all waiting to be pushed. Ids are kept, so running it twice adds nothing.
 */
export function importLocalPlaylists(into: string) {
  if (into === LOCAL) return;
  const target = into === spaceId ? state : load(into);
  const next = withImported(target, load(LOCAL).playlists);
  if (into === spaceId) publish(next);
  else localStorage.setItem(storageKey(into), JSON.stringify(next));
}

function withImported(target: Space, local: Playlist[]): Space {
  const have = new Set(target.playlists.map((p) => p.id));
  const added = local.filter((p) => !p.deleted && !have.has(p.id));
  return {
    ...target,
    playlists: [...target.playlists, ...added],
    dirty: [...target.dirty, ...added.map((p) => p.id).filter((id) => !target.dirty.includes(id))],
  };
}

let onChange: (() => void) | null = null;
/** Sync registers here, so edits get pushed soon. */
export const onPlaylistChange = (cb: () => void) => void (onChange = cb);

function change(id: string, update: (p: Playlist) => Playlist | null) {
  const current = state.playlists.find((p) => p.id === id);
  if (!current) return;
  const next = update(current);
  if (!next) return;
  publish({
    ...state,
    playlists: state.playlists.map((p) => (p.id === id ? { ...next, updatedAt: Date.now() } : p)),
    dirty: state.dirty.includes(id) ? state.dirty : [...state.dirty, id],
  });
  onChange?.();
}

export function usePlaylists() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => visible,
  );
}

const toItem = (m: MetaPreview): PlaylistItem => ({ id: m.id, type: m.type, name: m.name, poster: m.poster });

/** A new playlist; `null` when the profile already has MAX_PLAYLISTS. */
export function createPlaylist(name: string, first?: MetaPreview): Playlist | null {
  if (visible.length >= MAX_PLAYLISTS) return null;
  const playlist: Playlist = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 60) || "Untitled Playlist",
    items: first ? [toItem(first)] : [],
    updatedAt: Date.now(),
  };
  publish({ ...state, playlists: [...state.playlists, playlist], dirty: [...state.dirty, playlist.id] });
  onChange?.();
  return playlist;
}

export const renamePlaylist = (id: string, name: string) =>
  change(id, (p) => (name.trim() && name.trim() !== p.name ? { ...p, name: name.trim().slice(0, 60) } : null));

/** Kept as a tombstone so the deletion reaches other devices. */
export const deletePlaylist = (id: string) => change(id, ({ packed: _, ...p }) => ({ ...p, items: [], deleted: true }));

export const addToPlaylist = (id: string, item: MetaPreview) =>
  change(id, (p) =>
    p.packed || p.items.some((i) => i.id === item.id) || p.items.length >= MAX_PLAYLIST_ITEMS
      ? null
      : { ...p, items: [...p.items, toItem(item)] },
  );

export const removeFromPlaylist = (id: string, itemId: string) =>
  change(id, (p) => (p.packed ? null : { ...p, items: p.items.filter((i) => i.id !== itemId) }));

/** Move a title within its playlist (drag or keyboard reorder). */
export const moveInPlaylist = (id: string, from: number, to: number) =>
  change(id, (p) => {
    if (p.packed || from === to || to < 0 || to >= p.items.length) return null;
    const items = [...p.items];
    items.splice(to, 0, ...items.splice(from, 1));
    return { ...p, items };
  });

// --- Sync (account/sync.ts) ---------------------------------------------------

/** A profile's playlists, shown or kept in storage (another profile of the account). */
const spaceState = (space: string) => (space === spaceId ? state : load(space));

/**
 * What to push for `space` (the shown one by default), and a receipt to hand back once it's
 * stored. Other profiles' are pushed before sign-out, which forgets them.
 */
export function playlistChanges(space = spaceId): { space: string; rows: RemotePlaylist[]; receipt: Map<string, number> } {
  const s = spaceState(space);
  const rows = s.dirty.flatMap((id) => {
    const p = s.playlists.find((x) => x.id === id);
    if (!p) return [];
    const items = p.packed ? fromHex(p.packed) : encodeItems(p.items);
    return [{ id: p.id, name: p.name, items, deleted: !!p.deleted, updatedAt: p.updatedAt }];
  });
  return { space, rows, receipt: new Map(rows.map((r) => [r.id, r.updatedAt])) };
}

/** Clear what was pushed, unless it changed again meanwhile. */
export function markPlaylistsPushed(space: string, receipt: Map<string, number>) {
  if (!receipt.size) return;
  // Forgotten meanwhile: don't bring it back.
  if (space !== spaceId && localStorage.getItem(storageKey(space)) === null) return;
  const s = spaceState(space);
  const stillDirty = s.dirty.filter((id) => {
    const p = s.playlists.find((x) => x.id === id);
    return !p || receipt.get(id) !== p.updatedAt;
  });
  if (space === spaceId) publish({ ...s, dirty: stillDirty });
  else localStorage.setItem(storageKey(space), JSON.stringify({ ...s, dirty: stillDirty }));
}

/** Playlists of `space` changed here and not yet on the server. */
export const unpushedPlaylists = (space: string) => spaceState(space).dirty.length;

export const playlistsPulledAt = (space: string) => (space === spaceId ? state.pulledAt : null);

export function applyRemotePlaylists(space: string, remote: RemotePlaylist[], cursor: string | null) {
  if (space !== spaceId) return;
  const byId = new Map(state.playlists.map((p) => [p.id, p]));
  for (const r of remote) {
    const local = byId.get(r.id);
    if (local && local.updatedAt >= r.updatedAt) continue;
    // Keep the artwork we already know for titles that are still there.
    const known = new Map(local?.items.map((i) => [i.id, i]));
    const refs = r.deleted ? [] : decodeItems(r.items);
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      items: refs?.map((ref) => ({ ...known.get(ref.id), ...ref })) ?? [],
      updatedAt: r.updatedAt,
      deleted: r.deleted || undefined,
      ...(!refs && { packed: toHex(r.items) }),
    });
  }
  publish({ ...state, playlists: [...byId.values()], pulledAt: cursor });
}
