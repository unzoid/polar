import { Hidden } from "./icons";
import { useCardArt } from "./title/Card";

/** Shown in place of an episode still that doesn't exist yet or won't load. */
export function StillPlaceholder() {
  return (
    <span className="still-placeholder" aria-hidden>
      <Hidden size={22} strokeWidth={1.75} />
    </span>
  );
}

/**
 * An episode still with a graceful fallback: no URL, or a URL that fails to
 * load (an unreleased episode has none; some listings point at images that
 * 404), renders the placeholder instead of the browser's broken-image glyph.
 */
export function Still({ src, className }: { src?: string; className?: string }) {
  const { shown, onError } = useCardArt(src);
  if (!shown) return <StillPlaceholder />;
  return <img src={shown} alt="" className={className} loading="lazy" decoding="async" draggable={false} onError={onError} />;
}
