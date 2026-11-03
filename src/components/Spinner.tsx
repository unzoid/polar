/**
 * The app's loading spinner, after Vercel's Geist spinner: twelve bars round
 * a circle, each fading in turn. Takes the text colour. Styling in base.css (`.spinner`).
 */
export function Spinner({ size = 20, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <span
      className={className ? `spinner ${className}` : "spinner"}
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="spinner-wheel">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="spinner-bar" />
        ))}
      </span>
    </span>
  );
}
