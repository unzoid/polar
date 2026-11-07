// Frame-by-frame stepping (#243): keys, coalescing, the frame rate, and a step in a watch party.
import { describe, expect, test } from "bun:test";
import "./storageStub";
import { actionFor, DEFAULT_BINDINGS } from "../src/lib/settings/keybinds";
import { createFrameStepper, FRAME_STEP_EVENT, fpsFromIntervals, frameAt, stepFrame, type StepDirection } from "../src/components/player/frameStep";
import type { MediaLike } from "../src/components/player/mpvMedia";
import { partyOfTwo } from "./partySim";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe("keys", () => {
  test(", steps back and . steps forward in the player, as in mpv", () => {
    expect(DEFAULT_BINDINGS.frameBack).toEqual([","]);
    expect(DEFAULT_BINDINGS.frameForward).toEqual(["."]);
    expect(actionFor(key(","), "player")).toBe("frameBack");
    expect(actionFor(key("."), "player")).toBe("frameForward");
    // Held: the key's auto-repeat presses are the same action again.
    expect(actionFor(key(".", { repeat: true }), "player")).toBe("frameForward");
    // Not while browsing, and not with a modifier.
    expect(actionFor(key(","), "app")).toBeNull();
    expect(actionFor(key(".", { ctrlKey: true }), "player")).toBeNull();
  });
});

describe("coalescing", () => {
  /** A step that takes until the test lets it land. */
  function slowSteps() {
    const ran: StepDirection[] = [];
    const landings: (() => void)[] = [];
    const stepper = createFrameStepper((d) => {
      ran.push(d);
      return new Promise<void>((r) => landings.push(r));
    });
    const land = async () => {
      landings.shift()?.();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    return { stepper, ran, land };
  }

  test("presses while a step is under way become at most one more step, not a queue", async () => {
    const { stepper, ran, land } = slowSteps();
    // A held key: thirty presses while the first (slow) step back decodes.
    for (let i = 0; i < 30; i++) stepper.step(-1);
    expect(ran).toEqual([-1]);
    expect(stepper.busy).toBe(true);
    await land();
    expect(ran).toEqual([-1, -1]);
    await land();
    // Let go: nothing more was queued.
    expect(ran).toEqual([-1, -1]);
    expect(stepper.busy).toBe(false);
  });

  test("the latest direction wins, and a step that fails doesn't stop the next", async () => {
    let calls = 0;
    const ran: StepDirection[] = [];
    const stepper = createFrameStepper(async (d) => {
      ran.push(d);
      if (calls++ === 0) throw new Error("mpv isn't running");
    });
    stepper.step(1);
    stepper.step(-1);
    stepper.step(1);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(ran).toEqual([1, 1]);
    expect(stepper.busy).toBe(false);
  });
});

describe("frames", () => {
  test("the frame number counts from 0 and survives rounding either side of a frame's start", () => {
    expect(frameAt(0, 24)).toBe(0);
    expect(frameAt(1, 24)).toBe(24);
    expect(frameAt(1001 / 24000 - 1e-9, 23.976)).toBe(1);
    expect(frameAt(2.5 / 25, 25)).toBe(2);
  });

  test("the frame rate comes from the gaps between frames, dropped frames and jitter aside", () => {
    const film = Array.from({ length: 16 }, (_, i) => (i % 5 === 4 ? 2 : 1) * (1001 / 24000) + (i % 2 ? 0.0004 : -0.0004));
    expect(fpsFromIntervals(film)).toBe(23.976);
    expect(fpsFromIntervals(Array(12).fill(0.04))).toBe(25);
    expect(fpsFromIntervals(Array(12).fill(1 / 41))).toBe(41);
    expect(fpsFromIntervals([0.04, 0.04])).toBeNull();
  });

  test("players without mpv seek to the middle of the next or previous frame, paused", async () => {
    const media = new (class extends EventTarget {
      paused = false;
      duration = 60;
      private t = 10;
      get currentTime() {
        return this.t;
      }
      set currentTime(v: number) {
        this.t = v;
        queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
      }
      pause() {
        this.paused = true;
      }
    })() as unknown as MediaLike;
    let stepped = 0;
    media.addEventListener(FRAME_STEP_EVENT, () => stepped++);
    await stepFrame(media, 1, 25);
    expect(media.paused).toBe(true);
    expect(media.currentTime).toBeCloseTo(251.5 / 25, 6);
    await stepFrame(media, -1, 25);
    await stepFrame(media, -1, 25);
    expect(frameAt(media.currentTime, 25)).toBe(249);
    expect(stepped).toBe(3);
  });
});

describe("watch party", () => {
  test("a frame step is a paused seek: the other member lands on the same frame", () => {
    const { sim, b, ma, mb } = partyOfTwo({}, { pauseFirst: true });
    sim.run(5000);
    expect(ma.paused && mb.paused).toBe(true);
    const fps = 24;
    for (const direction of [1, 1, 1, -1] as const) {
      // What stepFrame does with an engine: a seek of one frame, then the step event.
      mb.currentTime = (frameAt(mb.currentTime, fps) + direction + 0.5) / fps;
      mb.dispatchEvent(new Event(FRAME_STEP_EVENT));
      sim.run(400);
    }
    sim.run(3000);
    expect(ma.paused && mb.paused).toBe(true);
    expect(b.room.getParty()!.playback!.paused).toBe(true);
    expect(frameAt(ma.currentTime, fps)).toBe(frameAt(mb.currentTime, fps));
    expect(Math.abs(ma.currentTime - mb.currentTime)).toBeLessThan(0.005);
  });
});
