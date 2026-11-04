import type { CSSProperties } from "react";

export type SkeletonProps = {
  /** `block` takes the box its classes give it (a card frame, a row); `line` is one line of text. */
  shape?: "block" | "line";
  /** The element: `div` for a block, `span` for a line, unless it sits where only phrasing content may. */
  as?: "div" | "span";
  /** Extra classes that give the block its size and corners (`stream-row`, `card-frame`). */
  className?: string;
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
};

/**
 * A shimmering placeholder in the shape of content that's still loading (docs/ui-components.md U20).
 * Hidden from assistive tech: it stands for nothing yet. Styling in styles/ui/skeleton.css.
 */
export function Skeleton({ shape = "block", as, className, width, height }: SkeletonProps) {
  const Tag = as ?? (shape === "line" ? "span" : "div");
  let cls = shape === "line" ? "skeleton skeleton-line" : "skeleton";
  if (className) cls = `${className} ${cls}`;
  const style = width !== undefined || height !== undefined ? { width, height } : undefined;
  return <Tag className={cls} style={style} aria-hidden />;
}
