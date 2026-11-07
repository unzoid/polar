/**
 * The player's Pin window (#266): the desktop window stays on top of every other window and is
 * locked in place (no resizing, minimise and maximise off) until it's unpinned, the player is
 * left or it goes fullscreen. Never remembered: each player starts unpinned. Plain code with the
 * window calls passed in, so tests/windowPin.test.ts drives it with fakes.
 */

export interface PinWindow {
  setAlwaysOnTop(on: boolean): Promise<void>;
  setLocked(locked: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(on: boolean): Promise<void>;
}

export function createWindowPin(w: PinWindow, onChange: (pinned: boolean) => void) {
  let pinned = false;
  // One change at a time, in the order asked: a quick pin-unpin never leaves the window half done.
  let queue = Promise.resolve();
  const set = (next: () => boolean) =>
    (queue = queue.then(async () => {
      const on = next();
      if (on === pinned) return;
      try {
        // Pinning a fullscreen window: out of fullscreen first, a window can't be both.
        if (on && (await w.isFullscreen())) await w.setFullscreen(false);
        await w.setAlwaysOnTop(on);
        await w.setLocked(on);
        pinned = on;
      } catch {
        // Half pinned is worse than not pinned: put the window back as it was.
        await Promise.allSettled([w.setAlwaysOnTop(false), w.setLocked(false)]);
        pinned = false;
      }
      onChange(pinned);
    }));
  return {
    get pinned() {
      return pinned;
    },
    pin: () => set(() => true),
    unpin: () => set(() => false),
    toggle: () => set(() => !pinned),
    /** Fullscreen unpins first. */
    setFullscreen: async (on: boolean) => {
      if (on) await set(() => false);
      await w.setFullscreen(on);
    },
  };
}

export type WindowPin = ReturnType<typeof createWindowPin>;
