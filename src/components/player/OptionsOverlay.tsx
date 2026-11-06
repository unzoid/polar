import { Check, Close, Info, Instant } from "../icons";
import { useSourceRowPress } from "../SourceInfo";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Still } from "../StillPlaceholder";
import { VideoBackdrop } from "./VideoBackdrop";
import { IconButton } from "../ui/Button";
import type { MediaLike } from "./mpvMedia";
import { prefersReducedMotion, useLayer } from "../../lib/ui";
import { nearest } from "../../tv/spatial";

export interface OptionItem {
  id: string;
  label: string;
  /** Second line: addon · size, airdate · time left, … */
  detail?: string;
  /** 16:9 still shown before the text (episodes). */
  thumbnail?: string;
  /** 0–1 watch progress drawn under the thumbnail. */
  progress?: number;
  /** Small trailing tag: "Watched", "CAM". */
  /** Trailing tag. With `icon`, the icon is shown and `text` becomes its label. */
  badge?: { text: string; tone?: "good" | "bad"; icon?: ReactNode };
  icon?: ReactNode;
  /** Starts a group: a small heading above this row ("Other sources"). */
  heading?: string;
  disabled?: boolean;
  /** A source checked ahead of time (#21): "yes" shows the bolt, "no" dims the row. */
  ready?: "yes" | "no";
  /** Hover text. */
  note?: string;
  /** A source's "i" panel (#229), from the row's "i", a long press or a right-click. */
  onInfo?: (anchor: HTMLElement) => void;
  /** TV: the row's menu (Info, Play), from holding OK or the options button. */
  onMenu?: (anchor: HTMLElement) => void;
}

export interface OptionColumn {
  title: string;
  options: OptionItem[];
  value?: string;
  onSelect: (id: string) => void;
  /** Shown when the column has nothing to pick. */
  empty?: string;
  /** Wide columns hold rich rows (sources); narrow ones plain labels; full spans the screen (the episode rail). */
  size?: "narrow" | "medium" | "wide" | "full";
  /** The title is for screen readers only: the header stands in for it (the season dropdown above the episodes). */
  titleHidden?: boolean;
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
  /** A press that may become a click outside the panel. */
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const missesPanel = (e: { target: EventTarget; clientX: number; clientY: number; pointerType: string }) => {
    if ((e.target as Element).closest?.(".options-close, .select-popup, .srcf-popover, .source-info, .tv-source-menu-layer")) return false;
    const rects = [...(root.current?.querySelectorAll(".options-column") ?? [])].map((el) => el.getBoundingClientRect());
    return outsidePanel(e.clientX, e.clientY, rects, e.pointerType === "touch" ? MISS_MARGIN.touch : MISS_MARGIN.mouse);
  };
  // Stay mounted through the exit transition.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = window.setTimeout(() => setMounted(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

  // Escape through the shared dismiss stack (lib/ui/dismiss.ts), Tab kept inside, focus back to the
  // opener on close. The parent passes a fresh onClose several times a second during playback;
  // useLayer reads the newest without re-running anything (which would snap the lists back mid-scroll).
  useLayer(root, open, onClose);

  // Once per opening: show the current choice in every column, focus it for the keyboard.
  useEffect(() => {
    if (!open || !mounted) return;
    // Scroll each list itself — not scrollIntoView, which also scrolls every
    // ancestor (even overflow:hidden ones) and would shift the whole layer.
    root.current?.querySelectorAll<HTMLElement>('[aria-checked="true"]').forEach((el) => {
      const list = el.closest<HTMLElement>(".options-list");
      if (list) list.scrollTop = topIn(list, el) - list.clientHeight / 2 + el.offsetHeight / 2;
    });
    // The episode rail starts from the one playing (#226). Nothing chosen yet: the layer itself, so Tab and the arrows start inside it.
    const chosen = root.current?.querySelector<HTMLElement>('.episode-rail [aria-current="true"] > .episode-rail-main') ?? root.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (chosen ?? root.current)?.focus({ preventScroll: true });
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    const onKey = (e: KeyboardEvent) => {
      // An open dropdown inside the overlay handles its own keys.
      if (document.querySelector(OPEN_POPUP)) return;
      // A slider (the source list's size range) takes the arrows for itself.
      if ((e.target as HTMLElement | null)?.closest?.('[role="slider"], input[type="range"]')) return;
      // A text field (the party code) keeps its caret keys.
      if ((e.target as HTMLElement | null)?.matches?.('input:not([type]), input[type="text"]')) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.stopPropagation();
        e.preventDefault();
        moveFocus(root.current, e.key);
      }
      // Space/Enter act on the focused row natively; keep them from the player. A TV source row times
      // OK itself (held, it opens the row's menu) and keeps it from the player on its own.
      if ((e.key === " " || e.key === "Enter") && !(e.target as HTMLElement | null)?.closest?.("[data-hold-ok]")) e.stopPropagation();
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
      tabIndex={-1}
      data-layer=""
      // A click clearly outside the panel closes it; one that just misses a control does nothing (#202).
      onPointerDown={(e) => {
        press.current = null;
        if (e.button !== 0 || !missesPanel(e)) return;
        // A dropdown open in the panel closes on this click by itself: the panel stays.
        if (document.querySelector(OPEN_POPUP)) return;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        // Released where it was pressed (not a drag or a scroll), and still clearly outside.
        if (p?.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP && missesPanel(e)) onClose();
      }}
      onPointerCancel={() => (press.current = null)}
    >
      <VideoBackdrop media={media} />
      <div className="options-shade" aria-hidden />
      <IconButton variant="player" className="options-close" onClick={onClose} label="Close" title="Close (Esc)">
        <Close size={26} />
      </IconButton>
      <div className="options-columns" data-count={columns.length}>
        {columns.map((col, c) => (
          <section key={col.title} className="options-column" data-column={c} data-size={col.size ?? "narrow"}>
            <div className="options-head">
              <h2 className="options-title" data-hidden={col.titleHidden || undefined}>
                {col.title}
              </h2>
              {col.header}
            </div>
            {col.content ? (
              <div className="options-list options-custom">{col.content}</div>
            ) : (
              <>
                {col.options.length === 0 && col.empty && <p className="options-empty">{col.empty}</p>}
                <div role="radiogroup" aria-label={col.title} className="options-list">
                  {col.options.map((o) => (
                    <Fragment key={o.id}>
                      {o.heading && <p className="options-group">{o.heading}</p>}
                      <Row item={o} selected={o.id === col.value} onSelect={col.onSelect} />
                    </Fragment>
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

/** A dropdown or popover open over the panel. Closed ones can stay in the page (marked data-closed): they don't count (#226). */
const OPEN_POPUP = ".select-popup:not([data-closed]), .srcf-popover:not([data-closed]), .source-info, .tv-source-menu";
/** Past the panel's content, a click still counts as a miss for this far (px); a finger gets more room. */
const MISS_MARGIN = { mouse: 24, touch: 40 };
/** A press that travels further than this (px) is a drag or a scroll, not a click. */
const CLICK_SLOP = 10;

/**
 * Whether (x, y) is clearly outside the panel: past the box around all its
 * columns (their gaps and the space beside a short one included) by more than
 * `margin`.
 */
export function outsidePanel(x: number, y: number, rects: readonly Pick<DOMRect, "left" | "top" | "right" | "bottom">[], margin: number) {
  if (!rects.length) return true;
  const left = Math.min(...rects.map((r) => r.left)) - margin;
  const top = Math.min(...rects.map((r) => r.top)) - margin;
  const right = Math.max(...rects.map((r) => r.right)) + margin;
  const bottom = Math.max(...rects.map((r) => r.bottom)) + margin;
  return x < left || x > right || y < top || y > bottom;
}

function Row({ item: o, selected, onSelect }: { item: OptionItem; selected: boolean; onSelect: (id: string) => void }) {
  const press = useSourceRowPress({ onPick: () => onSelect(o.id), onInfo: (a) => o.onInfo?.(a), onMenu: o.onMenu });
  const row = (
    <button
      role="radio"
      aria-checked={selected}
      disabled={o.disabled}
      className="options-item"
      data-rich={!!(o.detail || o.thumbnail)}
      data-ready={o.ready}
      data-hold-ok={o.onInfo && o.onMenu ? true : undefined}
      title={o.note}
      onClick={() => onSelect(o.id)}
      {...(o.onInfo ? press : {})}
    >
      <span className="options-check" aria-hidden>
        {selected ? <Check size={20} strokeWidth={2.5} /> : o.ready === "yes" ? <Instant size={17} fill="currentColor" strokeWidth={0} /> : null}
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
  if (!o.onInfo || o.onMenu) return row;
  // The "i" on the row's right, while it's hovered or focused (player.css).
  return (
    <div className="options-item-wrap">
      {row}
      <button className="options-info" aria-label="Source info" title="Source info" onClick={(e) => o.onInfo?.(e.currentTarget.previousElementSibling as HTMLElement)}>
        <Info size={20} />
      </button>
    </div>
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

  // The episode rail (#226): left/right card by card, down to a card's Download and back, up to the
  // head; down from the head (or left/right from elsewhere) lands on the first card in view. EpisodeRail scrolls the focused card in.
  const rail = column.querySelector<HTMLElement>(".episode-rail");
  if (rail) {
    const mains = [...rail.querySelectorAll<HTMLElement>(".episode-rail-main:not(:disabled)")];
    const card = active?.closest<HTMLElement>(".episode-rail-card");
    if (card && rail.contains(card)) {
      const main = card.querySelector<HTMLElement>(".episode-rail-main");
      if (horizontal) return mains[mains.indexOf(main!) + step]?.focus({ preventScroll: true });
      if (active !== main) return key === "ArrowUp" ? main?.focus({ preventScroll: true }) : undefined;
      if (key === "ArrowDown") return card.querySelector<HTMLElement>(".episode-rail-download")?.focus({ preventScroll: true });
      return head[0]?.focus();
    }
    if (key === "ArrowDown" || (horizontal && hi < 0)) {
      const inView = mains.find((m) => m.closest<HTMLElement>(".episode-rail-card")!.offsetLeft >= rail.scrollLeft - 1) ?? mains[0];
      return inView?.focus({ preventScroll: true });
    }
  }

  if (hi >= 0) {
    // TV's filter chips come in rows (re-test 7): left/right along a row, up/down between rows,
    // down from the last row into the list.
    const row = active!.closest(".srcf-chiprow");
    if (row) {
      const inRow = head.filter((el) => row.contains(el));
      if (horizontal) return inRow[inRow.indexOf(active!) + step]?.focus();
      const next = nearest(active!, head.filter((el) => !row.contains(el)), key === "ArrowDown" ? "down" : "up");
      if (next) return next.focus();
    } else if (horizontal && head[hi + step]) return head[hi + step].focus();
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
    // Into the last row of chips when there are rows, else the head's pressed control.
    const rows = [...column.querySelectorAll(".options-head .srcf-chiprow")];
    const last = rows.at(-1);
    const pool = last ? head.filter((el) => last.contains(el)) : head;
    return (pool.find((el) => el.getAttribute("aria-pressed") === "true") ?? pool[0]).focus();
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
  list.scrollTo({ top: topIn(list, el) - list.clientHeight / 2 + el.offsetHeight / 2, behavior: smooth ? "smooth" : "auto" });
}

/** Where a row starts in its scrolling list (a source row sits in a wrapper with its "i", so offsetTop won't do). */
function topIn(list: HTMLElement, el: HTMLElement) {
  return el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
}
