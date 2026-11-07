import { describe, expect, test } from "bun:test";
import { leaveApp, setImmersive } from "../src/lib/platform/back";

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

test("the player asks Android for immersive mode and gives the bars back (#178)", () => {
  const calls: boolean[] = [];
  setImmersive(true, { polarDevice: { immersive: (on) => calls.push(on) } });
  setImmersive(false, { polarDevice: { immersive: (on) => calls.push(on) } });
  expect(calls).toEqual([true, false]);
  // No bridge (desktop, iOS) or an older shell without the call: nothing happens.
  expect(() => setImmersive(true, {})).not.toThrow();
  expect(() => setImmersive(true, { polarDevice: {} })).not.toThrow();
});

describe("window changes go to the app's own message channel when the shell has one", () => {
  test("leave and immersive are posted as messages, not called on the interface every frame can see", async () => {
    const posted: string[] = [];
    const interfaceCalls: string[] = [];
    const scope = {
      polarActions: { postMessage: (m: string) => void posted.push(m) },
      polarDevice: { leave: () => void interfaceCalls.push("leave"), immersive: () => void interfaceCalls.push("immersive") },
    };
    let quit = 0;
    await leaveApp(scope, async () => void quit++);
    setImmersive(true, scope);
    setImmersive(false, scope);
    expect(posted).toEqual(["leave", "immersive:on", "immersive:off"]);
    expect(interfaceCalls).toEqual([]);
    expect(quit).toBe(0);
  });
});
