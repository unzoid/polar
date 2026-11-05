import { isDesktop } from "../platform/device";

/** A field the on-screen keyboard types into. */
export const isTextField = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);

/**
 * Keeps the focused text field in view while the on-screen keyboard opens on a phone or tablet
 * (docs/plan-mobile.md §2.4). On Android the shell shortens the web view to end at the keyboard (gen/android
 * MainActivity.kt keepAboveKeyboard); iOS shrinks the visual viewport. Either way the page gets a resize, and
 * a field near the bottom of a page that scrolls inside its own container is brought back above the keyboard.
 */
export function installKeepFieldInView(win: Window = window, onlyTouch = !isDesktop): () => void {
  if (!onlyTouch) return () => {};
  const onResize = () => {
    const el = win.document.activeElement;
    if (!isTextField(el)) return;
    win.requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }));
  };
  win.addEventListener("resize", onResize);
  win.visualViewport?.addEventListener("resize", onResize);
  return () => {
    win.removeEventListener("resize", onResize);
    win.visualViewport?.removeEventListener("resize", onResize);
  };
}
