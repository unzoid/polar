import { useEffect, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { Close, Trailer as TrailerIcon } from "./icons";

/** YouTube's privacy-enhanced player for a trailer, with YouTube's clutter turned down. */
export function youtubeEmbed(ytId: string, opts: { muted?: boolean; controls?: boolean; api?: boolean } = {}) {
  const id = encodeURIComponent(ytId);
  const q = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    playsinline: "1",
    iv_load_policy: "3",
    modestbranding: "1",
    ...(opts.muted ? { mute: "1" } : {}),
    ...(opts.controls === false ? { controls: "0", disablekb: "1", fs: "0" } : {}),
    ...(opts.api ? { enablejsapi: "1", origin: window.location.origin } : {}),
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${q}`;
}

export const youtubeUrl = (ytId: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}`;

interface Open {
  ytId: string;
  name: string;
}

let current: Open | null = null;
const listeners = new Set<() => void>();
const set = (next: Open | null) => {
  current = next;
  listeners.forEach((l) => l());
};

/** Play a title's trailer over the app (desktop mode; TV mode has its own panel). */
export const openTrailer = (ytId: string, name: string) => set({ ytId, name });
export const closeTrailer = () => set(null);
export const useTrailerOpen = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );

/** The trailer, big and centred over a dimmed app. Esc or a click outside closes it. */
export function TrailerHost() {
  const open = useTrailerOpen();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeTrailer();
    };
    // Capture: before the app's own Esc (Back).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (!open) return null;
  return (
    <div className="trailer-layer" role="dialog" aria-label={`${open.name} trailer`} onClick={(e) => e.target === e.currentTarget && closeTrailer()}>
      <div className="trailer-box">
        <iframe
          className="trailer-video"
          src={youtubeEmbed(open.ytId)}
          title={`${open.name} trailer`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <div className="trailer-bar">
          <span className="trailer-name t-headline">{open.name}</span>
          <button className="btn btn-glass" onClick={() => void api.openExternal(youtubeUrl(open.ytId))}>
            <TrailerIcon size={16} /> Open in YouTube
          </button>
          <button className="btn btn-glass btn-icon" onClick={closeTrailer} aria-label="Close trailer" title="Close (Esc)">
            <Close size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
