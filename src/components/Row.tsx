import { ChevronLeft, ChevronRight } from "./icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EdgeBlur } from "./EdgeBlur";

/**
 * A horizontal shelf. Native scrolling (wheel, trackpad momentum, scroll-snap)
 * does the physics; paddles page by one viewport width.
 */
export function Row({
  title,
  action,
  shape = "poster",
  children,
}: {
  title?: string;
  action?: ReactNode;
  shape?: "poster" | "landscape" | "episode";
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

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
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="row" data-shape={shape}>
      {(title || action) && (
        <header className="row-header">
          {title && <h2 className="t-title2">{title}</h2>}
          {action}
        </header>
      )}
      <div className="row-viewport" data-start={edges.start} data-end={edges.end}>
        <button className="row-paddle" data-dir="prev" onClick={() => page(-1)} aria-label="Scroll left" tabIndex={-1}>
          <EdgeBlur />
          <ChevronLeft size={22} />
        </button>
        <div className="row-scroller" ref={scroller}>
          {children}
        </div>
        <button className="row-paddle" data-dir="next" onClick={() => page(1)} aria-label="Scroll right" tabIndex={-1}>
          <EdgeBlur />
          <ChevronRight size={22} />
        </button>
      </div>
    </section>
  );
}
