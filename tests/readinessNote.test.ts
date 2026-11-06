import { expect, test } from "bun:test";

// readiness.ts reaches the app's stored preferences through the API module.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { readinessNote } = await import("../src/lib/playback/readiness");

test("each readiness reads as a short note and a longer one", () => {
  expect(readinessNote({ state: "ready", ms: 400 })?.short).toBe("Ready · starts in 0.4 s");
  expect(readinessNote({ state: "notReady", reason: "The link answered 404" })).toEqual({ short: "The link answered 404", long: "The link answered 404" });
  // Slow isn't a failure: a server can take seconds to open a file and still play.
  expect(readinessNote({ state: "slow", ms: 3004 })).toEqual({
    short: "Slow to answer",
    long: "No answer within 3 s. Some servers take a while to open a file: this one may still play.",
  });
  expect(readinessNote({ state: "unchecked" })).toBeUndefined();
});
