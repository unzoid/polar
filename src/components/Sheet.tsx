import { AnimatePresence, motion, useMotionValue, type PanInfo } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { project, springs } from "../lib/motion";

/**
 * A side sheet that enters from the right and leaves the same way.
 *
 * - Interruptible: it's a spring on a motion value, so a sheet that's closing
 *   can be grabbed and pulled back mid-flight.
 * - Drag-to-dismiss uses momentum projection: a short flick closes it even if
 *   the finger barely moved, because we decide on where the throw *lands*.
 * - Dragging the wrong way (left) rubber-bands instead of hitting a wall.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  modal = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Modal sheets dim what's behind; non-modal ones keep the flow visible. */
  modal?: boolean;
}) {
  const x = useMotionValue(0);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const width = panel.current?.offsetWidth ?? 400;
    const landing = info.offset.x + project(info.velocity.x);
    if (landing > width / 2) onClose();
  };

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
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              onClick={onClose}
            />
          )}
          <motion.aside
            ref={panel}
            className="sheet"
            role="dialog"
            aria-modal={modal}
            style={{ x }}
            initial={{ x: "100%" }}
            animate={{ x: 0, transition: springs.sheet }}
            exit={{ x: "100%", transition: springs.sheet }} // velocity carries over from a flick; no bounce needed off-screen
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.08, right: 1 }} // resist leftward, follow rightward 1:1
            dragMomentum={false}
            dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
            onDragEnd={onDragEnd}
          >
            <header className="sheet-header">
              <div className="sheet-grabber" aria-hidden />
              <div>
                <h2 className="t-title2">{title}</h2>
                {subtitle && <p className="t-caption muted">{subtitle}</p>}
              </div>
            </header>
            <div className="sheet-body">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
