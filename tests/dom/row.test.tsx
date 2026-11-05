import { expect, test } from "bun:test";
import { act } from "react";
import { Row } from "../../src/components/Row";
import { render } from "./render";

const shelf = (ids: string[]) => (
  <Row title="Continue Watching" shape="landscape" order={ids.join(" ")}>
    {ids.map((id) => (
      <button key={id}>{id}</button>
    ))}
  </Row>
);

/** The shelf as someone left it: clicked into, then scrolled along. */
async function scrolledAlong(ids: string[]) {
  const view = await render(shelf(ids));
  const scroller = view.container.querySelector<HTMLElement>(".row-scroller")!;
  await act(async () => void scroller.dispatchEvent(new Event("pointerdown")));
  scroller.scrollLeft = 600;
  return { ...view, scroller };
}

test("Row: a new order takes the shelf back to its start (#37)", async () => {
  const { scroller, rerender, unmount } = await scrolledAlong(["a", "b", "c", "d"]);
  expect(scroller.scrollLeft).toBe(600);
  await rerender(shelf(["c", "a", "b", "d"]));
  expect(scroller.scrollLeft).toBe(0);
  await unmount();
});

test("Row: the same order keeps where it was scrolled to", async () => {
  const { scroller, rerender, unmount } = await scrolledAlong(["a", "b", "c", "d"]);
  await rerender(shelf(["a", "b", "c", "d"]));
  expect(scroller.scrollLeft).toBe(600);
  await unmount();
});

test("Row: a new order keeps a focused card in view instead", async () => {
  const { container, scroller, rerender, unmount } = await scrolledAlong(["a", "b", "c", "d"]);
  const d = [...container.querySelectorAll("button")].find((b) => b.textContent === "d")!;
  d.focus();
  let shown: Element | undefined;
  d.scrollIntoView = function () {
    shown = this;
  };
  await rerender(shelf(["c", "a", "b", "d"]));
  expect(shown).toBe(d);
  expect(scroller.scrollLeft).toBe(600);
  await unmount();
});
