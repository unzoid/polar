/**
 * How big, and where, the players draw a subtitle line, so the preview in the
 * subtitle settings can be set the same way (#228).
 *
 * mpv: plain-text subtitles (SRT, WebVTT…), and ASS ones whose style the user
 * forces, are laid out by libass. This follows mpv's sub/sd_ass.c
 * (configure_ass), sub/ass_mp.c (mp_ass_set_style) and libass's ass_render.c
 * (init_font_scale, y2scr_sub, x2scr_left, the line position) step by step.
 * The `sub-*` sizes are measured on a 720-line canvas; mpv converts text
 * subtitles to an ASS track 288 lines high and libass scales that to the
 * window or the video.
 *
 * The built-in <video> player: the browser draws cues with `::cue`'s rule in
 * player.css, which this repeats.
 */

/** mpv's `osd-dimensions`, in mpv's pixels: the window and the video's margins inside it. */
export interface OsdDimensions {
  w: number;
  h: number;
  mt: number;
  mb: number;
  ml: number;
  mr: number;
}

/** The mpv options that size and place a subtitle line. */
export interface MpvSubOptions {
  /** `sub-font-size`, on the 720-line canvas. */
  fontSize: number;
  /** `sub-scale`. */
  scale: number;
  /** `sub-border-size`. */
  borderSize: number;
  /** `sub-shadow-offset`. */
  shadowOffset: number;
  /** `sub-margin-x`. */
  marginX: number;
  /** `sub-margin-y`. */
  marginY: number;
  /** `sub-pos`: 100 is the bottom of the screen, 0 the top. */
  pos: number;
  /** `sub-scale-by-window`: no keeps the size in pixels whatever the window. */
  scaleByWindow: boolean;
  /** `sub-scale-with-window`: sizes follow the window's height rather than the video's. */
  scaleWithWindow: boolean;
  /** `sub-use-margins`: lines may sit in the black bars below the picture. */
  useMargins: boolean;
}

/** What the app starts mpv with (src-tauri/src/player/mod.rs) and mpv's own defaults for the rest. */
export const MPV_SUB_DEFAULTS: MpvSubOptions = {
  fontSize: 42,
  scale: 1,
  borderSize: 1.6,
  shadowOffset: 1,
  marginX: 25,
  marginY: 22,
  pos: 100,
  scaleByWindow: true,
  scaleWithWindow: true,
  useMargins: true,
};

/** A subtitle line as drawn, in CSS pixels. */
export interface SubtitleBox {
  /** One line's height: the font's ascent plus descent, which is what libass sizes a font by. */
  line: number;
  /** Outline width outside the glyphs. */
  border: number;
  /** Shadow offset, right and down. */
  shadow: number;
  /** From the bottom of the window to the bottom of the last line. */
  bottom: number;
  /** Space kept free at the left and right of the window. */
  side: number;
}

/** mpv's canvas for `sub-*` sizes, and the ASS track it converts text subtitles to (MP_ASS_FONT_PLAYRESY/X). */
const MPV_RES_Y = 720;
const PLAY_RES_Y = 288;
const PLAY_RES_X = 384;

/** C's lrint: halves go to the even neighbour. */
const lrint = (x: number) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/**
 * Where mpv draws a subtitle line in a window of `osd` (mpv's pixels), given
 * as CSS pixels with `cssPerPx` CSS pixels to one of mpv's.
 */
export function mpvSubtitleBox(osd: OsdDimensions, o: MpvSubOptions, cssPerPx: number): SubtitleBox {
  const { w, h } = osd;
  const vidW = w - osd.ml - osd.mr;
  const vidH = h - osd.mt - osd.mb;
  // libass's fit size: the video stretched to fill the window as far as its shape allows.
  const fitW = vidW * h >= vidH * w ? w : (vidW * h) / Math.max(vidH, 1);
  const fitH = vidW * h <= vidH * w ? h : (vidH * w) / Math.max(vidW, 1);

  // configure_ass: the font scale handed to libass.
  let fontScale = o.scale;
  if (o.scaleWithWindow) {
    const libassHeight = !o.useMargins || vidW < 1 ? vidH : Math.min(h, (w / vidW) * vidH);
    fontScale *= h / Math.max(libassHeight, 1);
  }
  if (!o.scaleByWindow && h) fontScale /= h / MPV_RES_Y;

  // init_font_scale: script units to pixels, for glyphs, outlines and shadows alike.
  const screenH = o.useMargins ? fitH : vidH;
  const perUnit = (screenH / PLAY_RES_Y) * fontScale;
  const toTrack = PLAY_RES_Y / MPV_RES_Y; // mp_ass_set_style's scale

  // mp_ass_set_style stores the margins as whole script units (truncated);
  // configure_ass then rescales the converted track's: MarginV by the font
  // scale, MarginL/R by PlayResX following the video's shape.
  const marginV = lrint(Math.trunc(o.marginY * toTrack) * fontScale);
  const playResX = (PLAY_RES_Y * vidW) / Math.max(vidH, 1);
  const marginL = lrint(Math.trunc(o.marginX * toTrack) * (playResX / PLAY_RES_X));

  // y2scr_sub / y2scr_top, then sub-pos lifts the line towards the top.
  const scrBottom = o.useMargins ? ((PLAY_RES_Y - marginV) * fitH) / PLAY_RES_Y + (h - fitH) : ((PLAY_RES_Y - marginV) * vidH) / PLAY_RES_Y + osd.mt;
  const scrTop = o.useMargins ? 0 : osd.mt;
  const linePos = 100 - o.pos;
  const lineBottom = scrBottom + ((scrTop - scrBottom) * linePos) / 100;
  const side = o.useMargins ? (marginL * fitW) / Math.max(playResX, 1) : osd.ml + (marginL * vidW) / Math.max(playResX, 1);

  return {
    line: o.fontSize * toTrack * perUnit * cssPerPx,
    border: o.borderSize * toTrack * perUnit * cssPerPx,
    shadow: o.shadowOffset * toTrack * perUnit * cssPerPx,
    bottom: (h - lineBottom) * cssPerPx,
    side: side * cssPerPx,
  };
}

/** The `font-size` that gives a line `line` pixels high, for a font whose ascent plus descent is `extent` em. */
export const fontSizeForLine = (line: number, extent: number) => line / (extent > 0 ? extent : 1);

/**
 * The built-in player's cue font size: `::cue` in player.css,
 * `clamp(1.25rem, 2.4vw, 2.25rem) * --sub-scale`.
 */
export const cueFontSize = (viewportWidth: number, remPx: number, scale: number) =>
  Math.min(Math.max(1.25 * remPx, 0.024 * viewportWidth), 2.25 * remPx) * scale;

/** `::cue`'s line height, as a multiple of its font size. */
export const CUE_LINE_HEIGHT = 1.25;
