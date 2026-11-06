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

/**
 * How urgent a request is; lower goes first once the burst is spent (#109). Between two
 * levels is fine: the rest of a row on screen (1.5) goes after every row's first cards.
 */
export const PRIORITY = {
  /** The page the user just opened. */
  page: 0,
  /** Rows and cards on screen. */
  visible: 1,
  /** Rows just below the screen. */
  near: 2,
  /** Prefetching, rows far away: held back while the host is degraded. */
  background: 3,
} as const;

/** A level, or how to read it when the request's turn comes (a row scrolled into view moves up). */
export type Priority = number | (() => number);

/** After this long waiting, a request that isn't background work makes the host "busy" (shown to the user). */
export const BUSY_AFTER = 3000;

interface Waiter {
  priority: () => number;
  since: number;
  seq: number;
  go: () => void;
}

export class Limiter {
  private tokens: number;
  private at: number;
  private pausedUntil = 0;
  private perMs: number;
  private hostLimit: number | undefined;
  private waiting: Waiter[] = [];
  private seq = 0;
  private running = false;
  private nap: AbortController | undefined;
  private listeners = new Set<() => void>();
  /** A pause is on, or a request that isn't background work has waited past {@link BUSY_AFTER}. */
  busy = false;

  constructor(
    readonly limits: HostLimits,
    private readonly clock: Clock = realClock,
  ) {
    this.tokens = limits.burst;
    this.at = clock.now();
    this.perMs = limits.perMinute / 60_000;
  }

  /** The host told us it's in its reduced mode (AniList's 30 a minute instead of 90). */
  get reduced() {
    return this.hostLimit !== undefined && this.hostLimit < 60;
  }

  /**
   * Waits until a request may go. Once the burst is spent, waiters go by `priority`, then in
   * order of arrival; while the host is {@link reduced}, background work only goes when the bucket
   * is full again, so it never takes a turn from anything on screen.
   */
  take(signal?: AbortSignal, priority: Priority = PRIORITY.visible): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.waiting = this.waiting.filter((w) => w !== waiter);
        reject(signal!.reason);
        this.wake();
      };
      const waiter: Waiter = {
        priority: typeof priority === "function" ? priority : () => priority,
        since: this.clock.now(),
        seq: this.seq++,
        go: () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        },
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiting.push(waiter);
      this.wake();
      void this.run();
    });
  }

  /** Look at the queue again now: a waiter came, left, or changed its priority. */
  wake() {
    this.nap?.abort();
  }

  /** Called whenever {@link busy} changes. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private setBusy(busy: boolean) {
    if (busy === this.busy) return;
    this.busy = busy;
    for (const l of this.listeners) l();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.waiting.length) {
        const now = this.clock.now();
        if (now > this.at) {
          this.tokens = Math.min(this.limits.burst, this.tokens + (now - this.at) * this.perMs);
          this.at = now;
        }
        const ready = this.tokens >= this.limits.burst || !this.reduced;
        const urgent = this.waiting.filter((w) => w.priority() < PRIORITY.background);
        const oldest = Math.min(...urgent.map((w) => w.since));
        const paused = now < this.pausedUntil;
        this.setBusy(paused || now - oldest >= BUSY_AFTER);

        let wait: number;
        if (paused) {
          wait = this.pausedUntil - now;
        } else {
          const next = this.next(ready);
          if (next && this.tokens >= 1) {
            this.tokens -= 1;
            this.waiting = this.waiting.filter((w) => w !== next);
            next.go();
            continue;
          }
          // No token yet, or only background work left while the host is degraded: until the bucket is full.
          wait = Math.ceil(((next ? 1 : this.limits.burst) - this.tokens) / this.perMs);
        }
        if (!this.busy && urgent.length) wait = Math.min(wait, oldest + BUSY_AFTER - now);
        this.nap = new AbortController();
        await this.clock.sleep(Math.max(1, wait), this.nap.signal).catch(() => {});
      }
    } finally {
      this.running = false;
      this.nap = undefined;
      this.setBusy(false);
    }
  }

  /** The waiter whose turn it is: most urgent first, then first come. */
  private next(backgroundToo: boolean): Waiter | undefined {
    let best: Waiter | undefined;
    let bestP = Infinity;
    for (const w of this.waiting) {
      const p = w.priority();
      if (p >= PRIORITY.background && !backgroundToo) continue;
      if (p < bestP || (p === bestP && best && w.seq < best.seq)) {
        best = w;
        bestP = p;
      }
    }
    return best;
  }

  /** Nobody goes for `ms`, and the burst starts empty after it. */
  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
    this.tokens = 0;
    // Refilling starts when the pause ends.
    this.at = this.pausedUntil;
    this.setBusy(true);
  }

  /**
   * The host told its real limit (AniList's X-RateLimit-Limit: 90, or 30 while
   * it is degraded). The burst comes out of it, so no minute goes over.
   */
  setLimit(perMinute: number) {
    if (!Number.isFinite(perMinute) || perMinute <= 0) return;
    this.hostLimit = perMinute;
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

/** `fetch` within the host's budget, waiting out its 429s; after a pause, the most urgent request goes first. */
export async function limitedFetch(
  limiter: Limiter,
  url: string,
  init: RequestInit = {},
  { fetch: doFetch = fetch, clock = realClock, priority }: { fetch?: typeof fetch; clock?: Clock; priority?: Priority } = {},
): Promise<Response> {
  const signal = init.signal ?? undefined;
  for (let attempt = 0; ; attempt++) {
    await limiter.take(signal, priority);
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

/**
 * At most `limit` of the calls passed to the returned function run at once; the rest wait their turn, in order.
 * For fan-outs over our own backend (the Calendar's show lookups), where the cost is many requests at once.
 */
export function concurrency(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((go) => waiting.push(go));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}
