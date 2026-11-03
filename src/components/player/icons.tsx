/**
 * Circular-arrow skip glyph with the number of seconds it jumps. Geometry is
 * the standard "rotate" arrow (round arc + corner arrowhead) on a 24 grid;
 * "back" is the mirror image.
 */
export function SkipIcon({ direction, seconds = 10, size = 44 }: { direction: "back" | "forward"; seconds?: number; size?: number }) {
  const flip = direction === "back";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <g transform={flip ? "translate(24 0) scale(-1 1)" : undefined} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </g>
      <text x="12" y="15.4" textAnchor="middle" fontSize={seconds >= 100 ? 6.4 : 8} fontWeight="700" fill="currentColor" fontFamily="Inter Variable, system-ui, sans-serif">
        {seconds}
      </text>
    </svg>
  );
}
