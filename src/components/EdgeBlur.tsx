/**
 * The navbar's progressive blur, pointed any way: an ellipse hanging from the
 * edge set by the `--edge-at` CSS variable (default: the bottom edge), deepest
 * at its middle and clearing to nothing inward. See `.edge-blur` in cards.css.
 */
export function EdgeBlur({ className }: { className?: string }) {
  return (
    <span className={className ? `edge-blur ${className}` : "edge-blur"} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
