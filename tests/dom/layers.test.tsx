import { expect, test } from "bun:test";
import { act, useState } from "react";
import { Sheet } from "../../src/components/Sheet";
import { dismissDepth, useDismiss } from "../../src/lib/ui/dismiss";
import { byText, click, press, render } from "./render";

function Layer({ name, closed, children }: { name: string; closed: string[]; children?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  useDismiss(open, () => {
    closed.push(name);
    setOpen(false);
  });
  return open ? <section data-name={name}>{children}</section> : null;
}

// Siblings: the later one opens later (a child's effect would run before its parent's).
test("Escape on the page closes the top layer only, then the next; with none open it goes on to the app", async () => {
  const closed: string[] = [];
  let reachedApp = 0;
  const app = (e: KeyboardEvent) => e.key === "Escape" && reachedApp++;
  window.addEventListener("keydown", app);
  const { unmount } = await render(
    <>
      <Layer name="sheet" closed={closed} />
      <Layer name="menu" closed={closed} />
    </>,
  );
  expect(dismissDepth()).toBe(2);
  await press("Escape", document.body);
  expect(closed).toEqual(["menu"]);
  expect(reachedApp).toBe(0);
  await press("Escape", document.body);
  expect(closed).toEqual(["menu", "sheet"]);
  expect(dismissDepth()).toBe(0);
  await press("Escape", document.body);
  expect(reachedApp).toBe(1);
  window.removeEventListener("keydown", app);
  await unmount();
});

test("a focused field that handles Escape itself keeps the layers open", async () => {
  const closed: string[] = [];
  const { container, unmount } = await render(
    <Layer name="search" closed={closed}>
      <input onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} />
    </Layer>,
  );
  const input = container.querySelector("input")!;
  input.focus();
  await press("Escape", input);
  expect(closed).toEqual([]);
  await press("Escape", document.body);
  expect(closed).toEqual(["search"]);
  await unmount();
});

function SheetHost({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          onClosed();
        }}
        title="Sources"
        subtitle="Pick one"
      >
        <button>First</button>
        <button>Last</button>
      </Sheet>
    </>
  );
}

test("Sheet: opens as a modal dialog with focus inside, Escape closes it and focus goes back to the opener", async () => {
  let closes = 0;
  const { container, unmount } = await render(<SheetHost onClosed={() => closes++} />);
  const opener = byText(container, "button", "Open");
  opener.focus();
  await click(opener);
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  expect(dialog).not.toBeNull();
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.querySelector("h2")!.textContent).toBe("Sources");
  expect(dialog.contains(document.activeElement)).toBe(true);
  await press("Escape");
  expect(closes).toBe(1);
  // motion keeps the panel for its exit animation; focus is back on the opener at once.
  expect(document.activeElement).toBe(opener);
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  await unmount();
});

test("Sheet: a click on the scrim closes it", async () => {
  let closes = 0;
  const { container, unmount } = await render(<SheetHost onClosed={() => closes++} />);
  await click(byText(container, "button", "Open"));
  await click(document.querySelector(".sheet-scrim"));
  expect(closes).toBe(1);
  await unmount();
});
