import { useEffect, useRef, useState } from "react";

/**
 * Keeps the last `value` on screen for `ms` after it goes (becomes null), with `leaving` set
 * meanwhile, so what showed it can play its way out instead of vanishing (re-test 3a).
 */
export function usePresence<T>(value: T | null, ms: number): { shown: T | null; leaving: boolean } {
  const last = useRef<T | null>(value);
  const [, gone] = useState(0);
  if (value !== null) last.current = value;
  useEffect(() => {
    if (value !== null || last.current === null) return;
    const t = setTimeout(() => {
      last.current = null;
      gone((n) => n + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  if (value !== null) return { shown: value, leaving: false };
  return { shown: last.current, leaving: last.current !== null };
}
