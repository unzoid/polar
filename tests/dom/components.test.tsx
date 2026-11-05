import { expect, spyOn, test } from "bun:test";
import { useState } from "react";
import { Button, IconButton } from "../../src/components/ui/Button";
import { ErrorBoundary } from "../../src/components/ui/ErrorBoundary";
import { Switch } from "../../src/components/ui/Switch";
import { byText, click, render } from "./render";

test("Button: variant and size classes, clicks, busy marks it", async () => {
  let clicks = 0;
  const { container, rerender } = await render(
    <Button variant="primary" size="sm" className="detail-play" onClick={() => clicks++}>
      Resume
    </Button>,
  );
  const b = container.querySelector("button")!;
  expect(b.className).toBe("btn btn-primary btn-sm detail-play");
  expect(b.hasAttribute("aria-busy")).toBe(false);
  await click(b);
  expect(clicks).toBe(1);
  await rerender(
    <Button busy disabled>
      Save
    </Button>,
  );
  expect(container.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  expect(container.querySelector("button")!.disabled).toBe(true);
});

test("IconButton: the label is its accessible name; a surface keeps its own class", async () => {
  const { container } = await render(
    <>
      <IconButton label="Close" variant="settings">
        ×
      </IconButton>
      <IconButton label="More">…</IconButton>
    </>,
  );
  const [close, more] = container.querySelectorAll("button");
  expect(close.getAttribute("aria-label")).toBe("Close");
  expect(close.className).toBe("t3s-icon-btn");
  expect(more.className).toBe("btn btn-icon");
});

test("Switch: a checkbox with the switch role that reports the new state", async () => {
  function Box() {
    const [on, setOn] = useState(false);
    return (
      <label>
        Autoplay <Switch checked={on} onChange={setOn} />
      </label>
    );
  }
  const { container } = await render(<Box />);
  const input = container.querySelector("input")!;
  expect(input.getAttribute("role")).toBe("switch");
  expect(input.checked).toBe(false);
  await click(input);
  expect(input.checked).toBe(true);
  await click(container.querySelector("label"));
  expect(input.checked).toBe(false);
});

function Broken(): never {
  throw new Error("bad data from a source");
}

test("ErrorBoundary: a render error shows the note and the way out instead of a blank window", async () => {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  let retried = 0;
  const { container } = await render(
    <main>
      <p>Navbar</p>
      <ErrorBoundary where="page detail" action={{ label: "Try again", onClick: () => retried++ }}>
        <Broken />
      </ErrorBoundary>
    </main>,
  );
  expect(container.textContent).toContain("Navbar");
  expect(container.textContent).toContain("Something went wrong here.");
  await click(byText(container, "button", "Try again"));
  expect(retried).toBe(1);
  expect(quiet.mock.calls.some((c) => String(c[0]).includes("[page detail] render failed"))).toBe(true);
  quiet.mockRestore();
});

test("ErrorBoundary: children render as they are while nothing fails; TV gets its own note", async () => {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  const { container } = await render(
    <>
      <ErrorBoundary where="app">
        <p>Home</p>
      </ErrorBoundary>
      <ErrorBoundary where="tv" variant="tv">
        <Broken />
      </ErrorBoundary>
    </>,
  );
  expect(container.querySelector("p")!.textContent).toBe("Home");
  expect(container.querySelector(".tv-empty")).not.toBeNull();
  expect(byText(container, "button", "Reload")).toBeTruthy();
  quiet.mockRestore();
});

test("Img: a picture that fails moves on to the next; none left, it's gone (test report 1, items 10 and 31)", async () => {
  const { act } = await import("react");
  const { Img } = await import("../../src/components/Img");
  const { TitleHeading } = await import("../../src/components/title/TitleHeading");
  const fail = (img: Element | null) => act(async () => void img!.dispatchEvent(new Event("error")));
  let failed = 0;
  const { container } = await render(<Img src="https://x.test/still.jpg" fallbacks={["https://x.test/backdrop.jpg"]} alt="" onFail={() => failed++} />);
  expect(container.querySelector("img")!.getAttribute("src")).toBe("https://x.test/still.jpg");
  await fail(container.querySelector("img"));
  expect(container.querySelector("img")!.getAttribute("src")).toBe("https://x.test/backdrop.jpg");
  await fail(container.querySelector("img"));
  expect(container.querySelector("img")).toBeNull();
  expect(failed).toBe(1);

  // A logo that 404s leaves the name as the heading.
  const page = await render(<TitleHeading name="Iron Wheel Race" logo="https://x.test/logo.png" look="detail" />);
  expect(page.container.querySelector("h1")).toBeNull();
  await fail(page.container.querySelector("img"));
  expect(page.container.querySelector("h1")!.textContent).toBe("Iron Wheel Race");
});
