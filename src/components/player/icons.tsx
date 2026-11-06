import { useEffect, useRef } from "react";

/** The motion system's strong ease-out (--ease-out in tokens), for WAAPI. */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Circular-arrow skip glyph with the number of seconds it jumps. Geometry is
 * the standard "rotate" arrow (round arc + corner arrowhead) on a 24 grid;
 * "back" is the mirror image.
 *
 * Each change of `kick` swings the arrow a little in its direction and back
 * (each seek, from the button or the keys). `numberOut`
 * sends the number out of the ring toward the side it jumps to; SeekButton
 * shows the running total out there meanwhile. Reduced motion: no swing, and
 * the number only fades (player.css).
 */
export function SkipIcon({
  direction,
  seconds = 10,
  size = 44,
  kick = 0,
  numberOut = false,
}: {
  direction: "back" | "forward";
  seconds?: number;
  size?: number;
  /** Bump to swing the arrow. */
  kick?: number;
  /** The number has left the ring (SeekButton's "+20" is showing). */
  numberOut?: boolean;
}) {
  const flip = direction === "back";
  const arrow = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!kick || !arrow.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The arrow sits inside the mirrored group, so the same angle turns "back" the other way.
    const swing = arrow.current.animate([{ rotate: "0deg" }, { rotate: "38deg", offset: 0.35 }, { rotate: "0deg" }], {
      duration: 420,
      easing: EASE_OUT,
    });
    return () => swing.cancel();
  }, [kick]);

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <g transform={flip ? "translate(24 0) scale(-1 1)" : undefined} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <g ref={arrow} className="skip-icon-part">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </g>
      </g>
      <text
        className="skip-icon-part skip-icon-number"
        data-out={numberOut}
        data-direction={direction}
        x="12"
        y="15.4"
        textAnchor="middle"
        fontSize={seconds >= 100 ? 6.4 : 8}
        fontWeight="700"
        fill="currentColor"
        fontFamily="Inter Variable, system-ui, sans-serif"
      >
        {seconds}
      </text>
    </svg>
  );
}
