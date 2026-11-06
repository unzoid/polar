import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { call, inShell, on, type Unlisten } from "../platform/bridge";
import { onFileDrag as onWindowFileDrag } from "../platform/window";
import { isDesktop } from "../platform/device";
import { shortHash } from "../party/links";
import { FILE_PREFIX, fileId, isFileId } from "./ids";
import { queryClient } from "../net/queryClient";
import { keys } from "../net/queryKeys";
import type { Route } from "../router";
import type { Meta, Stream } from "../types";

/**
 * Video files on this device (#204): opened from the file dialog, dropped on the window, or again
 * from Recent files. The native side decides which paths the player may open
 * (src-tauri/src/local_files.rs); here they become a title the player already knows how to play:
 * one file is a movie, several (or a file's folder) are a series whose episodes are the files in
 * order, so Next Episode, the Episodes list and resume work as for anything else.
 *
 * Nothing about them is synced: Recent files, and where each stopped, stay on this device.
 */

export interface LocalFile {
  path: string;
  /** With its extension. */
  name: string;
  size: number;
}

export interface RecentFile extends LocalFile {
  /** Seconds. */
  position: number;
  duration: number;
  /** Unix milliseconds. */
  openedAt: number;
}

export { FILE_PREFIX, fileId, isFileId };

/** Desktop windows take dropped files and have a file dialog; phones don't yet. */
export const canOpenFiles = isDesktop && inShell;

/** As src-tauri/src/local_files.rs's VIDEO_EXTENSIONS: only used to word the drop hint. */
const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|flv|ts|m2ts|mts|mpg|mpeg|ogv|3gp|vob)$/i;

/** "Episode 01.mkv" → "Episode 01". */
export const fileTitle = (name: string) => name.replace(/\.[^.]+$/, "") || name;
/** "film.mkv" → "MKV". */
export const fileKind = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? "").toUpperCase().slice(0, 4);

const native = {
  pick: () => call<LocalFile[]>("local_pick"),
  folder: (path: string) => call<LocalFile[]>("local_folder", { path }),
  recent: () => call<RecentFile[]>("local_recent"),
  reopen: (path: string) => call<LocalFile>("local_reopen", { path }),
  seen: (path: string, position: number, duration: number, opened: boolean) =>
    call<void>("local_seen", { path, position, duration, opened }),
  forget: (path: string | null) => call<void>("local_forget", { path }),
};

const recentQuery = { queryKey: keys.recentFiles, queryFn: () => (canOpenFiles ? native.recent() : Promise.resolve([])) };
export const useRecentFiles = () => useQuery(recentQuery);
const refreshRecent = () => void queryClient.invalidateQueries({ queryKey: keys.recentFiles });

/** Where `videoId` stopped last time, from Recent files. */
export function recentPosition(videoId: string): Pick<RecentFile, "position" | "duration"> | undefined {
  return queryClient.getQueryData<RecentFile[]>(keys.recentFiles)?.find((r) => fileId(r.path) === videoId);
}

/**
 * A file's length and where it stopped, from its Recent files entry (#242): `length` when it's known,
 * `stopped` only while it's part-way (not at the start, not at the end).
 */
export function filePlace(r: Pick<RecentFile, "position" | "duration"> | undefined): { length?: number; stopped?: number } {
  if (!r || !(r.duration > 0)) return {};
  return { length: r.duration, stopped: r.position > 0 && r.position < r.duration ? r.position : undefined };
}

/** The files of titles opened this session, by video id: Next Episode plays the next one's path. */
const byId = new Map<string, LocalFile>();
export function fileStream(videoId: string): Stream | undefined {
  const f = byId.get(videoId);
  return f && { url: f.path, name: fileTitle(f.name) };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const folderName = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] || fileTitle(path);

/** The title the player gets for `files`: their own id (a hash, never the path), names and order. */
export function filesMeta(files: LocalFile[]): Meta {
  const series = files.length > 1;
  return {
    id: `${FILE_PREFIX}${shortHash(files.map((f) => f.path).join("\n"))}`,
    type: series ? "series" : "movie",
    name: series ? folderName(files[0].path) : fileTitle(files[0].name),
    videos: files.map((f, i) => ({ id: fileId(f.path), title: fileTitle(f.name), season: 1, episode: i + 1 })),
  };
}

/**
 * The player route for `files`, starting at `start`. One file brings its folder's other videos
 * along, so a folder of episodes plays in order; several play in name order.
 */
export async function playFiles(files: LocalFile[], start = files[0]): Promise<Route | null> {
  if (!start) return null;
  let queue = [...files].sort((a, b) => collator.compare(a.name, b.name));
  if (files.length === 1) {
    const folder = await native.folder(start.path).catch(() => []);
    if (folder.some((f) => f.path === start.path)) queue = folder;
  }
  // Where each file stopped, before the player asks.
  await queryClient.fetchQuery({ ...recentQuery, staleTime: 0 }).catch(() => []);
  const meta = filesMeta(queue);
  for (const f of queue) byId.set(fileId(f.path), f);
  queryClient.setQueryData(keys.meta(meta.type, meta.id), meta);
  const videoId = fileId(start.path);
  return { name: "player", type: meta.type, metaId: meta.id, videoId, stream: fileStream(videoId) };
}

/** The system's file dialog; the videos picked, none when cancelled. */
export const pickFiles = () => native.pick();

/** The player route for a recent file (its folder comes along); rejects when it's no longer on this device. */
export async function playRecent(path: string): Promise<Route | null> {
  return playFiles([await native.reopen(path)]);
}

/** Take a file (or, with none, every file) off Recent files. */
export const forgetRecent = (path: string | null) => native.forget(path).finally(refreshRecent);

/** Where playback of `path` is (a negative `position` keeps the last); `opened` puts it at the top of Recent files. */
export function noteFile(path: string, position: number, duration: number, opened = false) {
  return native.seen(path, position, duration, opened).then(refreshRecent, () => {});
}

// --- Dropping files on the window -----------------------------------------------------------------

/** `dropped`: the drag ended on the window; the files follow in `onFilesDropped`. */
export type DragState = { over: false; dropped?: boolean } | { over: true; videos: number; folders: number; others: number };

/** What's being dragged over the window, from its paths. */
export function describeDrag(paths: string[]): DragState {
  let videos = 0;
  let folders = 0;
  let others = 0;
  for (const p of paths) {
    if (VIDEO.test(p)) videos++;
    else if (!/\.[^\\/.]+$/.test(p)) folders++; // no extension: most likely a folder
    else others++;
  }
  return { over: true, videos, folders, others };
}

/** Files dragged over the window (enter and leave only: the hint doesn't follow the pointer). */
export function onFileDrag(handler: (state: DragState) => void): Promise<Unlisten> {
  if (!canOpenFiles) return Promise.resolve(() => {});
  return onWindowFileDrag((e) => handler(e.type === "enter" ? describeDrag(e.paths) : { over: false, dropped: e.type === "drop" }));
}

/** The videos dropped on the window, once the player may open them (empty when none were videos). */
export const onFilesDropped = (handler: (files: LocalFile[]) => void): Promise<Unlisten> =>
  canOpenFiles ? on<LocalFile[]>("local-files://dropped", handler) : Promise.resolve(() => {});

// --- The Open Files window ------------------------------------------------------------------------

let open = false;
const listeners = new Set<() => void>();
export function setOpenFilesOpen(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}
export const useOpenFilesOpen = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
