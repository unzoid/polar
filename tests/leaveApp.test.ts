import { describe, expect, test } from "bun:test";
import { leaveApp } from "../src/lib/platform/back";

describe("leaving the app at the root (Android Back)", () => {
  test("the activity goes to the background through the bridge; the process isn't ended", async () => {
    let left = 0;
    let quit = 0;
    await leaveApp({ polarDevice: { leave: () => void left++ } }, async () => void quit++);
    expect(left).toBe(1);
    expect(quit).toBe(0);
  });

  test("without the bridge (an older app shell), the app quits as before", async () => {
    let quit = 0;
    await leaveApp({}, async () => void quit++);
    await leaveApp({ polarDevice: {} }, async () => void quit++);
    expect(quit).toBe(2);
  });
});
