import { useEffect, useState } from "react";
import { Img, type ImgProps } from "./Img";

/**
 * A title treatment (logo) that stays readable on dark art. Some logos are
 * drawn in black or near-black for light posters; over our dark backdrops
 * they vanish. Such a logo is shown as a white silhouette instead, the way
 * Apple TV treats them. Measured once per image, off a separate CORS request
 * so the visible <img> never depends on it; if the host doesn't allow it,
 * the logo is simply shown as is.
 */
export function TitleLogo(props: ImgProps & { src?: string }) {
  const dark = useDarkLogo(props.src);
  return <Img {...props} data-logo-tone={dark ? "dark" : undefined} />;
}

const tones = new Map<string, boolean>();

function useDarkLogo(src?: string) {
  const [dark, setDark] = useState(() => (src ? tones.get(src) : false) ?? false);
  useEffect(() => {
    if (!src) return;
    const known = tones.get(src);
    if (known !== undefined) return setDark(known);
    let live = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const isDark = measure(img);
      tones.set(src, isDark);
      if (live) setDark(isDark);
    };
    // A host that won't allow it answers the same every time: don't ask again on every page.
    img.onerror = () => tones.set(src, false);
    img.src = toneUrl(src);
    return () => {
      live = false;
    };
  }, [src]);
  return dark;
}

/**
 * Where to fetch a logo for measuring (test report 1, item 24). metahub's `images.` host redirects to
 * `live.` without allowing CORS, so it goes to `live.` directly. And the URL differs from the visible
 * logo's: TMDB allows CORS only to requests that carry an Origin and doesn't say it varies by it, so a
 * cached answer to the plain <img> would fail this request.
 */
export function toneUrl(src: string): string {
  try {
    const u = new URL(src);
    if (u.hostname === "images.metahub.space") u.hostname = "live.metahub.space";
    u.searchParams.set("tone", "1");
    return u.toString();
  } catch {
    return src;
  }
}

/** True when the logo is inked dark throughout (measured on a downscaled copy). */
function measure(img: HTMLImageElement) {
  try {
    // Wide enough that thin bright detail (a ring, small letters) survives the downscale.
    const w = 128;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w)) || 32;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    return isDarkInk(ctx.getImageData(0, 0, w, h).data);
  } catch {
    // A host without CORS taints the canvas: leave the logo as it is.
    return false;
  }
}

/**
 * Whether RGBA pixels are a logo inked dark throughout: dark on average, and
 * hardly any bright ink. A dark shape carrying bright letters or a ring (#11)
 * already reads on dark art; as a silhouette its detail would turn white on white.
 */
export function isDarkInk(px: ArrayLike<number>) {
  let sum = 0;
  let bright = 0;
  let weight = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 0.5) continue;
    // Relative luminance (sRGB, roughly): how bright the ink is.
    const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    sum += lum * a;
    if (lum > 0.55) bright += a;
    weight += a;
  }
  return weight > 0 && sum / weight < 0.22 && bright / weight < 0.05;
}
