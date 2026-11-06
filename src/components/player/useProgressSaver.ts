import { useCallback, useEffect, useRef, type RefObject } from "react";
import { api } from "../../lib/api";
import { sync } from "../../lib/account";
import { isLocalFile } from "../../lib/library";
import { isFileId, noteFile } from "../../lib/localFiles";
import { keys, queryClient } from "../../lib/net";
import type { ContentType, Meta, Progress, Video } from "../../lib/types";
import type { MediaLike } from "./mpvMedia";
import type { useSource } from "./useSource";

/** While playing, progress is saved at most this often (and on pause, end and leaving). */
const SAVE_EVERY = 5000;

/**
 * Saves where the viewer is in this video: `save` now, `saveIfDue` from time
 * reports (every SAVE_EVERY while playing), and once more when the player
 * closes, which also refreshes Continue Watching and History.
 */
export function useProgressSaver({
  media,
  meta,
  type,
  metaId,
  videoId,
  current,
  state,
}: {
  media: RefObject<MediaLike | null>;
  meta?: Meta;
  type: ContentType;
  metaId: string;
  videoId: string;
  current?: Video;
  state: ReturnType<typeof useSource>["state"];
}) {
  const lastSave = useRef(0);
  const local = isFileId(metaId);
  const save = useCallback(() => {
    const v = media.current;
    if (!v || !v.duration || !Number.isFinite(v.duration) || !meta || state.status !== "ready") return;
    lastSave.current = Date.now();
    // A file on this device (#204): where it stopped stays on this device, never in the synced library.
    if (local) return void noteFile(state.url, v.currentTime, v.duration);
    const p: Progress = {
      metaId,
      videoId,
      type,
      name: meta.name,
      background: meta.background,
      poster: meta.poster,
      season: current?.season,
      episode: current?.episode,
      episodeTitle: current?.title,
      // A download plays from a file that may be deleted later: resuming
      // from Continue Watching picks an online source instead.
      stream: isLocalFile(state.stream?.url) ? undefined : state.stream,
      position: v.currentTime,
      duration: v.duration,
      updatedAt: 0,
    };
    api.saveProgress(p).then(sync.schedule, () => {});
  }, [media, meta, metaId, videoId, type, current, state, local]);

  // Opening a file on this device puts it at the top of Recent files.
  const openedPath = local && state.status === "ready" ? state.url : undefined;
  useEffect(() => {
    if (openedPath) void noteFile(openedPath, -1, 0, true);
  }, [openedPath]);

  const saveIfDue = useCallback(() => {
    if (Date.now() - lastSave.current > SAVE_EVERY && media.current && !media.current.paused) save();
  }, [media, save]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      saveRef.current();
      queryClient.invalidateQueries({ queryKey: keys.progress(metaId) });
      queryClient.invalidateQueries({ queryKey: keys.continue });
      queryClient.invalidateQueries({ queryKey: keys.history });
    },
    [metaId],
  );
  return { save, saveIfDue };
}
