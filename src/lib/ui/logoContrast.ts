// Whether a title logo reads on the picture behind it (#215), decided on contrast: the logo's ink against the
// backdrop where the logo sits, after the page's own gradient. Pure functions on RGBA pixels; TitleLogo measures.

/** How a logo is drawn: as it is, as a white silhouette, or with a soft halo (light behind a dark logo, dark behind a light one). */
export type LogoLook = "as-is" | "silhouette" | "halo-light" | "halo-dark";

/** A measured logo: each opaque pixel's relative luminance (0-1) with its weight, and whether it's one ink throughout. */
export interface Ink {
  lum: number[];
  weight: number[];
  /** Most of the ink is one tone with no strong colour: a silhouette keeps its shape and loses nothing. */
  single: boolean;
  /** The ink's median luminance. */
  median: number;
}

/** WCAG's level for graphics: a logo whose ink mostly reaches it against the backdrop reads as it is. */
export const LOGO_CONTRAST = 3;
/** The share of the ink that must reach `LOGO_CONTRAST` (a white logo with a heavy dark outline still reads). */
const LEGIBLE_SHARE = 0.4;
/** One ink: this share of it lies within `BAND` (in sRGB lightness) of the median, and at most `COLOURFUL` of it is saturated. */
const SINGLE_SHARE = 0.85;
const BAND = 0.15;
const COLOURFUL = 0.1;

/** Linear-light value of an sRGB channel (0-255). */
function linear(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance(r: number, g: number, b: number) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two relative luminances (1-21). */
export function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The ink of a logo's RGBA pixels (its mostly transparent surround left out); null when there's none. */
export function measureInk(px: ArrayLike<number>): Ink | null {
  const lum: number[] = [];
  const weight: number[] = [];
  const light: number[] = [];
  let total = 0;
  let colourful = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 0.5) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    lum.push(luminance(r, g, b));
    light.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    weight.push(a);
    total += a;
    if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 > 0.25) colourful += a;
  }
  if (total === 0) return null;
  const median = weightedMedian(lum, weight, total);
  const mid = weightedMedian(light, weight, total);
  let near = 0;
  for (let i = 0; i < light.length; i++) if (Math.abs(light[i] - mid) <= BAND) near += weight[i];
  return { lum, weight, median, single: near / total >= SINGLE_SHARE && colourful / total <= COLOURFUL };
}

function weightedMedian(values: number[], weight: number[], total: number) {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  let seen = 0;
  for (const i of order) {
    seen += weight[i];
    if (seen >= total / 2) return values[i];
  }
  return values[order[order.length - 1]];
}

/**
 * Where a heading's logo sits over its backdrop (fractions of the picture, as `object-fit: cover` shows it on a wide
 * window) and how much of the page's gradient covers it there (`rgb(10 10 10 / scrim)`). They follow the scrims in
 * cards.css (.hero-scrim), detail.css (.detail-bg-scrim) and tv.css (the TV art fades out towards the logo).
 */
export const LOGO_SPOTS = {
  hero: { x0: 0.03, y0: 0.45, x1: 0.4, y1: 0.8, scrim: 0.5 },
  detail: { x0: 0.03, y0: 0.4, x1: 0.4, y1: 0.75, scrim: 0.7 },
  "tv-stage": { x0: 0.03, y0: 0.5, x1: 0.35, y1: 0.85, scrim: 0.8 },
  "tv-detail": { x0: 0, y0: 0.25, x1: 0.35, y1: 0.6, scrim: 0.9 },
  "tv-panel": { x0: 0, y0: 0.25, x1: 0.35, y1: 0.6, scrim: 0.9 },
} as const;

export type LogoSpot = { x0: number; y0: number; x1: number; y1: number; scrim: number };

/** The scrim's colour (the page background, #0a0a0a). */
const SCRIM = 10;

/** The luminance behind a logo when the backdrop can't be measured, or there's none: the app's dark page. */
export const DARK_PAGE = luminance(SCRIM, SCRIM, SCRIM);

/**
 * The mean luminance of a backdrop's pixels (already cut to the logo's spot) under the page's gradient of
 * `scrim` (0-1), blended in sRGB as CSS does.
 */
export function backdropLuminance(px: ArrayLike<number>, scrim: number) {
  let sum = 0;
  let n = 0;
  const over = (c: number) => c * (1 - scrim) + SCRIM * scrim;
  for (let i = 0; i < px.length; i += 4) {
    sum += luminance(over(px[i]), over(px[i + 1]), over(px[i + 2]));
    n++;
  }
  return n ? sum / n : DARK_PAGE;
}

/** The share of the ink that reaches `LOGO_CONTRAST` against a backdrop of luminance `behind`. */
export function legibleShare(ink: Ink, behind: number) {
  let ok = 0;
  let total = 0;
  for (let i = 0; i < ink.lum.length; i++) {
    total += ink.weight[i];
    if (contrast(ink.lum[i], behind) >= LOGO_CONTRAST) ok += ink.weight[i];
  }
  return total ? ok / total : 0;
}

export const readsOn = (ink: Ink, behind: number) => legibleShare(ink, behind) >= LEGIBLE_SHARE;

/**
 * How to draw a logo on a backdrop of luminance `behind`: as it is when it reads; a single ink as the white
 * silhouette, when white reads there; else a halo of the opposite tone, which keeps a multicolour or detailed
 * logo's artwork.
 */
export function logoLook(ink: Ink, behind: number): LogoLook {
  if (readsOn(ink, behind)) return "as-is";
  if (ink.single && contrast(1, behind) >= LOGO_CONTRAST) return "silhouette";
  // Dark behind a light logo, light behind a dark one: whichever stands further from the ink's median.
  return contrast(ink.median, 0) > contrast(ink.median, 1) ? "halo-dark" : "halo-light";
}

/**
 * Which of a title's logos to show, in their order (the metadata language first): the first that reads on the
 * backdrop as it is; when none does, the first, drawn by `logoLook`. Logos that couldn't be measured (null) are
 * passed over unless none could be.
 */
export function pickLogo(inks: (Ink | null)[], behind: number): { index: number; look: LogoLook } | null {
  const readable = inks.findIndex((ink) => ink && readsOn(ink, behind));
  if (readable >= 0) return { index: readable, look: "as-is" };
  const first = inks.findIndex((ink) => ink);
  if (first < 0) return null;
  return { index: first, look: logoLook(inks[first]!, behind) };
}

/**
 * What a heading shows once measuring has answered: the logo to show and how, or "unsure" (the name in text)
 * when neither the logos nor the backdrop could be measured. `behind` is null when the backdrop couldn't be;
 * with no backdrop to measure the caller passes `DARK_PAGE`, and an unmeasured logo is then left as it is.
 */
export function chooseLogo(candidates: string[], inks: (Ink | null)[], behind: number | null): { src: string; look: LogoLook } | "unsure" {
  const picked = pickLogo(inks, behind ?? DARK_PAGE);
  if (picked) return { src: candidates[picked.index], look: picked.look };
  return behind === null ? "unsure" : { src: candidates[0], look: "as-is" };
}
