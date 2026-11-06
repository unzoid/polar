import { expect, test } from "bun:test";
import { openContextMenu } from "../../src/lib/platform/longPress";

test("a long press sends a right-click's contextmenu where the finger is; it counts only when a menu took it", () => {
  const card = document.createElement("button");
  const plain = document.createElement("div");
  document.body.append(card, plain);
  let at: [number, number] | null = null;
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    at = [e.clientX, e.clientY];
  });
  // The app's catch-all: keeps the web view's own menu away, opens nothing.
  const catchAll = (e: Event) => e.preventDefault();
  document.addEventListener("contextmenu", catchAll);
  try {
    expect(openContextMenu({ target: card, x: 40, y: 50 })).toBe(true);
    expect(at).toEqual([40, 50]);
    expect(openContextMenu({ target: plain, x: 40, y: 50 })).toBe(false);
    expect(openContextMenu({ target: null, x: 40, y: 50 })).toBe(false);
  } finally {
    document.removeEventListener("contextmenu", catchAll);
    card.remove();
    plain.remove();
  }
});
