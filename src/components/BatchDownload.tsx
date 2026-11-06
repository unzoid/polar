import {
  batchFraction,
  batchKey,
  cancelBatch,
  downloadBatch,
  pauseBatch,
  resumeBatch,
  useBatch,
  useDownloads,
} from "../lib/library";
import type { MetaPreview, Video } from "../lib/types";
import { Close, Download, Pause, Play } from "./icons";
import { Button, IconButton } from "./ui/Button";

/**
 * Download a whole season, or a whole show, as one batch (#24; lib/library/batchDownloads.ts):
 * one button to start, then the batch's progress with Pause / Resume and Cancel.
 */
export function BatchDownload({ item, videos, season }: { item: MetaPreview; videos: Video[]; season?: number }) {
  const key = batchKey(item.id, season);
  const batch = useBatch(key);
  const { data: downloads } = useDownloads();
  const what = season === undefined ? "Show" : "Season";
  const have = videos.filter((v) => downloads?.some((d) => d.id === v.id && d.state === "done")).length;

  if (batch && (batch.state === "running" || batch.state === "paused")) {
    const percent = Math.round(batchFraction(batch) * 100);
    const status =
      batch.state === "paused"
        ? `Paused · ${batch.done} of ${batch.total}`
        : `Downloading ${Math.min(batch.done + batch.failed + 1, batch.total)} of ${batch.total} · ${percent}%`;
    return (
      <div className="batch-download" data-state={batch.state} role="group" aria-label={`${what} download`}>
        <span className="batch-download-status t-caption" aria-live="polite">
          {status}
        </span>
        <span className="batch-download-bar" aria-hidden>
          <span style={{ transform: `scaleX(${percent / 100})` }} />
        </span>
        {batch.state === "paused" ? (
          <IconButton variant="glass" label={`Resume ${what} Download`} title="Resume" onClick={() => resumeBatch(key)}>
            <Play size={16} fill="currentColor" />
          </IconButton>
        ) : (
          <IconButton variant="glass" label={`Pause ${what} Download`} title="Pause" onClick={() => pauseBatch(key)}>
            <Pause size={16} />
          </IconButton>
        )}
        <IconButton variant="glass" label={`Cancel ${what} Download`} title="Cancel: the episode coming down is removed, finished ones stay" onClick={() => cancelBatch(key)}>
          <Close size={16} />
        </IconButton>
      </div>
    );
  }

  const all = videos.length > 0 && have === videos.length;
  const failed = batch?.state === "finished" && batch.failed > 0 ? batch.failed : 0;
  return (
    <Button
      variant="glass"
      size={season === undefined ? undefined : "sm"}
      className="batch-download-start"
      disabled={all || !videos.length}
      onClick={() => void downloadBatch(key, item, videos)}
      title={
        failed
          ? `${failed} ${failed === 1 ? "episode" : "episodes"} had no source that could be downloaded. Click to try again.`
          : all
            ? `Every episode of this ${what.toLowerCase()} is downloaded`
            : `Download every episode of this ${what.toLowerCase()}${have ? ` (${have} already here)` : ""}`
      }
    >
      <Download size={16} />
      {all ? `${what} Downloaded` : failed ? `Download ${what} (${failed} left)` : `Download ${what}`}
    </Button>
  );
}
