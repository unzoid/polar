/** Circular-arrow "10" skip glyph, drawn to match the 1.75 stroke of lucide. */
export function SkipIcon({ direction, size = 44 }: { direction: "back" | "forward"; size?: number }) {
  const flip = direction === "forward";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <g transform={flip ? "translate(48 0) scale(-1 1)" : undefined} stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        {/* 300° arc, open at the top-left where the arrowheads sit */}
        <path d="M18.2 7.9A17 17 0 1 1 8.6 16" />
        <path d="M17 4l3.2 4.4L15.6 11" />
        <path d="M23 4l3.2 4.4L21.6 11" />
      </g>
      <text x="24" y="30.5" textAnchor="middle" fontSize="13.5" fontWeight="700" fill="currentColor" fontFamily="Inter Variable, system-ui, sans-serif">
        10
      </text>
    </svg>
  );
}
