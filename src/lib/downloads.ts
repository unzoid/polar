import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { queryClient } from "./queries";
import { errorMessage } from "./errors";
import type { ContentType, MetaPreview, RankedStream, Stream, Video } from "./types";

/**
 * Downloads (src-tauri/src/downloads.rs): a movie or an episode saved to this
 * device. You pick the source (the download sheet shows the same list as
 * Sources), then the backend copies it down. The list is polled while
 * anything is moving; nothing else needs live updates.
 */

export type DownloadState = "downloading" | "paused" | "done" | "failed";

export interface Download {
  /** The video id: one download per movie or episode. */
  id: string;
  metaId: string;
  type: ContentType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  thumbnail?: string;
  quality: string;
  file: string;
  received: number;
  total?: number;
  state: DownloadState;
  error?: string;
  addedAt: number;
}

const downloadsKey = ["downloads"] as const;

export function useDownloads() {
  return useQuery({
    queryKey: downloadsKey,
    queryFn: () => invoke<Download[]>("downloads_list"),
    // Poll only while a transfer is running.
    refetchInterval: (q) => (q.state.data?.some((d) => d.state === "downloading") ? 1000 : false),
    staleTime: Infinity,
  });
}

const refresh = () => queryClient.invalidateQueries({ queryKey: downloadsKey });

// --- Starting: finding a source takes a moment and can fail; the button shows both.

type Pending = { kind: "finding" } | { kind: "error"; message: string };
const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setPending = (id: string, p: Pending | null) => {
  if (p) pending.set(id, p);
  else pending.delete(id);
  emit();
};
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Where one video stands: its download record, or that it's being started, or why that failed. */
export function useDownload(videoId: string | undefined) {
  const { data } = useDownloads();
  const p = useSyncExternalStore(subscribe, () => (videoId ? pending.get(videoId) : undefined));
  return { download: videoId ? data?.find((d) => d.id === videoId) : undefined, pending: p };
}

/** A source the backend can copy as a file: a link. */
export const downloadable = (s: Stream) => !!s.url;

/** Start downloading `pick`, the source chosen in the download sheet. */
export async function startDownload(item: MetaPreview, video: Video | undefined, pick: RankedStream) {
  const type = item.type;
  const videoId = video?.id ?? item.id;
  setPending(videoId, { kind: "finding" });
  try {
    if (!downloadable(pick.stream)) throw new Error("This source plays in a browser and can't be downloaded.");
    await invoke("download_start", {
      req: {
        metaId: item.id,
        type,
        videoId,
        name: item.name,
        poster: item.poster ?? null,
        background: item.background ?? null,
        logo: item.logo ?? null,
        season: video?.season ?? null,
        episode: video?.episode ?? null,
        episodeTitle: video?.title ?? null,
        thumbnail: video?.thumbnail ?? null,
        quality: pick.label.replace(/ · [\d.]+ [MG]B$/, ""),
        stream: pick.stream,
      },
    });
    setPending(videoId, null);
  } catch (e) {
    setPending(videoId, { kind: "error", message: errorMessage(e) });
  }
  await refresh();
}

export async function pauseDownload(id: string) {
  await invoke("download_pause", { id });
  await refresh();
}

export async function resumeDownload(id: string) {
  await invoke("download_resume", { id });
  await refresh();
}

// --- Leaving: a removed download's row folds away before it's gone from the list.

/** How long the exit takes; matches `.download-row[data-leaving]` in screens.css. */
const LEAVE_MS = 220;
const leaving = new Set<string>();

/** True while `id`'s row is playing its exit. */
export function useLeaving(id: string) {
  return useSyncExternalStore(subscribe, () => leaving.has(id));
}

/** True while every one of `ids` is leaving (a title's last rows going: the title goes too). */
export function useAllLeaving(ids: string[]) {
  return useSyncExternalStore(subscribe, () => ids.length > 0 && ids.every((id) => leaving.has(id)));
}

export async function removeDownload(id: string) {
  setPending(id, null);
  leaving.add(id);
  emit();
  await new Promise((r) => setTimeout(r, LEAVE_MS));
  try {
    await invoke("download_remove", { id });
    await refresh();
  } finally {
    leaving.delete(id);
    emit();
  }
}

/** Show the file in Explorer / Finder. */
export const revealDownload = (id: string) => invoke("download_reveal", { id });

/** 0–1, or undefined while the size is unknown. */
export const downloadFraction = (d: Download) => (d.total ? Math.min(1, d.received / d.total) : undefined);

/** A path on this machine (a download), not a URL. Mirrors `is_local` in downloads.rs. */
export const isLocalFile = (url?: string) => !!url && !url.includes("://") && /^([a-zA-Z]:[\\/]|\/)/.test(url);

/** The stream to hand the player: the file on disk. */
export const localStream = (d: Download): Stream => ({ url: d.file, title: d.quality });
