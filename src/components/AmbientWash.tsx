import { useEffect, useRef, useState } from "react";

/**
 * The art shrunk to a few pixels: stretched back up, the browser's smoothing
 * turns it into one soft gradient of the image's main colours — no busy detail
 * showing through, and no per-frame blur cost. Drawing a cross-origin image is
 * fine; only reading its pixels back would be blocked.
 */
export function AmbientWash({ src, current }: { src?: string; current: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      // Two steps so the tiny version averages the whole picture, not a few pixels of it.
      const mid = document.createElement("canvas");
      mid.width = 48;
      mid.height = 27;
      const m = mid.getContext("2d");
      if (!m) return;
      m.imageSmoothingQuality = "high";
      m.drawImage(img, 0, 0, mid.width, mid.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(mid, 0, 0, ctx.canvas.width, ctx.canvas.height);
      setReady(true);
    };
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);

  return <canvas ref={canvas} width={4} height={3} data-current={current && ready} />;
}
