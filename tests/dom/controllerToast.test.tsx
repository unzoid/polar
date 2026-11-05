import { afterEach, expect, jest, test } from "bun:test";
import { act } from "react";
import { TOAST_OUT_MS } from "../../src/components/ui/Toast";
import { installGamepad } from "../../src/tv/gamepad";
import { ControllerToast } from "../../src/tv/TvChrome";
import { render } from "./render";

// A controller the Gamepad API reports, plugged in or out by the tests.
let pads: Partial<Gamepad>[] = [];
Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => pads });
const pad = { id: "Example Pad (STANDARD GAMEPAD)", connected: true, buttons: [], axes: [] } as unknown as Gamepad;

const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
/** Plugs the controller in or out and lets the poll notice it. */
async function plug(on: boolean) {
  pads = on ? [pad] : [];
  await act(async () => void window.dispatchEvent(new Event(on ? "gamepadconnected" : "gamepaddisconnected")));
  await tick(50);
}

afterEach(async () => {
  await plug(false);
  await tick(10_000);
  jest.useRealTimers();
});

test("in TV mode the controller toast stays up briefly, then fades out instead of vanishing (#41)", async () => {
  jest.useFakeTimers();
  installGamepad();
  const { container, unmount } = await render(<ControllerToast tv />);
  await plug(true);
  const toast = container.querySelector(".toast-tv");
  expect(toast?.textContent).toContain("Example Pad connected");
  expect(toast!.hasAttribute("data-leaving")).toBe(false);
  await tick(3000);
  const leaving = container.querySelector(".toast-tv");
  expect(leaving?.hasAttribute("data-leaving")).toBe(true);
  expect(leaving?.textContent).toContain("Example Pad connected");
  await tick(TOAST_OUT_MS);
  expect(container.querySelector(".toast")).toBeNull();
  await unmount();
});

test("a controller coming back while the toast leaves shows it again at once (#41)", async () => {
  jest.useFakeTimers();
  installGamepad();
  const { container, unmount } = await render(<ControllerToast tv />);
  await plug(true);
  await plug(false);
  await tick(3000);
  expect(container.querySelector(".toast")?.hasAttribute("data-leaving")).toBe(true);
  await plug(true);
  const toast = container.querySelector(".toast");
  expect(toast?.hasAttribute("data-leaving")).toBe(false);
  expect(toast?.textContent).toContain("connected");
  await unmount();
});
