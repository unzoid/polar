import { afterAll, afterEach } from "bun:test";
import { GlobalWindow } from "happy-dom";

/**
 * A DOM for the component tests in tests/dom (docs/plan-tests.md §3, happy-dom). Preloaded by their own
 * run (`bun test --preload ./tests/dom/setup.ts tests/dom`, see package.json), so it is in place before
 * React loads; the other tests run in a separate process without a DOM.
 *
 * Puts happy-dom's `window`, `document`, events and DOM classes on the global object. The runtime keeps
 * its console, timers, fetch and URL.
 */
const win = new GlobalWindow({ url: "http://localhost/", width: 1280, height: 800 });

const KEEP = new Set([
  "constructor",
  "undefined",
  "NaN",
  "Infinity",
  "global",
  "globalThis",
  "console",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "URL",
  "URLSearchParams",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "crypto",
  "performance",
  "TextEncoder",
  "TextDecoder",
]);

const own = (o: object, key: string) => Object.getOwnPropertyDescriptor(o, key);

/** The window's properties, its own and its classes' (GlobalWindow, Window, BrowserWindow…), nearest first. */
function descriptors() {
  const all = new Map<string, PropertyDescriptor>();
  for (let o: object | null = win; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) if (!all.has(key)) all.set(key, own(o, key)!);
  }
  return all;
}

for (const [key, desc] of descriptors()) {
  if (KEEP.has(key)) continue;
  if (desc.value !== undefined && desc.value === (globalThis as Record<string, unknown>)[key]) continue;
  if (typeof desc.value === "function" && !/^[A-Z]/.test(key)) desc.value = desc.value.bind(win);
  if (desc.get) {
    const get = desc.get;
    desc.get = () => get.call(win);
  }
  if (desc.set) {
    const set = desc.set;
    desc.set = (v) => set.call(win, v);
  }
  Object.defineProperty(globalThis, key, { ...desc, configurable: true });
}
for (const key of ["window", "self"]) Object.defineProperty(globalThis, key, { value: win, configurable: true, writable: true });

// React reads this to know the tests wrap updates in `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// motion animates through Web Animations when an element has `animate`; happy-dom's rejects a cancelled
// animation's promise where nothing catches it. Without it motion steps its own animations.
delete (win.Element.prototype as Partial<Element>).animate;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

// Nothing happy-dom still has queued (timers, fetches) outlives the run.
afterAll(async () => {
  await win.happyDOM.abort();
  win.close();
});
