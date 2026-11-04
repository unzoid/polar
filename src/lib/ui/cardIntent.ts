import { useEffect, useRef } from "react";

/**
 * Warms what a card opens once the pointer or focus has rested on it for `delay` ms (docs/ui-components.md
 * U1): the handlers to spread on the card. Leaving first cancels it, and so does unmounting.
 */
export function useCardIntent(warm: () => void, delay: number) {
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const start = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(warm, delay);
  };
  const cancel = () => window.clearTimeout(timer.current);
  return { onPointerEnter: start, onPointerLeave: cancel, onFocus: start, onBlur: cancel };
}
