import { useEffect, useState } from "react";
import { Img, type ImgProps } from "./Img";
import { backdropLuminance, chooseLogo, DARK_PAGE, measureInk, type Ink, type LogoLook, type LogoSpot } from "../lib/ui";

type TitleLogoProps = ImgProps & {
  src?: string;
  /** All of the title's logos, the metadata language first (`MetaPreview.logos`); used only when it holds `src`. */
  logos?: string[];
  /** The picture behind the logo, and where the logo sits on it (`LOGO_SPOTS`). Without them the page is taken as dark. */
  backdrop?: string;
  spot?: LogoSpot;
};

/**
 * A title treatment (logo) that stays readable on the picture behind it (#215). The logo's ink and the backdrop
 * where it sits (after the page's gradient) are measured off separate CORS requests, so the visible <img> never
 * waits for them; then the first of the title's logos that reads there is shown, or, when none does, the first
 * drawn as a white silhouette (one dark ink) or with a halo (`lib/ui/logoContrast.ts`). When neither the logos
 * nor the backdrop can be measured (the hosts refuse), `onFail` is called so the caller shows the name.
 */
export function TitleLogo({ logos, backdrop, spot, ...props }: TitleLogoProps) {
  const { src, onFail } = props;
  const candidates = src && logos?.includes(src) ? logos.slice(0, MAX_CANDIDATES) : src ? [src] : [];
  const key = candidates.join(" ");
  const behindKey = backdrop && spot ? `${backdrop} ${spot.x0} ${spot.y0} ${spot.x1} ${spot.y1} ${spot.scrim}` : undefined;
  const id = `${key}|${behindKey}`;
  // The choice lives in the module's cache, so a new title never shows the last one's for a frame.
  const choice = choices.get(id);
  const [, setMeasured] = useState(0);
  useEffect(() => {
    if (!candidates.length || choices.has(id)) return;
    let live = true;
    const behind = backdrop && spot ? measureBackdrop(backdrop, spot) : Promise.resolve(DARK_PAGE);
    Promise.all([behind, Promise.all(candidates.map(measureLogo))]).then(([lum, inks]) => {
      choices.set(id, chooseLogo(candidates, inks, lum));
      if (live) setMeasured((n) => n + 1);
    });
    return () => {
      live = false;
    };
    // `candidates` and `spot` are new each render; `id` says when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (choice === "unsure") onFail?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);
  if (choice === "unsure") return null;
  const look = choice?.look ?? "as-is";
  return <Img {...props} src={choice?.src ?? src} data-logo-look={look === "as-is" ? undefined : look} />;
}

/** The logo to show and how, or "unsure" when nothing could be measured. */
type Choice = { src: string; look: LogoLook } | "unsure";

/** More logos than this aren't measured (each is a request). */
const MAX_CANDIDATES = 6;

const choices = new Map<string, Choice>();
const inks = new Map<string, Promise<Ink | null>>();
const behinds = new Map<string, Promise<number | null>>();

/** Loads a picture for measuring; null when the host refuses it (no CORS) or it doesn't load. */
function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = toneUrl(src);
  });
}

/** Draws `img` (or the part of it in `spot`) `w` px wide and reads its pixels; null when the canvas is tainted. */
function pixelsOf(img: HTMLImageElement, w: number, spot?: LogoSpot) {
  try {
    const sx = spot ? spot.x0 * img.naturalWidth : 0;
    const sy = spot ? spot.y0 * img.naturalHeight : 0;
    const sw = spot ? (spot.x1 - spot.x0) * img.naturalWidth : img.naturalWidth;
    const sh = spot ? (spot.y1 - spot.y0) * img.naturalHeight : img.naturalHeight;
    const h = Math.max(1, Math.round((sh / sw) * w)) || 32;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
}

/** A logo's ink, measured once per picture; null when it can't be. A host that refuses answers the same every time. */
function measureLogo(src: string) {
  let ink = inks.get(src);
  // Wide enough that thin bright detail (a ring, small letters, an outline) survives the downscale (#11).
  if (!ink) {
    ink = load(src).then((img) => {
      const px = img && pixelsOf(img, 128);
      return px ? measureInk(px) : null;
    });
    inks.set(src, ink);
  }
  return ink;
}

/** The luminance behind the logo, measured once per backdrop and spot; null when it can't be. */
function measureBackdrop(src: string, spot: LogoSpot) {
  const key = `${src} ${spot.x0} ${spot.y0} ${spot.x1} ${spot.y1} ${spot.scrim}`;
  let lum = behinds.get(key);
  if (!lum) {
    lum = load(src).then((img) => {
      const px = img && pixelsOf(img, 48, spot);
      return px ? backdropLuminance(px, spot.scrim) : null;
    });
    behinds.set(key, lum);
  }
  return lum;
}

/**
 * Where to fetch a picture for measuring (test report 1, item 24). metahub's `images.` host redirects to
 * `live.` without allowing CORS, so it goes to `live.` directly. And the URL differs from the visible
 * picture's: TMDB allows CORS only to requests that carry an Origin and doesn't say it varies by it, so a
 * cached answer to the plain <img> would fail this request. TMDB's are fetched small (185 px wide is plenty).
 */
export function toneUrl(src: string): string {
  try {
    const u = new URL(src);
    if (u.hostname === "images.metahub.space") u.hostname = "live.metahub.space";
    if (u.hostname === "image.tmdb.org") u.pathname = u.pathname.replace(/^\/t\/p\/[^/]+\//, "/t/p/w185/");
    u.searchParams.set("tone", "1");
    return u.toString();
  } catch {
    return src;
  }
}
