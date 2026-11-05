import { useEffect, useRef, useState } from "react";

/** How many pixels across the wash is drawn when its blur is baked in: plenty for a gradient. */
const BAKED_WIDTH = 160;

/**
 * The CSS filter (`--wash`) for drawing once into a canvas `width` pixels across that shows
 * `shownWidth` CSS pixels wide: its blur scaled to the canvas's pixels. Null when there is nothing
 * to bake (no filter, or the canvas isn't laid out).
 */
export function bakedFilter(filter: string, shownWidth: number, width: number): string | null {
  const f = filter.trim();
  if (!shownWidth || !f || f === "none") return null;
  return f.replace(/blur\(([\d.]+)px\)/, (_, px: string) => `blur(${+((Number(px) * width) / shownWidth).toFixed(2)}px)`);
}

/**
 * The art shrunk to a few pixels: stretched back up, the browser's smoothing
 * turns it into one soft gradient of the image's main colours — no busy detail
 * showing through. Drawing a cross-origin image is fine; only reading its
 * pixels back would be blocked.
 *
 * The blur and tone (`--wash` in CSS) are drawn into the canvas once, where the
 * browser can filter a canvas (#36): as a CSS filter, a full-screen blur is
 * redone on every frame anything moves over it, and a held direction on TV
 * dropped to a few frames a second. Elsewhere the CSS filter applies as before.
 */
export function AmbientWash({ src, current }: { src?: string; current: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [baked, setBaked] = useState(false);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const cv = canvas.current;
      const ctx = cv?.getContext("2d");
      if (!cv || !ctx) return;
      // Two steps so the tiny version averages the whole picture, not a few pixels of it.
      const mid = document.createElement("canvas");
      mid.width = 48;
      mid.height = 27;
      const tiny = document.createElement("canvas");
      tiny.width = 4;
      tiny.height = 3;
      const m = mid.getContext("2d");
      const t = tiny.getContext("2d");
      if (!m || !t) return;
      m.imageSmoothingQuality = "high";
      m.drawImage(img, 0, 0, mid.width, mid.height);
      t.imageSmoothingQuality = "high";
      t.drawImage(mid, 0, 0, tiny.width, tiny.height);
      const filter = "filter" in ctx ? bakedFilter(getComputedStyle(cv).getPropertyValue("--wash"), cv.clientWidth, BAKED_WIDTH) : null;
      // Resizing resets the context, so the filter is set after.
      cv.width = filter ? BAKED_WIDTH : tiny.width;
      cv.height = filter ? Math.max(1, Math.round((BAKED_WIDTH * cv.clientHeight) / cv.clientWidth)) : tiny.height;
      if (filter) ctx.filter = filter;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(tiny, 0, 0, cv.width, cv.height);
      setBaked(!!filter);
      setReady(true);
    };
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);

  return <canvas ref={canvas} width={4} height={3} data-current={current && ready} data-baked={baked || undefined} />;
}
