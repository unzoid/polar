import { AnimatePresence, motion, useDragControls, useMotionValue, type PanInfo } from "motion/react";
import { useRef, type ReactNode } from "react";
import { ease, prefersReducedMotion, project, springs, useFormFactor, useLayer } from "../lib/ui";

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
  const y = useMotionValue(0);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  const bottom = useFormFactor().form === "phone";
  // With less motion Motion drops the slide; a fade keeps it from popping in and out.
  const fade = prefersReducedMotion() ? 0 : 1;

  useLayer(panel, open, onClose, { modal });

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const size = (bottom ? panel.current?.offsetHeight : panel.current?.offsetWidth) ?? 400;
    const landing = bottom ? info.offset.y + project(info.velocity.y) : info.offset.x + project(info.velocity.x);
    if (landing > size / 2) onClose();
  };
  const away = bottom ? { y: "100%", opacity: fade } : { x: "100%", opacity: fade };

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
              onClick={onClose}
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
            style={bottom ? { y } : { x }}
            initial={away}
            animate={{ ...(bottom ? { y: 0 } : { x: 0 }), opacity: 1, transition: springs.sheet }}
            exit={{ ...away, transition: springs.sheet }} // velocity carries over from a flick; no bounce needed off-screen
            drag={bottom ? "y" : "x"}
            // A bottom sheet is pulled by its header only: the list below scrolls up and down.
            dragControls={bottom ? drag : undefined}
            dragListener={!bottom}
            dragDirectionLock
            dragConstraints={bottom ? { top: 0, bottom: 0 } : { left: 0, right: 0 }}
            dragElastic={bottom ? { top: 0.08, bottom: 1 } : { left: 0.08, right: 1 }} // resist away from the edge, follow towards it 1:1
            dragMomentum={false}
            dragTransition={{ bounceStiffness: 500, bounceDamping: 40 }}
            onDragEnd={onDragEnd}
          >
            <header className="sheet-header" onPointerDown={bottom ? (e) => drag.start(e) : undefined}>
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
