/**
 * Score out of 10 as a ring: the arc fills to the score, coloured by band
 * (green ≥ 7, amber ≥ 5, red below), the number set in the middle.
 * The arc draws in once when the title opens.
 */
export function RatingRing({ value, size = 40 }: { value: string | number; size?: number }) {
  const score = Math.max(0, Math.min(10, Number(value)));
  if (!Number.isFinite(score) || score <= 0) return null;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = score >= 7 ? "good" : score >= 5 ? "mid" : "low";

  return (
    <span
      className="rating-ring"
      data-tone={tone}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Rated ${score.toFixed(1)} out of 10`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="rating-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="rating-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          style={{ "--ring-c": `${c}px`, strokeDashoffset: c * (1 - score / 10) } as React.CSSProperties}
        />
      </svg>
      <span className="rating-ring-value tabular">{score.toFixed(1)}</span>
    </span>
  );
}
