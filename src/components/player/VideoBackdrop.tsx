import { useEffect, useRef } from "react";
import { call } from "../../lib/platform";
import { isMpv, type MediaLike } from "./mpvMedia";

const W = 160;
const H = 90;
/** The crop's canvas: a small, tall pill-shaped window onto the frame (see `crop`). */
const CROP_W = 64;
const CROP_H = 256;
const FPS = 12;
/** mpv frames come from snapshots; refresh slowly — it's out of focus anyway. */
const SNAPSHOT_EVERY = 1500;

/**
 * A live, frosted copy of the video for overlays.
 *
 * `backdrop-filter` can't be trusted over video on Windows: Chromium hands
 * <video> to a hardware overlay plane, and mpv draws in a native window under
 * the page — either way the filter has nothing to sample. So we blur the
 * picture ourselves: draw it into a tiny 160×90 canvas with a canvas blur and
 * let the GPU scale it up. Blurring at thumbnail size is ~100× cheaper than
 * blurring the full frame, and the upscale makes it even softer.
 *
 *  - <video>: drawn directly, ~12 fps.
 *  - mpv: a JPEG snapshot of the current frame, every 1.5s.
 */
export function VideoBackdrop({ media, className, crop = false }: { media: MediaLike | null; className?: string; crop?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!media || !el || !ctx) return;
    ctx.filter = crop ? "blur(8px) saturate(140%)" : "blur(4px) saturate(115%)";
    // The first frame marks the canvas ready: the CSS fades it in over the live
    // video only then, so opening never shows an empty (black) backdrop.
    const paint = (src: CanvasImageSource, srcW: number, srcH: number) => {
      if (crop) paintCrop(el, ctx, src, srcW, srcH);
      // Overdraw by the blur radius so edges don't fade to transparent.
      else ctx.drawImage(src, -6, -6, W + 12, H + 12);
      el.dataset.ready = "";
    };

    if (isMpv(media)) {
      let stopped = false;
      const snap = async () => {
        try {
          const url = await call<string>("mpv_snapshot");
          const img = new Image();
          img.onload = () => !stopped && paint(img, img.naturalWidth, img.naturalHeight);
          img.src = url;
        } catch {
          /* nothing decoded yet — the shade alone still reads fine */
        }
      };
      void snap();
      const t = window.setInterval(snap, SNAPSHOT_EVERY);
      return () => {
        stopped = true;
        window.clearInterval(t);
        delete el.dataset.ready;
      };
    }

    const video = media as HTMLVideoElement;
    let painted = false;
    const draw = () => {
      if (video.readyState < 2) return;
      try {
        paint(video, video.videoWidth, video.videoHeight);
        painted = true;
      } catch {
        /* decoder not ready — try next frame */
      }
    };

    // A paused or ended video produces no frame callbacks, and may not have a
    // decoded frame yet when the overlay opens — so also paint when one lands.
    const events = ["loadeddata", "seeked", "canplay"] as const;
    events.forEach((e) => video.addEventListener(e, draw));
    draw();
    let last = 0;
    let handle = 0;
    let rafMode = true;
    let stopped = false;
    const hasRvfc = "requestVideoFrameCallback" in video;
    const loop = (now: number) => {
      if (stopped) return;
      if (!painted || now - last >= 1000 / FPS) {
        last = now;
        draw();
      }
      // Until the first paint, poll per animation frame (paused video gives no callbacks).
      handle = hasRvfc && painted ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
      rafMode = !(hasRvfc && painted);
    };
    handle = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      events.forEach((e) => video.removeEventListener(e, draw));
      if (rafMode) cancelAnimationFrame(handle);
      else video.cancelVideoFrameCallback(handle);
      delete el.dataset.ready;
    };
  }, [media]);

  return <canvas ref={canvas} className={className ? `video-backdrop ${className}` : "video-backdrop"} width={crop ? CROP_W : W} height={crop ? CROP_H : H} aria-hidden />;
}

/**
 * Draw just the part of the frame that sits behind `el`, so a small frosted
 * panel shows what is really under it. The picture is placed as the player
 * places it (centred, whole, `contain`) inside the player, and `el`'s layout
 * position there picks the crop. Layout offsets, not bounding rects: they ignore
 * the panel's slide-in transform and any interface zoom.
 */
function paintCrop(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number) {
  const player = el.closest<HTMLElement>(".player");
  if (!player || !srcW || !srcH) return;
  let x = 0;
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== player; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  const scale = Math.min(player.offsetWidth / srcW, player.offsetHeight / srcH);
  const ox = (player.offsetWidth - srcW * scale) / 2;
  const oy = (player.offsetHeight - srcH * scale) / 2;
  // Overdraw by a few blur radii (in the panel's own px) so the edges stay opaque.
  const k = el.width / el.offsetWidth;
  const m = 28 / k;
  ctx.clearRect(0, 0, el.width, el.height);
  ctx.drawImage(
    src,
    (x - m - ox) / scale,
    (y - m - oy) / scale,
    (el.offsetWidth + 2 * m) / scale,
    (el.offsetHeight + 2 * m) / scale,
    -28,
    -28,
    el.width + 56,
    el.height + 56,
  );
}
