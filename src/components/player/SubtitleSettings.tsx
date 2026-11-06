import { isMac } from "../../lib/platform";
import { OPEN_DYSLEXIC } from "../../lib/settings";
import { Minus, Plus, Reset } from "../icons";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SubtitleStyle } from "../../lib/types";
import { isMpv, type MediaLike, type MpvMedia } from "./mpvMedia";
import { CUE_LINE_HEIGHT, cueFontSize, fontSizeForLine, MPV_SUB_DEFAULTS, mpvSubtitleBox, type MpvSubOptions, type OsdDimensions } from "./subtitleSize";
import { Dropdown } from "../Dropdown";
import { Chip } from "../ui/Chip";

// The platform's own UI face: what the player shows before you pick one.
const DEFAULT_FONT = isMac ? "Helvetica Neue" : "Segoe UI Semibold";

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: 100,
  raise: 0,
  color: "#FFFFFF",
  opacity: 100,
  outline: "thin",
  outlineColor: "#000000",
  background: 0,
  font: DEFAULT_FONT,
};

/** Styles saved before a setting existed are missing it: fill in the defaults. */
const complete = (style: SubtitleStyle): Required<SubtitleStyle> =>
  ({ ...DEFAULT_SUBTITLE_STYLE, ...style, font: style.font || DEFAULT_FONT }) as Required<SubtitleStyle>;
const isDefaultStyle = (style: SubtitleStyle) => JSON.stringify(complete(style)) === JSON.stringify(complete(DEFAULT_SUBTITLE_STYLE));

/**
 * Fonts that ship with the OS, so mpv and the preview both find them, plus
 * OpenDyslexic, which the app bundles: mpv reads it from src-tauri/fonts
 * (--sub-fonts-dir), the preview and the built-in player from base.css's
 * @font-face. Values are family names.
 */
const DYSLEXIC = { value: OPEN_DYSLEXIC, label: "OpenDyslexic" };
const MAC_FONTS = ["Arial", "Avenir Next", "Verdana", "Trebuchet MS", "Futura", "Georgia", "Times New Roman", "Menlo", "Comic Sans MS", "Impact"];
const FONTS = isMac
  ? [{ value: DEFAULT_FONT, label: "Helvetica Neue (Default)" }, DYSLEXIC, ...MAC_FONTS.map((f) => ({ value: f, label: f }))]
  : [
  { value: DEFAULT_FONT, label: "Segoe UI (Default)" },
  DYSLEXIC,
  { value: "Arial", label: "Arial" },
  { value: "Calibri", label: "Calibri" },
  { value: "Verdana", label: "Verdana" },
  { value: "Tahoma", label: "Tahoma" },
  { value: "Trebuchet MS", label: "Trebuchet MS" },
  { value: "Bahnschrift", label: "Bahnschrift" },
  { value: "Georgia", label: "Georgia" },
  { value: "Cambria", label: "Cambria" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Consolas", label: "Consolas" },
  { value: "Comic Sans MS", label: "Comic Sans MS" },
  { value: "Impact", label: "Impact" },
];

/** CSS for the chosen font: the default face is a semibold family of its own; the rest are drawn regular, as mpv does. */
const fontVars = (font: string) => ({
  "--sub-font": `"${font}"`,
  "--sub-weight": font === DEFAULT_FONT ? 600 : 400,
});

const TEXT_COLORS = [
  { value: "#FFFFFF", label: "White" },
  { value: "#FFE45C", label: "Yellow" },
  { value: "#6BE3FF", label: "Cyan" },
  { value: "#7CF29A", label: "Green" },
  { value: "#FF8AD8", label: "Pink" },
];
const OUTLINE_COLORS = [
  { value: "#000000", label: "Black" },
  { value: "#4A4A4A", label: "Grey" },
  { value: "#FFFFFF", label: "White" },
];
const OUTLINES: { value: SubtitleStyle["outline"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "thin", label: "Thin" },
  { value: "medium", label: "Medium" },
  { value: "thick", label: "Thick" },
];
const BACKGROUNDS = [
  { value: 0, label: "None" },
  { value: 40, label: "Light" },
  { value: 75, label: "Dark" },
];
/** mpv `sub-border-size` per outline choice (its default look is "thin"). */
const OUTLINE_PX: Record<SubtitleStyle["outline"], number> = { none: 0, thin: 1.6, medium: 2.6, thick: 3.8 };

const alphaHex = (percent: number) =>
  Math.round((Math.max(0, Math.min(100, percent)) / 100) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
/** mpv colours put alpha first: `#AARRGGBB`. */
const mpvColor = (hex: string, opacity = 100) => `#${alphaHex(opacity)}${hex.replace("#", "")}`;

/** mpv `sub-shadow-offset`: a bare line (no outline, no box) gets none. */
const shadowOffset = (style: Required<SubtitleStyle>) => (style.outline === "none" && !style.background ? 0 : 1);

/** The `sub-ass-override` last given to each player. */
const assOverride = new WeakMap<MpvMedia, string>();
/** A (re)started mpv has its own idea of the override again. */
export const forgetAssOverride = (mpv: MpvMedia) => assOverride.delete(mpv);

/**
 * Push the style (and this video's delay) to mpv. Embedded ASS subtitles keep
 * their own styling unless the user has changed something, so typeset signs
 * still look as the release intended by default.
 *
 * Changing `sub-ass-override` makes mpv rebuild the subtitle renderer and
 * re-read the stream (a network stall of a second or more), so it's only
 * forced for ASS/SSA tracks; plain-text subtitles (SRT, WebVTT…) follow the
 * sub-* options either way.
 */
export function applySubtitleStyleToMpv(mpv: MpvMedia, saved: SubtitleStyle, delay: number) {
  const style = complete(saved);
  const custom = !isDefaultStyle(style);
  const codec = mpv.playing("sub")?.codec;
  const ass = codec === "ass" || codec === "ssa";
  // Only when it changes: each change stalls the stream while mpv re-reads it.
  const override = custom && ass ? "force" : "scale";
  if (assOverride.get(mpv) !== override) {
    assOverride.set(mpv, override);
    void mpv.set("sub-ass-override", override);
  }
  void mpv.set("sub-font", style.font);
  void mpv.set("sub-scale", style.size / 100);
  void mpv.set("sub-pos", 100 - style.raise);
  void mpv.set("sub-color", mpvColor(style.color, style.opacity));
  void mpv.set("sub-border-size", OUTLINE_PX[style.outline]);
  void mpv.set("sub-border-color", mpvColor(style.outlineColor, style.opacity));
  void mpv.set("sub-shadow-offset", shadowOffset(style));
  void mpv.set("sub-back-color", mpvColor("#000000", style.background));
  // Newer mpv draws the box from sub-back-color; older builds only know "opaque-box".
  const box = style.background > 0;
  void mpv
    .command("set", "sub-border-style", box ? "background-box" : "outline-and-shadow")
    .catch(() => box && mpv.set("sub-border-style", "opaque-box"));
  void mpv.set("sub-delay", delay);
}

/** The built-in <video> player: the same choices, as CSS variables read by `::cue`. */
export function subtitleCueVars(saved: SubtitleStyle): CSSProperties {
  const style = complete(saved);
  const text = hexToRgb(style.color, style.opacity);
  const edge = hexToRgb(style.outlineColor, style.opacity);
  const w = OUTLINE_PX[style.outline];
  const shadow =
    w === 0
      ? "0 2px 3px rgb(0 0 0 / 0.6)"
      : [`0 0 ${w * 2}px ${edge}`, `0 0 ${w}px ${edge}`, `0 1px 2px ${edge}`].join(", ");
  return {
    "--sub-scale": style.size / 100,
    "--sub-color": text,
    "--sub-shadow": shadow,
    "--sub-bg": `rgb(0 0 0 / ${style.background / 100})`,
    ...fontVars(style.font),
  } as CSSProperties;
}

function hexToRgb(hex: string, opacity: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${opacity / 100})`;
}

/**
 * Subtitle appearance, shown in place of the subtitle list. Every change
 * applies to the playing video straight away, so the subtitles on screen are
 * the preview.
 */
export function SubtitleSettings({
  style,
  onChange,
  delay,
  onDelay,
  canPosition,
}: {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  /** This video's timing offset; leave out where there's no video (Settings page). */
  delay?: number;
  onDelay?: (seconds: number) => void;
  /** Delay and position need the mpv engine. */
  canPosition: boolean;
}) {
  const isDefault = isDefaultStyle(style) && !delay;
  return (
    <div className="sub-settings">
      {canPosition && onDelay && delay !== undefined && (
        <Setting
          label="Delay"
          caption={
            delay === 0
              ? "Fix subtitles that don't match the speech. Now in sync"
              : delay > 0
                ? "Subtitles show later than before"
                : "Subtitles show earlier than before"
          }
        >
          <Stepper
            value={delay}
            step={0.1}
            min={-30}
            max={30}
            format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`}
            onChange={onDelay}
            label="Delay"
          />
        </Setting>
      )}
      <Setting label="Font">
        <Dropdown label="Subtitle font" value={style.font || DEFAULT_FONT} options={FONTS} onChange={(font) => onChange({ font })} />
      </Setting>
      <Setting label="Size">
        <Stepper value={style.size} step={10} min={50} max={200} format={(v) => `${v}%`} onChange={(size) => onChange({ size })} label="Size" />
      </Setting>
      {canPosition && (
        <Setting label="Position" caption="Lift subtitles higher up the screen">
          <Stepper value={style.raise} step={2} min={0} max={40} format={(v) => (v === 0 ? "Default" : `+${v}%`)} onChange={(raise) => onChange({ raise })} label="Position" />
        </Setting>
      )}
      <Setting label="Color">
        <Swatches value={style.color} options={TEXT_COLORS} onChange={(color) => onChange({ color })} />
      </Setting>
      <Setting label="Opacity">
        <Stepper value={style.opacity} step={10} min={20} max={100} format={(v) => `${v}%`} onChange={(opacity) => onChange({ opacity })} label="Opacity" />
      </Setting>
      <Setting label="Outline">
        <Chips value={style.outline} options={OUTLINES} onChange={(outline) => onChange({ outline })} />
      </Setting>
      {style.outline !== "none" && (
        <Setting label="Outline color">
          <Swatches value={style.outlineColor} options={OUTLINE_COLORS} onChange={(outlineColor) => onChange({ outlineColor })} />
        </Setting>
      )}
      <Setting label="Background">
        <Chips value={style.background} options={BACKGROUNDS} onChange={(background) => onChange({ background })} />
      </Setting>
      <button
        className="sub-reset"
        disabled={isDefault}
        onClick={() => {
          onChange(DEFAULT_SUBTITLE_STYLE);
          onDelay?.(0);
        }}
      >
        <Reset size={15} strokeWidth={2.25} /> Reset to default
      </button>
    </div>
  );
}

function Setting({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  return (
    <div className="sub-setting">
      <span className="sub-setting-text">
        <span className="sub-setting-label">{label}</span>
        {caption && <span className="sub-setting-caption">{caption}</span>}
      </span>
      {children}
    </div>
  );
}

function Stepper({
  value,
  step,
  min,
  max,
  format,
  onChange,
  label,
}: {
  value: number;
  step: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  label: string;
}) {
  // Round so repeated 0.1 steps don't drift (0.30000000000000004).
  const set = (v: number) => onChange(Math.round(Math.max(min, Math.min(max, v)) * 100) / 100);
  return (
    <div className="sub-stepper" role="group" aria-label={label}>
      <button aria-label={`Less ${label.toLowerCase()}`} disabled={value <= min} onClick={() => set(value - step)}>
        <Minus size={16} strokeWidth={2.5} />
      </button>
      <span className="sub-stepper-value tabular" aria-live="polite">
        {format(value)}
      </span>
      <button aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => set(value + step)}>
        <Plus size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Swatches({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const isCustom = !options.some((o) => o.value.toUpperCase() === value.toUpperCase());
  // The native picker reports every drag step; save once it settles.
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pick = (hex: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(hex.toUpperCase()), 120);
  };
  return (
    <div className="sub-swatches" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value.toUpperCase() === value.toUpperCase()}
          aria-label={o.label}
          title={o.label}
          className="sub-swatch"
          style={{ "--swatch": o.value } as CSSProperties}
          onClick={() => onChange(o.value)}
        />
      ))}
      {/* Any colour: a rainbow ring until it's chosen, then the colour itself. */}
      <label
        className="sub-swatch sub-swatch-custom"
        data-custom={isCustom}
        aria-checked={isCustom}
        title="Custom color"
        style={isCustom ? ({ "--swatch": value } as CSSProperties) : undefined}
      >
        <input
          type="color"
          aria-label="Custom color"
          value={isCustom ? value.toLowerCase() : "#ff7a59"}
          onChange={(e) => pick(e.target.value)}
        />
      </label>
    </div>
  );
}

function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="source-chips" role="radiogroup">
      {options.map((o) => (
        <Chip key={o.value} variant="choice" role="radio" aria-checked={o.value === value} pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

const SAMPLE = "This is how your subtitles will look.";

/** The mpv options the preview reads once per player; the rest it sets itself from the style. */
const MPV_READ: [keyof MpvSubOptions, string][] = [
  ["fontSize", "sub-font-size"],
  ["marginX", "sub-margin-x"],
  ["marginY", "sub-margin-y"],
  ["scaleByWindow", "sub-scale-by-window"],
  ["scaleWithWindow", "sub-scale-with-window"],
  ["useMargins", "sub-use-margins"],
];

const isOsd = (v: unknown): v is OsdDimensions =>
  !!v && typeof v === "object" && ["w", "h", "mt", "mb", "ml", "mr"].every((k) => typeof (v as Record<string, unknown>)[k] === "number") && (v as OsdDimensions).h > 0;

/** A font's ascent plus descent in em, as the browser reads its metrics: the span libass sizes a font by. */
const extents = new Map<string, number>();
function measureExtent(spec: string): number {
  const known = extents.get(spec);
  if (known) return known;
  const ctx = document.createElement("canvas").getContext?.("2d");
  if (!ctx) return 1;
  ctx.font = spec;
  const m = ctx.measureText("Hg");
  const extent = (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 100;
  if (!(extent > 0)) return 1;
  if (document.fonts?.check?.(spec) !== false) extents.set(spec, extent);
  return extent;
}

function useFontExtent(font: string, weight: number) {
  const spec = `${weight} 100px "${font}", "Segoe UI", system-ui, sans-serif`;
  const [extent, setExtent] = useState(() => measureExtent(spec));
  useEffect(() => {
    let alive = true;
    setExtent(measureExtent(spec));
    // A bundled face (OpenDyslexic) may still be loading: measure again once it's in.
    void document.fonts
      ?.load?.(spec)
      .then(() => alive && setExtent(measureExtent(spec)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [spec]);
  return extent;
}

/** The overlay's size in CSS pixels: the player's window. */
function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/**
 * A live sample drawn above the frosted overlay, so changes can be judged
 * while the real subtitles are hidden behind the blur. Shows the line on
 * screen when there is one.
 *
 * Sized and placed as the player draws a line (subtitleSize.ts): with mpv,
 * from mpv's own options and `osd-dimensions`, read again every half second
 * so a resized window, a crop, Fill or the next video are followed; with the
 * built-in player, from `::cue`'s rule.
 */
export function SubtitlePreview({ style: saved, media }: { style: SubtitleStyle; media: MediaLike | null }) {
  const style = complete(saved);
  const mpv = isMpv(media) ? media : null;
  const [line, setLine] = useState("");
  const [osd, setOsd] = useState<OsdDimensions | null>(null);
  const [read, setRead] = useState<Partial<MpvSubOptions>>({});
  const viewport = useViewport();
  const weight = style.font === DEFAULT_FONT ? 600 : 400;
  const extent = useFontExtent(style.font, weight);

  useEffect(() => {
    setRead({});
    if (!mpv) return;
    let alive = true;
    for (const [key, name] of MPV_READ) {
      mpv
        .command("get_property", name)
        .then((v) => alive && typeof v === typeof MPV_SUB_DEFAULTS[key] && setRead((r) => ({ ...r, [key]: v })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [mpv]);

  useEffect(() => {
    setOsd(null);
    if (!mpv) return;
    let alive = true;
    const poll = () => {
      mpv
        .command("get_property", "sub-text")
        .then((t) => alive && setLine(typeof t === "string" ? t.trim() : ""))
        .catch(() => alive && setLine(""));
      mpv
        .command("get_property", "osd-dimensions")
        .then((d) => alive && isOsd(d) && setOsd((old) => (old && JSON.stringify(old) === JSON.stringify(d) ? old : d)))
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 500);
    window.addEventListener("resize", poll);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("resize", poll);
    };
  }, [mpv]);

  let box: { size: number; line: number; stroke: number; shadow: string; bottom: number; side: number; pad: number };
  if (mpv) {
    // Until mpv answers, take its window to be ours with the picture filling it.
    const win = osd ?? { w: viewport.w, h: viewport.h, mt: 0, mb: 0, ml: 0, mr: 0 };
    const b = mpvSubtitleBox(
      win,
      { ...MPV_SUB_DEFAULTS, ...read, scale: style.size / 100, borderSize: OUTLINE_PX[style.outline], shadowOffset: shadowOffset(style), pos: 100 - style.raise },
      viewport.h / win.h,
    );
    box = {
      size: fontSizeForLine(b.line, extent),
      line: b.line,
      // A stroke is centred on the glyph's edge and the fill covers its inner half.
      stroke: b.border * 2,
      shadow: b.shadow ? `${b.shadow}px ${b.shadow}px 0 var(--scrim-2)` : "none",
      bottom: b.bottom,
      side: b.side,
      pad: b.border,
    };
  } else {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const size = cueFontSize(viewport.w, rem, style.size / 100);
    box = { size, line: size * CUE_LINE_HEIGHT, stroke: 0, shadow: "var(--sub-shadow)", bottom: 0, side: 0, pad: 0 };
  }

  const vars = {
    ...(mpv ? {} : subtitleCueVars(saved)),
    "--sub-color": hexToRgb(style.color, style.opacity),
    "--sub-edge": hexToRgb(style.outlineColor, style.opacity),
    "--sub-bg": `rgb(0 0 0 / ${style.background / 100})`,
    "--sub-size": `${box.size}px`,
    "--sub-line": `${box.line}px`,
    "--sub-stroke": `${box.stroke}px`,
    "--sub-text-shadow": box.shadow,
    "--sub-bottom": `${box.bottom}px`,
    "--sub-side": `${box.side}px`,
    "--sub-pad": `${box.pad}px`,
    ...fontVars(style.font),
  } as CSSProperties;
  return (
    <div className="sub-preview" style={vars} data-engine={mpv ? "mpv" : "built-in"} aria-hidden>
      <p className="sub-preview-line">
        <span className="sub-preview-text">{line || SAMPLE}</span>
      </p>
    </div>
  );
}
