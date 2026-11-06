import { ChevronLeft, ChevronRight } from "./icons";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EdgeBlur } from "./EdgeBlur";
import { useOffscreenMark } from "../lib/ui";

/**
 * A horizontal shelf. Native scrolling (wheel, trackpad momentum, scroll-snap)
 * does the physics; paddles page by one viewport width. With `onOpen`, the
 * heading is a link to the shelf's full list, a chevron after it (#48).
 */
export function Row({
  title,
  onOpen,
  action,
  shape = "poster",
  order,
  loading = false,
  children,
}: {
  title?: string;
  /** Opens the full list behind the shelf. */
  onOpen?: () => void;
  action?: ReactNode;
  shape?: "poster" | "landscape" | "episode";
  /** The items' ids in order. When it changes, the shelf goes back to its start, or keeps a focused card in view. */
  order?: string;
  /** Skeletons stand in for the cards: their shimmer pauses while the shelf is out of view. */
  loading?: boolean;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  useOffscreenMark(section, loading);
  const [edges, setEdges] = useState({ start: true, end: false });
  // Until someone scrolls it, a shelf shows its first title. Titles shown
  // higher up are taken out of it as they load; without this, scroll-snap
  // keeps the card it was on in view and the shelf opens part-way along.
  const touched = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && !touched.current && el.scrollLeft !== 0) el.scrollLeft = 0;
  });

  // Resuming a title moves it to the front of Continue Watching; the shelf kept
  // its scroll offset, which now shows whatever took the title's old place.
  const shownOrder = useRef(order);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (shownOrder.current === order) return;
    shownOrder.current = order;
    if (!el) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && el.contains(focused)) {
      focused.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    touched.current = false;
    el.scrollLeft = 0;
  }, [order]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Same edges, same object: a new one on every scroll event would
    // re-render the shelf and all its cards for each frame scrolled.
    const update = () => {
      const start = el.scrollLeft < 4;
      const end = el.scrollLeft + el.clientWidth > el.scrollWidth - 4;
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
    };
    update();
    const touch = () => (touched.current = true);
    const events = ["wheel", "pointerdown", "touchstart", "keydown", "focusin"] as const;
    for (const e of events) el.addEventListener(e, touch, { passive: true });
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      for (const e of events) el.removeEventListener(e, touch);
      ro.disconnect();
    };
  }, []);

  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    touched.current = true;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="row" data-shape={shape} ref={section}>
      {(title || action) && (
        <header className="row-header">
          {title && (
            <h2 className="t-title2 row-title" title={onOpen ? undefined : title}>
              {onOpen ? (
                <button className="row-title-link" onClick={onOpen} title={`See all: ${title}`}>
                  <span className="row-title-text">{title}</span>
                  <ChevronRight className="row-title-chevron" size={20} strokeWidth={2.5} aria-hidden />
                </button>
              ) : (
                title
              )}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className="row-viewport" data-start={edges.start} data-end={edges.end}>
        <RowPaddle dir="prev" onPage={page} />
        <div className="row-scroller" ref={scroller}>
          {children}
        </div>
        <RowPaddle dir="next" onPage={page} />
      </div>
    </section>
  );
}

/**
 * One end of a sideways scroller: a blurred edge with a chevron that pages it. Home's shelves and
 * the player's episode rail share it (#250). Its parent is a `.row-viewport` whose `data-start` and
 * `data-end` say which ends are reached; cards.css shows the paddles while the viewport is hovered
 * or holds the keyboard focus, and hides each at its end. It never takes the focus itself, so
 * the arrow keys go on from the card they were on.
 */
export function RowPaddle({ dir, onPage }: { dir: "prev" | "next"; onPage: (dir: 1 | -1) => void }) {
  const prev = dir === "prev";
  return (
    <button
      className="row-paddle"
      data-dir={dir}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onPage(prev ? -1 : 1)}
      aria-label={prev ? "Scroll left" : "Scroll right"}
      tabIndex={-1}
    >
      <EdgeBlur />
      {prev ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
}
