import { expect, test } from "bun:test";
import { act } from "react";
import { usePageFocus } from "../../src/lib/ui/pageFocus";
import { render } from "./render";

function Pages({ stack }: { stack: string[] }) {
  const top = stack.at(-1)!;
  usePageFocus(top);
  return (
    <>
      {stack.map((key) => (
        <section key={key} className="page" data-page-key={key} inert={key !== top}>
          <button>{`${key} card`}</button>
          <button>{`${key} other`}</button>
        </section>
      ))}
    </>
  );
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

test("a page going inactive gives focus to the new page, and gets it back on return (re-test 25)", async () => {
  const { rerender, unmount, container } = await render(<Pages stack={["home"]} />);
  await act(async () => button("home other").focus());
  await rerender(<Pages stack={["home", "title"]} />);
  // Never left on something hidden: focus is in the page now on top.
  expect(container.querySelector('[data-page-key="title"]')!.contains(document.activeElement)).toBe(true);
  // Pages are hidden by inert alone; aria-hidden over a focused card is what the console warned about.
  expect(container.querySelector('[data-page-key="home"]')!.hasAttribute("aria-hidden")).toBe(false);
  await rerender(<Pages stack={["home"]} />);
  expect(document.activeElement).toBe(button("home other"));
  await unmount();
});
