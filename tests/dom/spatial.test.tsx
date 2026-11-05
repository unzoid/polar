import { expect, test } from "bun:test";
import { nearest } from "../../src/tv/spatial";

/** A button drawn at x, y with size w × h (happy-dom has no layout). */
function at(parent: HTMLElement, name: string, x: number, y: number, w: number, h: number) {
  const b = document.createElement("button");
  b.textContent = name;
  b.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
  parent.append(b);
  return b;
}

test("TV: down from a filter chip goes to the next row of chips, not into the list (test report 1, item 7)", () => {
  const panel = document.createElement("div");
  const filters = document.createElement("div");
  filters.setAttribute("data-nav-group", "");
  panel.append(filters);
  document.body.append(panel);
  // Row 1 runs wide; row 2 has two chips on the left; the list sits under them, full width.
  const far = at(filters, "Italian", 700, 0, 100, 40);
  const row2 = at(filters, "4K", 0, 60, 80, 40);
  at(filters, "1080p", 90, 60, 80, 40);
  const list = at(panel, "Source 1", 0, 120, 1000, 80);
  const all = [far, row2, ...filters.querySelectorAll("button"), list].filter((b, i, a) => a.indexOf(b) === i) as HTMLElement[];
  expect(nearest(far, all, "down")?.textContent).toBe("1080p");
  // From the last row, down leaves for the list; from the list, up comes back into the chips.
  expect(nearest(row2, all, "down")).toBe(list);
  expect(nearest(list, all, "up")?.textContent).toBe("1080p");
  panel.remove();
});
