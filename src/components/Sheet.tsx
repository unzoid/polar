import { animate, AnimatePresence, motion, useDragControls, useMotionValue, type PanInfo } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { os } from "../lib/platform";
import { type Detent, ease, mediumOffset, missMargin, prefersReducedMotion, project, restingDetent, springs, useFormFactor, useLayer } from "../lib/ui";

/**
 * A side sheet that enters from the right and leaves the same way; on a phone, a
 * bottom sheet that rises from the bottom edge and is pulled down by its header
 * (the list inside keeps its own vertical scroll).
 *
 * - Interruptible: it's a spring on a motion value, so a sheet that's closing
 *   can be grabbed and pulled back mid-flight.
 * - Drag-to-dismiss uses momentum projection: a short flick closes it even if
 *   the finger barely moved, because we decide on where the throw *lands*.
 * - Dragging the wrong way (left) rubber-bands instead of hitting a wall.
 * - A modal sheet takes focus when it opens, keeps Tab inside and gives focus back when it closes.
 * - On an iPhone it rests at iOS's detents (lib/ui/detents.ts), as the system's own sheets do: it opens at half
 *   the screen, its header pulls it up to nearly all of it or down to close, scrolling the list expands it, and
 *   the grabber toggles between the two.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  modal = true,
  forgiveMisses = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Modal sheets dim what's behind; non-modal ones keep the flow visible. */
  modal?: boolean;
  /** A click on the dim just left of a side sheet does nothing; only one clearly away from it closes it (#320). */
  forgiveMisses?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  const bottom = useFormFactor().form === "phone";
  const detents = bottom && os === "ios";
  const x = useMotionValue(0);
  // A sheet with detents starts below the screen, and a closed one ends there, so it never shows a frame at the top.
  const y = useMotionValue(detents ? window.innerHeight : 0);
  const [detent, setDetent] = useState<Detent>("medium");
  const touchY = useRef(0);
  /** The sheet's large height and its medium offset, measured when it opens and when the window resizes. */
  const [stops, setStops] = useState({ height: window.innerHeight, medium: 0, measured: false });
  // With less motion Motion drops the slide; a fade keeps it from popping in and out.
  const fade = prefersReducedMotion() ? 0 : 1;

  useLayer(panel, open, onClose, { modal });

  /** The kind of pointer that pressed on the dim: a finger gets a wider margin than a mouse. */
  const pointer = useRef("mouse");
  const onScrimClick = (e: { clientX: number }) => {
    const edge = panel.current?.getBoundingClientRect().left;
    if (forgiveMisses && !bottom && edge !== undefined && e.clientX >= edge - missMargin(pointer.current).x) return;
    onClose();
  };

  // A new detent moves the sheet through `animate` below; the same one again (a drag let go near it) springs back here.
  const rest = (to: Detent, velocity = 0) => {
    if (to !== detent) return setDetent(to);
    const target = to === "large" ? 0 : stops.medium;
    if (prefersReducedMotion()) y.set(target);
    else animate(y, target, { ...springs.sheet, velocity });
  };

  useLayoutEffect(() => {
    if (!open || !detents) return;
    const measure = () => {
      const height = panel.current?.offsetHeight ?? window.innerHeight;
      setStops({ height, medium: mediumOffset(height, window.innerHeight), measured: true });
    };
    measure();
    setDetent("medium");
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, detents]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (detents) {
      const next = restingDetent(y.get() + project(info.velocity.y), stops.medium, stops.height);
      return next ? rest(next, info.velocity.y) : onClose();
    }
    const size = (bottom ? panel.current?.offsetHeight : panel.current?.offsetWidth) ?? 400;
    const landing = bottom ? info.offset.y + project(info.velocity.y) : info.offset.x + project(info.velocity.x);
    if (landing > size / 2) onClose();
  };
  const medium = detents && detent === "medium";
  const away = detents ? { y: stops.height, opacity: fade } : bottom ? { y: "100%", opacity: fade } : { x: "100%", opacity: fade };

  return (
    <AnimatePresence>
      {open && (
        <>
          {modal && (
            <motion.div
              className="sheet-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: ease.out }}
              onPointerDown={(e) => (pointer.current = e.pointerType)}
              onClick={onScrimClick}
            />
          )}
          <motion.aside
            ref={panel}
            className="sheet"
            role="dialog"
            aria-modal={modal}
            tabIndex={-1}
            data-layer=""
            data-edge={bottom ? "bottom" : "right"}
            data-detent={detents ? detent : undefined}
            style={bottom ? { y } : { x }}
            // With detents the sheet starts below the screen (`y`) and rises to its detent once measured.
            initial={detents ? { opacity: fade } : away}
            animate={{ ...(detents ? (stops.measured ? { y: detent === "large" ? 0 : stops.medium } : {}) : bottom ? { y: 0 } : { x: 0 }), opacity: 1, transition: springs.sheet }}
            exit={{ ...away, transition: springs.sheet }} // velocity carries over from a flick; no bounce needed off-screen
            drag={bottom ? "y" : "x"}
            // A bottom sheet is pulled by its header only: the list below scrolls up and down.
            dragControls={bottom ? drag : undefined}
            dragListener={!bottom}
            dragDirectionLock
            dragConstraints={detents ? { top: 0 } : bottom ? { top: 0, bottom: 0 } : { left: 0, right: 0 }}
            dragElastic={bottom ? { top: 0.08, bottom: 1 } : { left: 0.08, right: 1 }} // resist away from the edge, follow towards it 1:1
            dragMomentum={false}
            dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
            onDragEnd={onDragEnd}
          >
            <header className="sheet-header" onPointerDown={bottom ? (e) => drag.start(e) : undefined}>
              {detents ? (
                <button
                  className="sheet-grabber"
                  aria-label={detent === "medium" ? "Expand" : "Collapse"}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => rest(detent === "medium" ? "large" : "medium")}
                />
              ) : (
                <div className="sheet-grabber" aria-hidden />
              )}
              <div>
                <h2 className="t-title2">{title}</h2>
                {subtitle && <p className="t-caption muted">{subtitle}</p>}
              </div>
            </header>
            <div
              className="sheet-body"
              // Scrolling the list at half height, or pushing it up, brings the rest of it up first, as iOS's sheets do.
              onScroll={medium ? (e) => e.currentTarget.scrollTop > 0 && rest("large") : undefined}
              onTouchStart={medium ? (e) => (touchY.current = e.touches[0].clientY) : undefined}
              onTouchMove={medium ? (e) => touchY.current - e.touches[0].clientY > 10 && rest("large") : undefined}
            >
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
