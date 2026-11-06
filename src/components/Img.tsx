import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { imageBroken, imageLoaded, markImageBroken, markImageLoaded } from "../lib/ui";

export type ImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  /** Pictures to try in turn when `src` doesn't load (a 404 still for an unaired episode: the show's art). */
  fallbacks?: (string | null | undefined)[];
  /** Nothing in the chain loaded (or there was nothing): the caller shows something else. */
  onFail?: () => void;
};

/**
 * An image that fades in once decoded instead of painting top-to-bottom. One that fails moves on to
 * the next of `fallbacks`, and when none loads it's gone (test report 1, items 10 and 31), so a
 * missing picture never leaves an invisible box behind. One that already loaded this session shows at once,
 * without the fade; pictures that answered with an error aren't asked for again (lib/ui/artGate.ts keeps both).
 */
export function Img({ className = "", onLoad, onError, fallbacks, onFail, src, ...props }: ImgProps) {
  const [, setFailures] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const chain = [src, ...(fallbacks ?? [])].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  const current = chain.find((u) => !imageBroken(u));
  useEffect(() => {
    if (!current) onFail?.();
    // Only when the chain runs out; `onFail` is often a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  if (!current) return null;
  return (
    <img
      key={current}
      decoding="async"
      loading="lazy"
      draggable={false}
      {...props}
      src={current}
      className={`img-fade ${className}`}
      data-loaded={loaded === current || imageLoaded(current)}
      onLoad={(e) => {
        setLoaded(current);
        markImageLoaded(current);
        onLoad?.(e);
      }}
      onError={(e) => {
        markImageBroken(current);
        setFailures((n) => n + 1);
        onError?.(e);
      }}
    />
  );
}
