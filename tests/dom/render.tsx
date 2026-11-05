import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** Renders `node` into a fresh element on the page; `unmount` takes it away again. */
export async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Presses a key on `target` (the focused element by default), as a bubbling `keydown`. */
export async function press(key: string, target: EventTarget = document.activeElement ?? document.body) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => void target.dispatchEvent(e));
  return e;
}

/** Clicks `el` inside `act`. */
export const click = (el: Element | null) => act(async () => void (el as HTMLElement).click());

/** The element matching `selector` whose text is `text`. */
export function byText(root: ParentNode, selector: string, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim() === text);
  if (!found) throw new Error(`no ${selector} reading "${text}"`);
  return found;
}
