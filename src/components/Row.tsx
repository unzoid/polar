import { ChevronLeft, ChevronRight } from "./icons";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
    const update = () =>
      setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 4 });
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
          <ChevronLeft size={22} />
        </button>
        <div className="row-scroller" ref={scroller}>
          {children}
        </div>
        <button className="row-paddle" data-dir="next" onClick={() => page(1)} aria-label="Scroll right" tabIndex={-1}>
          <ChevronRight size={22} />
        </button>
      </div>
    </section>
  );
}
