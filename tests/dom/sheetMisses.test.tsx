import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { Sheet } from "../../src/components/Sheet";
import { render } from "./render";

// The title page's source list (#320): a side sheet whose left edge is at x 1000 (set by hand: happy-dom has no
// layout). A click on the dim just left of it does nothing; one clearly away from it closes it.

let view: Awaited<ReturnType<typeof render>> | null = null;

async function open(forgiveMisses: boolean) {
  let closed = 0;
  view = await render(
    <Sheet open onClose={() => closed++} title="Sources" forgiveMisses={forgiveMisses}>
      <p>list</p>
    </Sheet>,
  );
  const sheet = document.querySelector<HTMLElement>(".sheet")!;
  sheet.getBoundingClientRect = () => ({ left: 1000, right: 1400, top: 0, bottom: 900, x: 1000, y: 0, width: 400, height: 900, toJSON: () => ({}) }) as DOMRect;
  const scrim = document.querySelector<HTMLElement>(".sheet-scrim")!;
  const click = async (x: number, pointerType = "mouse") => {
    await act(async () => void scrim.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType, clientX: x, clientY: 300 })));
    await act(async () => void scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: 300 })));
  };
  return { click, closed: () => closed };
}

afterEach(async () => {
  await view?.unmount();
  view = null;
  document.body.innerHTML = "";
});

test("a click 50 px left of the source list leaves it open; clearly away from it closes it", async () => {
  const s = await open(true);
  await s.click(950);
  expect(s.closed()).toBe(0);
  await s.click(400);
  expect(s.closed()).toBe(1);
});

test("a finger gets a wider margin than a mouse", async () => {
  const s = await open(true);
  await s.click(920, "touch");
  expect(s.closed()).toBe(0);
  await s.click(920);
  expect(s.closed()).toBe(1);
});

test("other sheets still close on any click on the dim", async () => {
  const s = await open(false);
  await s.click(990);
  expect(s.closed()).toBe(1);
});
