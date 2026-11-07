// The app's side of signing in on a TV (src/lib/account/tvSignIn.ts, #133): reading a typed code,
// what a device calls itself, and waiting for the answer.
import { describe, expect, test } from "bun:test";
import { deviceLabel, formatTvCode, isTvCode, TV_POLL_MS, waitForApproval, type TvClaim } from "../src/lib/account/tvSignIn";

describe("codes", () => {
  test("typed any way, read the same; shown in two groups of four", () => {
    expect(formatTvCode("hjkm")).toBe("HJKM");
    expect(formatTvCode("hjkmn")).toBe("HJKM-N");
    expect(formatTvCode(" hjkm-npqr ")).toBe("HJKM-NPQR");
    expect(formatTvCode("HJKMNPQRSTUV")).toBe("HJKM-NPQR");
    expect(isTvCode("hjkm npqr")).toBe(true);
    // Letters the server never uses, and the wrong length.
    expect(isTvCode("HJKM-NPQ0")).toBe(false);
    expect(isTvCode("HJKM-NPQ")).toBe(false);
    expect(isTvCode("HJKM-NPQRS")).toBe(false);
  });
});

describe("device labels", () => {
  test("the kind of device, never anything personal", () => {
    expect(deviceLabel("android", "desktop", true)).toBe("Android TV");
    expect(deviceLabel("ios", "phone", false)).toBe("iPhone");
    expect(deviceLabel("android", "tablet", false)).toBe("Android tablet");
    expect(deviceLabel("windows", "desktop", false)).toBe("Windows PC");
    expect(deviceLabel("macos", "desktop", false)).toBe("Mac");
  });
});

describe("waitForApproval", () => {
  /** A clock that moves only when the wait sleeps. */
  function clock() {
    let t = 1_000_000;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  }
  const request = (expiresAt: number) => ({ code: "HJKMNPQR", poll: "POLL", expiresAt });

  test("asks until approved, then signs in with the token", async () => {
    const c = clock();
    const answers: (TvClaim | Error)[] = [{ state: "pending" }, new Error("offline"), { state: "approved", tokenHash: "TOKEN" }];
    const asked: string[] = [];
    let token = "";
    const end = await waitForApproval(request(c.now() + 300_000), {
      ...c,
      signal: new AbortController().signal,
      claim: async (poll) => {
        asked.push(poll);
        const a = answers.shift()!;
        if (a instanceof Error) throw a;
        return a;
      },
      onApproved: async (t) => void (token = t),
    });
    expect(end).toBe("approved");
    expect(token).toBe("TOKEN");
    expect(asked).toEqual(["POLL", "POLL", "POLL"]);
  });

  test("denied and expired end the wait without signing in", async () => {
    for (const state of ["denied", "expired"] as const) {
      const c = clock();
      let signedIn = false;
      const end = await waitForApproval(request(c.now() + 300_000), {
        ...c,
        signal: new AbortController().signal,
        claim: async () => ({ state }),
        onApproved: async () => void (signedIn = true),
      });
      expect(end).toBe(state);
      expect(signedIn).toBe(false);
    }
  });

  test("a server that never answers: the wait ends a little after the expiry", async () => {
    const c = clock();
    const start = c.now();
    const end = await waitForApproval(request(start + 300_000), {
      ...c,
      signal: new AbortController().signal,
      claim: async () => Promise.reject(new Error("offline")),
      onApproved: async () => {},
    });
    expect(end).toBe("expired");
    expect(c.now() - start).toBeLessThanOrEqual(300_000 + 3 * TV_POLL_MS);
  });

  test("stopped (the user went back): no more asking", async () => {
    const c = clock();
    const stop = new AbortController();
    let asked = 0;
    const end = await waitForApproval(request(c.now() + 300_000), {
      ...c,
      signal: stop.signal,
      claim: async () => {
        if (++asked === 2) stop.abort();
        return { state: "pending" };
      },
      onApproved: async () => {},
    });
    expect(end).toBe("stopped");
    expect(asked).toBe(2);
  });
});
