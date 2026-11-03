import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSettings } from "../lib/queries";
import { prefersReducedMotion } from "../lib/reducedMotion";
import { youtubeEmbed } from "./Trailer";

/** How long a title's page shows its art before the trailer takes over. */
const DELAY_MS = 4000;
const ORIGIN = "https://www.youtube-nocookie.com";

/**
 * A title's trailer playing behind its page, Netflix-style: after a few
 * seconds on the page the art cross-fades into the trailer (muted unless
 * Settings say otherwise), and back to the art when it ends. Settings →
 * Browsing turns it off.
 *
 * The video only shows once YouTube says it's actually playing, so a slow
 * start, an embed-blocked trailer or an error never shows a spinner or an
 * error box over the art. `active` false (another page on top, the player
 * open) removes it; `paused` (scrolled down to the episodes, a sheet open)
 * pauses it behind the art.
 */
export function useBackdropTrailer(ytId: string | undefined, { active, paused = false }: { active: boolean; paused?: boolean }) {
  const { data: settings } = useSettings();
  const enabled = !!ytId && (settings?.trailerAutoplay ?? true) && !prefersReducedMotion();
  const frame = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(!(settings?.trailerSound ?? false));
  const heard = useRef(false);

  // A different title starts over.
  useEffect(() => {
    setEnded(false);
    setPlaying(false);
    setMounted(false);
  }, [ytId]);

  // Wait a moment on the page; leaving it removes the player (and its sound).
  useEffect(() => {
    if (!enabled || !active || ended) {
      setMounted(false);
      setPlaying(false);
      return;
    }
    if (mounted) return;
    const t = window.setTimeout(() => setMounted(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled, active, ended, mounted]);

  const send = useCallback((func: string, args: unknown[] = []) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), ORIGIN);
  }, []);

  // Settings load asynchronously and can change while a preview is mounted.
  useEffect(() => {
    setMuted(!(settings?.trailerSound ?? false));
  }, [settings?.trailerSound]);

  useEffect(() => {
    if (!mounted) return;
    send(muted ? "mute" : "unMute");
  }, [mounted, muted, send]);

  // YouTube's player reports its state over postMessage once we say we're listening.
  useEffect(() => {
    if (!mounted) return;
    heard.current = false;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== "string") return;
      let data: { event?: string; info?: unknown };
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      heard.current = true;
      const state =
        data.event === "onStateChange"
          ? Number(data.info)
          : data.event === "infoDelivery" && data.info && typeof data.info === "object"
            ? (data.info as { playerState?: number }).playerState
            : undefined;
      if (data.event === "onError") setEnded(true);
      if (state === 1) setPlaying(true);
      if (state === 0) {
        setPlaying(false);
        // Let the art fade back in before the player goes.
        window.setTimeout(() => setEnded(true), 900);
      }
    };
    window.addEventListener("message", onMessage);
    // Keep saying so until the player has loaded enough to hear it.
    let tries = 0;
    const hello = window.setInterval(() => {
      if (heard.current || tries++ > 20) return window.clearInterval(hello);
      frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: ytId, channel: "widget" }), ORIGIN);
    }, 400);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(hello);
    };
  }, [mounted, ytId]);

  useEffect(() => {
    if (!mounted) return;
    send(paused ? "pauseVideo" : "playVideo");
  }, [paused, mounted, send]);

  const toggleMute = () => {
    setMuted(!muted);
  };

  // Fixed per mount: muting later goes over postMessage, not a reload.
  const src = useMemo(
    () => (mounted && ytId ? youtubeEmbed(ytId, { muted, controls: false, api: true }) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, ytId],
  );
  const visible = mounted && playing && !paused;
  const node =
    mounted && ytId ? (
      <div className="backdrop-trailer" data-visible={visible} aria-hidden>
        <iframe
          ref={frame as RefObject<HTMLIFrameElement>}
          src={src}
          title=""
          tabIndex={-1}
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    ) : null;

  return { node, visible, muted, toggleMute };
}

/**
 * Whether the page holding `ref` is the one on top (`data-active` on its
 * `.page` / `.tv-page`), kept up to date as pages are pushed and popped.
 */
export function usePageOnTop(ref: RefObject<HTMLElement | null>) {
  const [onTop, setOnTop] = useState(true);
  useEffect(() => {
    const page = ref.current?.closest<HTMLElement>(".page, .tv-page");
    if (!page) return;
    const read = () => setOnTop(page.dataset.active !== "false");
    read();
    const mo = new MutationObserver(read);
    mo.observe(page, { attributes: true, attributeFilter: ["data-active"] });
    return () => mo.disconnect();
  }, [ref]);
  return onTop;
}
