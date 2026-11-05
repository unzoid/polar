import { useEffect, useRef, useState, type RefObject } from "react";
import { useSettings } from "../lib/net";
import { prefersReducedMotion } from "../lib/ui";
import { type Bars, barsZoom, findBars, useFileTrailer } from "../lib/playback";

/** How long a title's page shows its art before the trailer takes over. */
const DELAY_MS = 4000;
/** Frames looked at for bars, and how far apart. */
const SAMPLES = 5;
const SAMPLE_EVERY_MS = 1500;
/** The zoom when frames can't be read: enough for slim bars, under the page's edge gradients. */
const FALLBACK_ZOOM = 1.08;

/**
 * A title's trailer playing behind its page. Only a trailer the app has as a
 * video file (IMDb's, up to 1080p, in a plain <video>): never a YouTube
 * embed, whose terms don't allow UI over the player. A title without one
 * keeps its art. After a few seconds on the page the art cross-fades into
 * the trailer (muted unless Settings say otherwise), and back to the art
 * when it ends. Settings → Browsing turns it off.
 *
 * The video only shows once it's actually playing, so a slow start or an
 * error never shows a spinner or black over the art. `active` false (another
 * page on top, the player open) removes it; `paused` (scrolled down to the
 * episodes, a sheet open) pauses it behind the art.
 */
export function useBackdropTrailer(imdbId: string | undefined, { active, paused = false }: { active: boolean; paused?: boolean }) {
  const { data: settings } = useSettings();
  const allowed = (settings?.trailerAutoplay ?? true) && !prefersReducedMotion();
  const fileUrl = useFileTrailer(imdbId, allowed).data?.url;
  const enabled = !!fileUrl && allowed;
  const video = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(!(settings?.trailerSound ?? false));
  // Asked for with CORS first, so its frames can be looked at for bars; a host that won't allow it gets a plain request.
  const [cors, setCors] = useState(true);
  const [zoom, setZoom] = useState<string>();
  const bars = useRef<Bars | null>(null);

  // A different title starts over.
  useEffect(() => {
    setEnded(false);
    setPlaying(false);
    setMounted(false);
    setCors(true);
    setZoom(undefined);
    bars.current = null;
  }, [fileUrl]);

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

  // Settings load asynchronously and can change while a preview is mounted.
  useEffect(() => {
    setMuted(!(settings?.trailerSound ?? false));
  }, [settings?.trailerSound]);

  useEffect(() => {
    if (mounted && video.current) video.current.muted = muted;
  }, [mounted, muted]);

  useEffect(() => {
    const v = video.current;
    if (mounted && v) void (paused ? v.pause() : v.play().catch(() => {}));
  }, [paused, mounted]);

  // Bars inside the picture (test report 1, item 16): measured on a few frames over the first
  // seconds, keeping the least seen on each side, so a dark shot never zooms in further. Frames that
  // can't be read (no CORS) get a fixed zoom the page's gradients cover.
  const measure = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    if (!cors) return setZoom(`scale(${FALLBACK_ZOOM})`);
    const w = 160;
    const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
    const ctx = Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d", { willReadFrequently: true });
    let found: Bars | null;
    try {
      ctx!.drawImage(v, 0, 0, w, h);
      found = findBars(ctx!.getImageData(0, 0, w, h).data, w, h);
    } catch {
      return setZoom(`scale(${FALLBACK_ZOOM})`);
    }
    if (!found) return;
    const was = bars.current;
    const least = was ? { top: Math.min(was.top, found.top), bottom: Math.min(was.bottom, found.bottom), left: Math.min(was.left, found.left), right: Math.min(was.right, found.right) } : found;
    bars.current = least;
    const box = v.getBoundingClientRect();
    const z = box.width && box.height ? barsZoom(least, v.videoWidth / v.videoHeight, box.width / box.height) : null;
    setZoom(z ? `translate(${(z.x * 100).toFixed(2)}%, ${(z.y * 100).toFixed(2)}%) scale(${z.scale.toFixed(3)})` : undefined);
  };
  useEffect(() => {
    if (!mounted || !playing) return;
    let n = 0;
    const t = window.setInterval(() => {
      measure();
      if (++n >= SAMPLES) window.clearInterval(t);
    }, SAMPLE_EVERY_MS);
    return () => window.clearInterval(t);
    // measure reads refs and state that only change with these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, playing, cors]);

  const finish = () => {
    setPlaying(false);
    // Let the art fade back in before the player goes.
    window.setTimeout(() => setEnded(true), 900);
  };

  const toggleMute = () => {
    setMuted(!muted);
  };

  const visible = mounted && playing && !paused;
  const node =
    mounted && fileUrl ? (
      <div className="backdrop-trailer" data-visible={visible} aria-hidden>
        <video
          key={cors ? "cors" : "plain"}
          ref={video}
          src={fileUrl}
          crossOrigin={cors ? "anonymous" : undefined}
          autoPlay
          muted={muted}
          playsInline
          tabIndex={-1}
          style={zoom ? { transform: zoom } : undefined}
          // Only shows once it's actually playing (and its bars are measured): a slow start never covers the art with black.
          onPlaying={() => {
            measure();
            setPlaying(true);
          }}
          onEnded={finish}
          onError={() => (cors ? setCors(false) : setEnded(true))}
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
