import { describe, expect, test } from "bun:test";
import { BUSY_AFTER, concurrency, Limiter, limitedFetch, PRIORITY, retryAfter, type Clock, type HostLimits } from "../src/lib/net/limiter";

/** Virtual time: sleeping moves the clock on at once. */
function fakeClock(): Clock & { t: number; slept: number[] } {
  const c = {
    t: 0,
    slept: [] as number[],
    now: () => c.t,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw signal.reason;
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

const limits: HostLimits = { burst: 3, perMinute: 60, retries: 1, defaultWait: 10_000, maxWait: 30_000 };

const answer = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });

describe("Limiter", () => {
  test("lets the burst go at once, then one a second at 60 a minute", async () => {
    const clock = fakeClock();
    const l = new Limiter(limits, clock);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      await l.take();
      times.push(clock.t);
    }
    expect(times).toEqual([0, 0, 0, 1000, 2000]);
  });

  test("a pause holds everyone, and the burst starts empty after it", async () => {
    const clock = fakeClock();
    const l = new Limiter(limits, clock);
    l.pause(5000);
    await l.take();
    expect(clock.t).toBe(6000);
  });

  test("the host's own limit keeps any minute under it", async () => {
    const clock = fakeClock();
    const l = new Limiter({ ...limits, burst: 10 }, clock);
    l.setLimit(30);
    let n = 0;
    while (clock.t < 60_000) {
      await l.take();
      if (clock.t < 60_000) n++;
    }
    expect(n).toBeLessThanOrEqual(30);
  });

  test("an aborted wait stops", async () => {
    const l = new Limiter(limits, fakeClock());
    const ac = new AbortController();
    ac.abort(new Error("gone"));
    await expect(l.take(ac.signal)).rejects.toThrow("gone");
  });
});

describe("retryAfter", () => {
  test("seconds, dates, nonsense", () => {
    expect(retryAfter("7", 0)).toBe(7000);
    expect(retryAfter(null, 0)).toBeNull();
    expect(retryAfter("soon", 0)).toBeNull();
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(retryAfter("Thu, 05 Nov 2026 12:00:20 GMT", now)).toBe(20_000);
    expect(retryAfter("Thu, 05 Nov 2026 11:00:00 GMT", now)).toBe(0);
  });
});

describe("limitedFetch", () => {
  test("waits out a 429's Retry-After once, then answers", async () => {
    const clock = fakeClock();
    const l = new Limiter(limits, clock);
    const replies = [answer(429, { "Retry-After": "4" }), answer(200)];
    const res = await limitedFetch(l, "https://x", {}, { clock, fetch: (async () => replies.shift()!) as unknown as typeof fetch });
    expect(res.status).toBe(200);
    expect(clock.t).toBeGreaterThanOrEqual(4000);
  });

  test("gives the 429 back after the retries, and caps the wait", async () => {
    const clock = fakeClock();
    const l = new Limiter(limits, clock);
    let calls = 0;
    const res = await limitedFetch(
      l,
      "https://x",
      {},
      {
        clock,
        fetch: (async () => {
          calls++;
          return answer(429, { "Retry-After": "3600" });
        }) as unknown as typeof fetch,
      },
    );
    expect(res.status).toBe(429);
    expect(calls).toBe(2);
    expect(clock.t).toBeLessThanOrEqual(31_000);
  });

  test("reads the host's limit from its answers", async () => {
    const clock = fakeClock();
    const l = new Limiter({ ...limits, burst: 1 }, clock);
    const f = (async () => answer(200, { "X-RateLimit-Limit": "121" })) as unknown as typeof fetch;
    await limitedFetch(l, "https://x", {}, { clock, fetch: f });
    await limitedFetch(l, "https://x", {}, { clock, fetch: f });
    // 120 a minute after the burst of 1: half a second apart.
    expect(clock.t).toBe(500);
  });
});

describe("concurrency", () => {
  test("runs at most `limit` at once, in order, and passes results and errors through", async () => {
    const run = concurrency(2);
    let now = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (i: number) => async () => {
      started.push(i);
      peak = Math.max(peak, ++now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      if (i === 3) throw new Error("three");
      return i * 10;
    };
    const results = await Promise.allSettled([0, 1, 2, 3, 4].map((i) => run(task(i))));
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "err"))).toEqual([0, 10, 20, "err", 40]);
  });
});

describe("Limiter priorities (#109)", () => {
  test("once the burst is spent, the most urgent waiter goes next, whatever its arrival", async () => {
    const clock = fakeClock();
    const l = new Limiter({ ...limits, burst: 1 }, clock);
    await l.take();
    const order: string[] = [];
    const go = (name: string, p: number) => l.take(undefined, p).then(() => order.push(name));
    await Promise.all([go("background", PRIORITY.background), go("near", PRIORITY.near), go("page", PRIORITY.page), go("visible", PRIORITY.visible)]);
    expect(order).toEqual(["page", "visible", "near", "background"]);
  });

  test("a waiter's priority is read when its turn comes, so a row scrolled into view moves up", async () => {
    const clock = fakeClock();
    const l = new Limiter({ ...limits, burst: 1 }, clock);
    await l.take();
    let row: number = PRIORITY.background;
    const order: string[] = [];
    const a = l.take(undefined, PRIORITY.near).then(() => order.push("other"));
    const b = l.take(undefined, () => row).then(() => order.push("row"));
    row = PRIORITY.visible;
    await Promise.all([a, b]);
    expect(order).toEqual(["row", "other"]);
  });

  test("while the host is degraded, background work waits until nothing else has asked for a while", async () => {
    const clock = fakeClock();
    const l = new Limiter({ ...limits, burst: 2, perMinute: 60 }, clock);
    l.setLimit(30);
    expect(l.reduced).toBe(true);
    await l.take();
    await l.take();
    const order: string[] = [];
    const bg = l.take(undefined, PRIORITY.background).then(() => order.push(`background@${clock.t}`));
    const fg = l.take(undefined, PRIORITY.visible).then(() => order.push(`visible@${clock.t}`));
    await Promise.all([bg, fg]);
    // 28 a minute after the burst of 2: a token every ~2.1 s. The visible row takes the first one; background
    // waits for a full bucket (~6.4 s) instead of the next token (~4.3 s).
    expect(order[0].startsWith("visible@")).toBe(true);
    expect(Number(order[1].split("@")[1])).toBeGreaterThanOrEqual(6000);
    l.setLimit(90);
    expect(l.reduced).toBe(false);
  });

  test("says it's busy while paused, and quiet once nobody waits", async () => {
    const clock = fakeClock();
    const l = new Limiter(limits, clock);
    const seen: boolean[] = [];
    const stop = l.subscribe(() => seen.push(l.busy));
    l.pause(5000);
    expect(l.busy).toBe(true);
    await l.take();
    expect(l.busy).toBe(false);
    expect(seen).toEqual([true, false]);
    stop();
  });

  test("says it's busy once an on-screen request has waited a few seconds", async () => {
    const clock = fakeClock();
    const l = new Limiter({ ...limits, burst: 1, perMinute: 6 }, clock);
    await l.take();
    let busyAt: number | undefined;
    l.subscribe(() => {
      if (l.busy && busyAt === undefined) busyAt = clock.t;
    });
    await l.take(undefined, PRIORITY.visible);
    expect(busyAt).toBe(BUSY_AFTER);
    expect(l.busy).toBe(false);
  });

  test("an aborted waiter leaves the queue and the next one goes", async () => {
    const clock = fakeClock();
    const l = new Limiter({ ...limits, burst: 1 }, clock);
    await l.take();
    const ac = new AbortController();
    const gone = l.take(ac.signal, PRIORITY.page);
    ac.abort(new Error("gone"));
    await expect(gone).rejects.toThrow("gone");
    await l.take(undefined, PRIORITY.background);
    expect(clock.t).toBe(1000);
  });
});
