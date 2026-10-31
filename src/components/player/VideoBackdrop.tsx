import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { isMpv, type MediaLike } from "./mpvMedia";

const W = 160;
const H = 90;
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
export function VideoBackdrop({ media }: { media: MediaLike | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!media || !ctx) return;
    ctx.filter = "blur(4px) saturate(115%)";
    // Overdraw by the blur radius so edges don't fade to transparent.
    const paint = (src: CanvasImageSource) => ctx.drawImage(src, -6, -6, W + 12, H + 12);

    if (isMpv(media)) {
      let stopped = false;
      const snap = async () => {
        try {
          const url = await invoke<string>("mpv_snapshot");
          const img = new Image();
          img.onload = () => !stopped && paint(img);
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
      };
    }

    const video = media as HTMLVideoElement;
    let painted = false;
    const draw = () => {
      if (video.readyState < 2) return;
      try {
        paint(video);
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
    };
  }, [media]);

  return <canvas ref={canvas} className="video-backdrop" width={W} height={H} aria-hidden />;
}
