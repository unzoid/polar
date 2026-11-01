import { Minus, Plus, Reset } from "../icons";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SubtitleStyle } from "../../lib/types";
import { isMpv, type MediaLike, type MpvMedia } from "./mpvMedia";
import { Dropdown } from "../Dropdown";

const DEFAULT_FONT = "Segoe UI Semibold";

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

/** Fonts that ship with Windows, so mpv and the preview both find them. Values are family names. */
const FONTS = [
  { value: DEFAULT_FONT, label: "Segoe UI (Default)" },
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
  const codec = mpv.tracks.find((t) => t.type === "sub" && t.id === mpv.sid)?.codec;
  const ass = codec === "ass" || codec === "ssa";
  void mpv.set("sub-ass-override", custom && ass ? "force" : "scale");
  void mpv.set("sub-font", style.font);
  void mpv.set("sub-scale", style.size / 100);
  void mpv.set("sub-pos", 100 - style.raise);
  void mpv.set("sub-color", mpvColor(style.color, style.opacity));
  void mpv.set("sub-border-size", OUTLINE_PX[style.outline]);
  void mpv.set("sub-border-color", mpvColor(style.outlineColor, style.opacity));
  void mpv.set("sub-shadow-offset", style.outline === "none" && !style.background ? 0 : 1);
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
        <button key={o.value} role="radio" aria-checked={o.value === value} aria-pressed={o.value === value} className="source-chip" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SAMPLE = "This is how your subtitles will look.";

/**
 * A live sample drawn above the frosted overlay, set like mpv draws subtitles
 * (same font, size, outline, position), so changes can be judged while the
 * real subtitles are hidden behind the blur. Shows the line on screen when
 * there is one.
 */
export function SubtitlePreview({ style: saved, media }: { style: SubtitleStyle; media: MediaLike | null }) {
  const style = complete(saved);
  const [line, setLine] = useState("");
  useEffect(() => {
    if (!isMpv(media)) return;
    let alive = true;
    const read = () =>
      media
        .command("get_property", "sub-text")
        .then((t) => alive && setLine(typeof t === "string" ? t.trim() : ""))
        .catch(() => alive && setLine(""));
    void read();
    const id = window.setInterval(read, 500);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [media]);

  const vars = {
    "--sub-scale": style.size / 100,
    "--sub-raise": style.raise,
    "--sub-color": hexToRgb(style.color, style.opacity),
    "--sub-edge": hexToRgb(style.outlineColor, style.opacity),
    "--sub-edge-w": OUTLINE_PX[style.outline],
    "--sub-bg": `rgb(0 0 0 / ${style.background / 100})`,
    ...fontVars(style.font),
  } as CSSProperties;
  return (
    <div className="sub-preview" style={vars} aria-hidden>
      <p className="sub-preview-line">
        <span className="sub-preview-text">{line || SAMPLE}</span>
      </p>
    </div>
  );
}
