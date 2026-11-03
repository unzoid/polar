import { Check, Close } from "../icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Still } from "../StillPlaceholder";
import { VideoBackdrop } from "./VideoBackdrop";
import type { MediaLike } from "./mpvMedia";
import { prefersReducedMotion } from "../../lib/reducedMotion";

export interface OptionItem {
  id: string;
  label: string;
  /** Second line: addon · size, airdate · time left, … */
  detail?: string;
  /** 16:9 still shown before the text (episodes). */
  thumbnail?: string;
  /** 0–1 watch progress drawn under the thumbnail. */
  progress?: number;
  /** Small trailing tag: "Instant", "Watched", "CAM". */
  /** Trailing tag. With `icon`, the icon is shown and `text` becomes its label. */
  badge?: { text: string; tone?: "good" | "bad"; icon?: ReactNode };
  icon?: ReactNode;
  disabled?: boolean;
}

export interface OptionColumn {
  title: string;
  options: OptionItem[];
  value?: string;
  onSelect: (id: string) => void;
  /** Shown when the column has nothing to pick. */
  empty?: string;
  /** Wide columns hold rich rows (episodes, sources); narrow ones plain labels. */
  size?: "narrow" | "medium" | "wide";
  /** Controls shown beside the title (filters, sort). */
  header?: ReactNode;
  /** Shown instead of the rows (e.g. subtitle settings in place of the language list). */
  content?: ReactNode;
}

/**
 * Full-window picker over the playing video: columns of rows, the selected
 * row a light pill with a check. Used for speed, audio & subtitles, episodes
 * and sources, so every "choose something" moment in the player looks alike.
 *
 * Long columns scroll on their own within the window (soft fade at the cut
 * edges), and open scrolled to the current selection.
 *
 * Motion is CSS (transitions + @starting-style), so it stays smooth while the
 * video decodes on the main thread: the layer fades in while the frosted
 * picture pulls out of focus (blur + slight zoom), columns rise 8px. Opens
 * over ~500ms, closes along the same path in 160ms.
 */
export function OptionsOverlay({
  open,
  onClose,
  columns,
  media,
  foreground,
}: {
  open: boolean;
  /** The playing video, frosted behind the options. */
  media: MediaLike | null;
  onClose: () => void;
  columns: OptionColumn[];
  /** Drawn above the blur and the columns (e.g. a subtitle preview). */
  foreground?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Stay mounted through the exit transition.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = window.setTimeout(() => setMounted(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

  // The parent re-renders several times a second during playback and passes a
  // fresh onClose each time; read it through a ref so nothing below re-runs
  // (re-running would snap the lists back to the selection mid-scroll).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Once per opening: show the current choice in every column, focus it for the keyboard.
  useEffect(() => {
    if (!open || !mounted) return;
    // Scroll each list itself — not scrollIntoView, which also scrolls every
    // ancestor (even overflow:hidden ones) and would shift the whole layer.
    root.current?.querySelectorAll<HTMLElement>('[aria-checked="true"]').forEach((el) => {
      const list = el.closest<HTMLElement>(".options-list");
      if (list) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
    });
    root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    const onKey = (e: KeyboardEvent) => {
      // An open dropdown inside the overlay handles its own keys.
      if (document.querySelector(".select-popup, .srcf-popover")) return;
      // A slider (the source list's size range) takes the arrows for itself.
      if ((e.target as HTMLElement | null)?.closest?.('[role="slider"], input[type="range"]') && e.key !== "Escape") return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.stopPropagation();
        e.preventDefault();
        moveFocus(root.current, e.key);
      }
      // Space/Enter act on the focused row natively; keep them from the player.
      if (e.key === " " || e.key === "Enter") e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <div
      ref={root}
      className="options-overlay"
      data-open={open}
      role="dialog"
      aria-modal
      // Anywhere on the blur closes; only the columns themselves (and popups opened from them) don't.
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if ((e.target as Element).closest?.(".options-column, .select-popup, .srcf-popover, .options-close")) return;
        onClose();
      }}
    >
      <VideoBackdrop media={media} />
      <div className="options-shade" aria-hidden />
      <button className="player-icon pressable options-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
        <Close size={26} />
      </button>
      <div className="options-columns" data-count={columns.length}>
        {columns.map((col, c) => (
          <section key={col.title} className="options-column" data-column={c} data-size={col.size ?? "narrow"}>
            <div className="options-head">
              <h2 className="options-title">{col.title}</h2>
              {col.header}
            </div>
            {col.content ? (
              <div className="options-list options-custom">{col.content}</div>
            ) : (
              <>
                {col.options.length === 0 && col.empty && <p className="options-empty">{col.empty}</p>}
                <div role="radiogroup" aria-label={col.title} className="options-list">
                  {col.options.map((o) => (
                    <Row key={o.id} item={o} selected={o.id === col.value} onSelect={col.onSelect} />
                  ))}
                </div>
              </>
            )}
          </section>
        ))}
      </div>
      {foreground}
    </div>
  );
}

function Row({ item: o, selected, onSelect }: { item: OptionItem; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      disabled={o.disabled}
      className="options-item"
      data-rich={!!(o.detail || o.thumbnail)}
      onClick={() => onSelect(o.id)}
    >
      <span className="options-check" aria-hidden>
        {selected && <Check size={20} strokeWidth={2.5} />}
      </span>
      {o.thumbnail !== undefined && (
        <span className="options-thumb" aria-hidden>
          <Still src={o.thumbnail} />
          {o.progress != null && o.progress > 0 && (
            <span className="options-progress">
              <span style={{ transform: `scaleX(${o.progress})` }} />
            </span>
          )}
        </span>
      )}
      <span className="options-text">
        <span className="options-label">{o.label}</span>
        {o.detail && <span className="options-detail">{o.detail}</span>}
      </span>
      {o.badge && (
        <span
          className="options-badge"
          data-tone={o.badge.tone}
          data-icon={!!o.badge.icon}
          title={o.badge.icon ? o.badge.text : undefined}
          aria-label={o.badge.icon ? o.badge.text : undefined}
        >
          {o.badge.icon ?? o.badge.text}
        </span>
      )}
    </button>
  );
}

/**
 * Arrow keys: up/down within a column, left/right across columns. A column's
 * header controls (filters, sort, the settings cog) sit above its first row:
 * Up from the top reaches them, left/right moves along them.
 */
function moveFocus(root: HTMLElement | null, key: string) {
  if (!root) return;
  const active = document.activeElement as HTMLElement | null;
  const columns = [...root.querySelectorAll<HTMLElement>(".options-column")];
  const ci = Math.max(0, columns.findIndex((c) => c.contains(active)));
  const column = columns[ci];
  const head = [...column.querySelectorAll<HTMLElement>(".options-head :is(button, .select-trigger):not(:disabled)")];
  const items = [...column.querySelectorAll<HTMLElement>(".options-item:not(:disabled), .options-custom button:not(:disabled)")];
  const hi = head.indexOf(active as HTMLElement);
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const step = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;

  if (hi >= 0) {
    if (horizontal && head[hi + step]) return head[hi + step].focus();
    if (key === "ArrowDown") return show(items[0]);
    if (!horizontal) return;
  }
  if (horizontal) {
    const target = columns[ci + step];
    show(
      target?.querySelector<HTMLElement>('.options-list [aria-checked="true"]') ??
        target?.querySelector<HTMLElement>(".options-item, .options-custom button:not(:disabled)") ??
        undefined,
    );
    return;
  }
  const i = items.indexOf(active as HTMLElement);
  if (i === 0 && step < 0 && head.length) {
    return (head.find((el) => el.getAttribute("aria-pressed") === "true") ?? head[0]).focus();
  }
  show(items[Math.min(items.length - 1, Math.max(0, i + step))]);
}

/** Focus a row and bring it to the middle of its column, clear of the faded edges. */
function show(el: HTMLElement | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const list = el.closest<HTMLElement>(".options-list");
  if (!list) return;
  const smooth = !prefersReducedMotion();
  list.scrollTo({ top: el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2, behavior: smooth ? "smooth" : "auto" });
}
