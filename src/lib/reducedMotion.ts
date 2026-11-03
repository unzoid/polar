/**
 * Less motion, asked for either by Windows or by Settings → Appearance
 * (which App.tsx mirrors onto `<html data-reduce-motion>`). For JS-driven
 * motion; CSS handles the attribute itself in base.css.
 */
export function prefersReducedMotion() {
  const setting = document.documentElement.dataset.reduceMotion;
  if (setting === "on") return true;
  if (setting === "off") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
