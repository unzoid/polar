import type { Stream, VideoFile } from "../types";

/**
 * The request headers an add-on says its link needs
 * (`behaviorHints.proxyHeaders.request`), handed to mpv_load and stream_probe.
 * Rust keeps only the ones playback may send (crates/player/src/headers.rs).
 */
export function requestHeaders(stream: Pick<Stream, "behaviorHints"> | undefined): Record<string, string> | null {
  const proxy = stream?.behaviorHints?.proxyHeaders;
  const request = proxy && typeof proxy === "object" ? (proxy as Record<string, unknown>).request : undefined;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(request)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** What a stream's hints say about its file (`behaviorHints.videoSize`, `filename`), for subtitle add-ons. */
export function videoFile(stream: Pick<Stream, "behaviorHints"> | undefined): VideoFile {
  const hints = stream?.behaviorHints;
  const size = hints?.videoSize;
  const name = hints?.filename;
  return {
    size: typeof size === "number" && Number.isSafeInteger(size) && size > 0 ? size : undefined,
    name: typeof name === "string" && name.trim() ? name.trim() : undefined,
  };
}
