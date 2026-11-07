import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { OptionsOverlay, type OptionColumn } from "../../src/components/player/OptionsOverlay";
import { render } from "./render";

// The player's panels (#202): a click that just misses a control, in the panel's gaps or a little past its
// edge, does nothing; only a click clearly outside closes it. Rects are set by hand (happy-dom has no layout):
// a short column at x 100–400, y 100–300, and a tall one at x 500–800, y 100–700.

const columns: OptionColumn[] = [
  { title: "Audio", options: [{ id: "a", label: "English" }], value: "a", onSelect: () => {} },
  { title: "Subtitles", options: [{ id: "s", label: "Off" }], value: "s", onSelect: () => {} },
];

const RECTS = [
  { left: 100, top: 100, right: 400, bottom: 300 },
  { left: 500, top: 100, right: 800, bottom: 700 },
];

/** Each test's overlay, taken off the page (and out of the layer stack) after it. */
let view: Awaited<ReturnType<typeof render>> | null = null;

async function open() {
  let closed = 0;
  view = await render(<OptionsOverlay open media={null} columns={columns} onClose={() => closed++} />);
  view.container.querySelectorAll<HTMLElement>(".options-column").forEach((el, i) => {
    const r = RECTS[i];
    el.getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r }) as DOMRect;
  });
  const shade = view.container.querySelector<HTMLElement>(".options-shade")!;
  /** A press at (x, y), released at `to`, on the blur behind the columns. */
  const tap = async (x: number, y: number, { to = [x, y], pointerType = "mouse", target = shade as Element } = {}) => {
    const init = { bubbles: true, button: 0, pointerId: 1, pointerType };
    await act(async () => void target.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: x, clientY: y })));
    await act(async () => void target.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: to[0], clientY: to[1] })));
  };
  return { tap, closed: () => closed };
}

afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = "";
});

test("a click in the gap between columns, or under a short one, leaves the panel open", async () => {
  const p = await open();
  await p.tap(450, 200); // between the columns
  await p.tap(250, 600); // under the short column, beside the tall one
  expect(p.closed()).toBe(0);
});

test("a click just past the panel's edge leaves it open; clearly outside closes it", async () => {
  const p = await open();
  await p.tap(85, 200);
  await p.tap(815, 715);
  expect(p.closed()).toBe(0);
  await p.tap(20, 20);
  expect(p.closed()).toBe(1);
});

test("#320: a click 50 px left or right of the panel leaves it open; clearly away from it closes it", async () => {
  const p = await open();
  await p.tap(50, 200);
  await p.tap(850, 600);
  expect(p.closed()).toBe(0);
  await p.tap(30, 200);
  expect(p.closed()).toBe(1);
  await p.tap(870, 200);
  expect(p.closed()).toBe(2);
});

test("#320: the margin is wider at the sides than above and below", async () => {
  const p = await open();
  await p.tap(60, 200); // 40 px to the left
  expect(p.closed()).toBe(0);
  await p.tap(250, 60); // 40 px above
  expect(p.closed()).toBe(1);
  await p.tap(650, 740); // 40 px below
  expect(p.closed()).toBe(2);
});

test("a touch gets a wider margin than a mouse", async () => {
  const p = await open();
  await p.tap(20, 200, { pointerType: "touch" });
  await p.tap(250, 65, { pointerType: "touch" });
  expect(p.closed()).toBe(0);
  await p.tap(20, 200);
  expect(p.closed()).toBe(1);
});

test("#320: a control inside the margin still takes its click", async () => {
  const p = await open();
  const close = view!.container.querySelector<HTMLElement>(".options-close")!;
  await p.tap(60, 200, { target: close });
  expect(p.closed()).toBe(0); // the press itself doesn't close the panel...
  await act(async () => close.click());
  expect(p.closed()).toBe(1); // ...the button does, as its own click
});

test("a press outside that turns into a drag or a scroll doesn't close it, nor one that ends inside", async () => {
  const p = await open();
  await p.tap(20, 400, { to: [20, 460] });
  await p.tap(20, 400, { to: [300, 200] });
  expect(p.closed()).toBe(0);
});

test("with a dropdown open, a click outside closes only the dropdown", async () => {
  const p = await open();
  const popup = document.createElement("div");
  popup.className = "select-popup";
  document.body.append(popup);
  await p.tap(20, 20);
  expect(p.closed()).toBe(0);
  popup.remove();
  await p.tap(20, 20);
  expect(p.closed()).toBe(1);
});
