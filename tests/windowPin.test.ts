import { expect, test } from "bun:test";
import { createWindowPin, type PinWindow } from "../src/components/player/windowPin";

// #266: the window calls faked, what they leave the window as checked.

function fakeWindow(fail?: "setLocked") {
  const state = { onTop: false, locked: false, fullscreen: false };
  const calls: string[] = [];
  const w: PinWindow = {
    setAlwaysOnTop: async (on) => void (calls.push(`onTop ${on}`), (state.onTop = on)),
    setLocked: async (locked) => {
      calls.push(`locked ${locked}`);
      if (fail === "setLocked" && locked) throw new Error("refused");
      state.locked = locked;
    },
    isFullscreen: async () => state.fullscreen,
    setFullscreen: async (on) => void (calls.push(`fullscreen ${on}`), (state.fullscreen = on)),
  };
  return { w, state, calls };
}

test("pinning keeps the window on top and locked; unpinning puts both back", async () => {
  const { w, state } = fakeWindow();
  const seen: boolean[] = [];
  const pin = createWindowPin(w, (p) => seen.push(p));
  await pin.pin();
  expect(state).toEqual({ onTop: true, locked: true, fullscreen: false });
  expect(pin.pinned).toBe(true);
  await pin.toggle();
  expect(state).toEqual({ onTop: false, locked: false, fullscreen: false });
  expect(seen).toEqual([true, false]);
});

test("asking for what it already is does nothing", async () => {
  const { w, calls } = fakeWindow();
  const pin = createWindowPin(w, () => {});
  await pin.unpin();
  await pin.pin();
  await pin.pin();
  expect(calls).toEqual(["onTop true", "locked true"]);
});

test("quick presses land in order: pin then unpin leaves it unpinned", async () => {
  const { w, state } = fakeWindow();
  const pin = createWindowPin(w, () => {});
  void pin.toggle();
  await pin.toggle();
  expect(state).toEqual({ onTop: false, locked: false, fullscreen: false });
});

test("going fullscreen unpins first; pinning a fullscreen window leaves fullscreen", async () => {
  const { w, state, calls } = fakeWindow();
  const pin = createWindowPin(w, () => {});
  await pin.pin();
  await pin.setFullscreen(true);
  expect(state).toEqual({ onTop: false, locked: false, fullscreen: true });
  expect(calls.slice(-3)).toEqual(["onTop false", "locked false", "fullscreen true"]);
  await pin.pin();
  expect(state).toEqual({ onTop: true, locked: true, fullscreen: false });
});

test("leaving the player (an unpin) always puts the window back", async () => {
  const { w, state } = fakeWindow();
  const pin = createWindowPin(w, () => {});
  await pin.pin();
  await pin.unpin();
  expect(state.onTop || state.locked).toBe(false);
});

test("a refused call never leaves the window half pinned", async () => {
  const { w, state } = fakeWindow("setLocked");
  const seen: boolean[] = [];
  const pin = createWindowPin(w, (p) => seen.push(p));
  await pin.pin();
  expect(pin.pinned).toBe(false);
  expect(state.onTop).toBe(false);
  expect(seen).toEqual([false]);
});
