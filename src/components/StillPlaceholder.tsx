import { EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

/** Shown in place of an episode still that doesn't exist yet or won't load. */
export function StillPlaceholder() {
  return (
    <span className="still-placeholder" aria-hidden>
      <EyeOff size={22} strokeWidth={1.75} />
    </span>
  );
}

/**
 * An episode still with a graceful fallback: no URL, or a URL that fails to
 * load (an unreleased episode has none; some listings point at images that
 * 404), renders the placeholder instead of the browser's broken-image glyph.
 */
export function Still({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <StillPlaceholder />;
  return <img src={src} alt="" className={className} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}
