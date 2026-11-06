import type { ReactNode } from "react";
import { Row } from "../Row";
import { CardSkeleton, type CardShape } from "./Card";

/**
 * A titled shelf of cards (docs/ui-components.md U2): skeletons of its shape until `items` is there, then one card
 * per item from `card` (which sets the key). Leaving a shelf out when it's empty is the caller's call.
 */
export function Shelf<T>({
  title,
  onOpen,
  shape = "poster",
  action,
  items,
  skeletons = 8,
  card,
}: {
  title: string;
  /** Opens the full list behind the shelf: the heading becomes a link (#48). */
  onOpen?: () => void;
  shape?: CardShape;
  action?: ReactNode;
  items?: readonly T[];
  skeletons?: number;
  card: (item: T) => ReactNode;
}) {
  return (
    <Row title={title} onOpen={onOpen} shape={shape} action={action} loading={!items}>
      {items ? items.map(card) : Array.from({ length: skeletons }, (_, i) => <CardSkeleton key={i} shape={shape} />)}
    </Row>
  );
}

