/**
 * One request budget per keyless public API (AniList, ani.zip), shared by
 * every caller in the app, so a franchise walk, the genre shelves and the
 * schedule pages can't together run past the host's limit (critique M10).
 *
 * A token bucket: `burst` requests go at once, then one every
 * 60 / `perMinute` seconds. A 429 pauses the whole host for its Retry-After
 * (bounded) and is retried a bounded number of times; then the 429 goes back
 * to the caller like any other answer. Waiting stops when the caller's
 * `signal` aborts (React Query aborts a query nobody needs any more).
 */

export interface HostLimits {
  /** Requests that may go at once. */
  burst: number;
  /** Requests a minute after the burst. */
  perMinute: number;
  /** How many times a 429 is retried before it goes back to the caller. */
  retries: number;
  /** Wait after a 429 without a usable Retry-After, in ms. */
  defaultWait: number;
  /** Longest wait after a 429, in ms, whatever Retry-After says. */
  maxWait: number;
}

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const done = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const t = setTimeout(done, ms);
      const abort = () => {
        clearTimeout(t);
        reject(signal!.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
    }),
};

export class Limiter {
  private tokens: number;
  private at: number;
  private pausedUntil = 0;
  private perMs: number;

  constructor(
    readonly limits: HostLimits,
    private readonly clock: Clock = realClock,
  ) {
    this.tokens = limits.burst;
    this.at = clock.now();
    this.perMs = limits.perMinute / 60_000;
  }

  /** Waits until a request may go. */
  async take(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw signal.reason;
      const now = this.clock.now();
      if (now > this.at) {
        this.tokens = Math.min(this.limits.burst, this.tokens + (now - this.at) * this.perMs);
        this.at = now;
      }
      if (now < this.pausedUntil) {
        await this.clock.sleep(this.pausedUntil - now, signal);
      } else if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      } else {
        await this.clock.sleep(Math.ceil((1 - this.tokens) / this.perMs), signal);
      }
    }
  }

  /** Nobody goes for `ms`, and the burst starts empty after it. */
  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
    this.tokens = 0;
    // Refilling starts when the pause ends.
    this.at = this.pausedUntil;
  }

  /**
   * The host told its real limit (AniList's X-RateLimit-Limit: 90, or 30 while
   * it is degraded). The burst comes out of it, so no minute goes over.
   */
  setLimit(perMinute: number) {
    if (!Number.isFinite(perMinute) || perMinute <= 0) return;
    this.perMs = Math.max(1, perMinute - this.limits.burst) / 60_000;
  }
}

/** Retry-After in ms: seconds or an HTTP date; null when absent or unreadable. */
export function retryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const s = header.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const date = Date.parse(s);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** `fetch` within the host's budget, waiting out its 429s. */
export async function limitedFetch(
  limiter: Limiter,
  url: string,
  init: RequestInit = {},
  { fetch: doFetch = fetch, clock = realClock }: { fetch?: typeof fetch; clock?: Clock } = {},
): Promise<Response> {
  const signal = init.signal ?? undefined;
  for (let attempt = 0; ; attempt++) {
    await limiter.take(signal);
    const res = await doFetch(url, init);
    const limit = res.headers.get("X-RateLimit-Limit");
    if (limit) limiter.setLimit(Number(limit));
    if (res.status !== 429 || attempt >= limiter.limits.retries) return res;
    const wait = retryAfter(res.headers.get("Retry-After"), clock.now()) ?? limiter.limits.defaultWait;
    limiter.pause(Math.min(wait, limiter.limits.maxWait));
  }
}

/** AniList: 90 a minute, 30 while "degraded" (docs/data-sources.md); a 429 means a minute's timeout. */
export const anilistLimiter = new Limiter({ burst: 10, perMinute: 20, retries: 1, defaultWait: 60_000, maxWait: 60_000 });

/** ani.zip publishes no limits; this is well under what one viewer's browsing needs. */
export const aniZipLimiter = new Limiter({ burst: 20, perMinute: 120, retries: 1, defaultWait: 5_000, maxWait: 30_000 });
