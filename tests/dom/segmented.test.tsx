import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { Segmented } from "../../src/components/Segmented";
import { render } from "./render";

/**
 * happy-dom has no layout: a stand-in where every segment is 100px wide and the highlight is inset 3px, and
 * anything inside a `hidden` element measures 0, as in a browser. ResizeObserver callbacks run when a test
 * says the size changed.
 */
const observers = new Set<() => void>();
const props = ["offsetLeft", "offsetWidth", "clientWidth"] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

function measure(el: HTMLElement, prop: (typeof props)[number]): number {
  if (el.closest("[hidden]")) return 0;
  if (el.classList.contains("segmented-active")) return prop === "offsetLeft" ? 3 : 200;
  const root = el.closest(".segmented");
  if (el.parentElement === root && el.matches("button")) {
    const i = [...root!.querySelectorAll(":scope > button")].indexOf(el);
    return prop === "offsetLeft" ? 3 + i * 100 : 100;
  }
  return 0;
}

beforeEach(() => {
  for (const prop of props) {
    saved.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return measure(this, prop);
      },
    });
  }
  saved.set("ResizeObserver", Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"));
  globalThis.ResizeObserver = class {
    constructor(private cb: () => void) {}
    observe() {
      observers.add(this.cb);
    }
    unobserve() {}
    disconnect() {
      observers.delete(this.cb);
    }
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  for (const [key, d] of saved) {
    const target = key === "ResizeObserver" ? globalThis : HTMLElement.prototype;
    if (d) Object.defineProperty(target, key, d);
    else delete (target as Record<string, unknown>)[key];
  }
  observers.clear();
  document.body.innerHTML = "";
});

const voices = [
  { id: "ja", label: "Japanese" },
  { id: "en", label: "English" },
];

function Section({ open, value = "ja" }: { open: boolean; value?: string }) {
  return (
    <div hidden={!open}>
      <Segmented label="Voices" value={value} onChange={() => {}} options={voices} />
    </div>
  );
}

const highlight = (c: HTMLElement) => c.querySelector<HTMLElement>(".segmented-active")!;

test("Segmented: the highlight covers only the selected option once a hidden start is shown", async () => {
  const { container, rerender } = await render(<Section open={false} />);
  await rerender(<Section open />);
  await act(async () => observers.forEach((cb) => cb()));
  expect(highlight(container).style.clipPath).toBe("inset(0 100px 0 0px round 999px)");
  // Placed where it belongs, not glided there from covering both.
  expect(highlight(container).dataset.instant).toBe("true");

  await rerender(<Section open value="en" />);
  expect(highlight(container).style.clipPath).toBe("inset(0 0px 0 100px round 999px)");
  expect(highlight(container).dataset.instant).toBe("false");
});

test("Segmented: a change made while hidden is placed when shown", async () => {
  const { container, rerender } = await render(<Section open={false} />);
  await rerender(<Section open={false} value="en" />);
  await rerender(<Section open value="en" />);
  await act(async () => observers.forEach((cb) => cb()));
  expect(highlight(container).style.clipPath).toBe("inset(0 0px 0 100px round 999px)");
  expect(highlight(container).dataset.instant).toBe("true");
});

test("Segmented: shown from the start, placed at once", async () => {
  const { container } = await render(<Section open />);
  expect(highlight(container).style.clipPath).toBe("inset(0 100px 0 0px round 999px)");
  expect(highlight(container).dataset.instant).toBe("true");
});
