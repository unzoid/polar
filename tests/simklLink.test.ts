import "./storageStub";
import { describe, expect, test } from "bun:test";
import { Limiter, type Clock } from "../src/lib/net/limiter";
import { simkl, SimklError, simklOffline, SimklQuota, simklQuotaLow, simklReady, SimklSignedOut, type SimklCaller } from "../src/lib/simkl/api";
import { readSimklLink, type SimklLink } from "../src/lib/simkl/link";
import { linkSimkl, liveSimklLink, SimklReadOnly, simklLinkState, unlinkSimkl, type SimklLinkDeps } from "../src/lib/simkl/linking";
import {
  pollDeviceSignIn,
  readDeviceCode,
  readTokens,
  refreshSimkl,
  revokeSimkl,
  simklViewer,
  startDeviceSignIn,
  waitForDeviceSignIn,
  type DeviceCode,
} from "../src/lib/simkl/signIn";

// #86: a profile linked to Simkl with the device flow; tokens refreshed before they run out, within Simkl's limits.
const NOW = 1_800_000_000_000;
const CLIENT = "0123456789abcdef".repeat(4);
const free = () => new Limiter({ burst: 1000, perMinute: 60_000, retries: 0, defaultWait: 0, maxWait: 0 });

interface Asked {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch answering from `answer`, keeping what was asked; the clock's sleeps are kept, not waited. */
function server(answer: (req: Asked) => Answer) {
  const asked: Asked[] = [];
  const slept: number[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const raw = init.body ? String(init.body) : undefined;
    const body = raw === undefined ? undefined : headers["Content-Type"]?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    const req: Asked = { method: init.method ?? "GET", url: new URL(url), headers, body };
    asked.push(req);
    const a = answer(req);
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: a.headers });
  }) as unknown as typeof globalThis.fetch;
  let now = NOW;
  const clock: Clock = { now: () => now, sleep: async (ms) => void (slept.push(ms), (now += ms)) };
  const quota = new SimklQuota();
  const caller: SimklCaller = { fetch, clientId: CLIENT, version: "1.2.3", limiter: free(), clock, quota };
  return { asked, slept, caller, quota, advance: (ms: number) => (now += ms) };
}

const link: SimklLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: NOW + 6 * 86_400_000, account: 42, name: "Someone" };

describe("requests", () => {
  test("carry Simkl's parameters on every call, the token only when signed in", async () => {
    const { asked, caller } = server(() => ({ status: 200, body: { ok: true } }));
    expect(await simkl("GET", "/sync/activities", undefined, { ...caller, token: "TOKEN" })).toEqual({ ok: true });
    const url = asked[0].url;
    expect(url.origin + url.pathname).toBe("https://api.simkl.com/sync/activities");
    expect([url.searchParams.get("client_id"), url.searchParams.get("app-name"), url.searchParams.get("app-version")]).toEqual([CLIENT, "polarity", "1.2.3"]);
    expect(asked[0].headers).toEqual({ Authorization: "Bearer TOKEN" });
    await simkl("POST", "/sync/history", { movies: [] }, caller, { date_from: "2026-01-01T00:00:00Z" });
    expect(asked[1].headers).toEqual({ "Content-Type": "application/json" });
    expect(asked[1].body).toEqual({ movies: [] });
    expect(asked[1].url.searchParams.get("date_from")).toBe("2026-01-01T00:00:00Z");
  });

  test("a 401 signs out, other failures say their status and Simkl's code", async () => {
    const { caller } = server((req) => (req.url.pathname === "/a" ? { status: 401 } : { status: 412, body: { error: "client_id_failed" } }));
    await expect(simkl("GET", "/a", undefined, caller)).rejects.toBeInstanceOf(SimklSignedOut);
    const e = await simkl("POST", "/b", {}, caller).catch((x) => x);
    expect(e).toBeInstanceOf(SimklError);
    expect([e.status, e.code]).toEqual([412, "client_id_failed"]);
    expect(simklOffline(e)).toBe(false);
    expect(simklOffline(new SimklError("busy", 429))).toBe(true);
    expect(simklOffline(new SimklError("down", 503))).toBe(true);
    expect(simklOffline(new TypeError("network"))).toBe(true);
  });

  test("Simkl's per-second limit and write lock are tried again once after a second", async () => {
    const answers: Answer[] = [
      { status: 429, body: { error: "rate_limit" } },
      { status: 200, body: 1 },
      { status: 400, body: { error: "RATE_LIMIT" } },
      { status: 400, body: { error: "RATE_LIMIT" } },
    ];
    const { asked, slept, caller } = server(() => answers[asked.length - 1]);
    expect(await simkl("GET", "/a", undefined, caller)).toBe(1);
    const e = await simkl("POST", "/b", {}, caller).catch((x) => x);
    expect([e.status, e.code]).toEqual([400, "RATE_LIMIT"]);
    expect(asked.length).toBe(4);
    expect(slept).toEqual([1100, 1100]);
  });

  test("a spent day stops every request until Simkl's Retry-After, without asking Simkl again", async () => {
    const { asked, caller, quota, advance } = server(() => ({ status: 429, body: { error: "user_limit_exceeded" }, headers: { "Retry-After": "600" } }));
    const e = await simkl("GET", "/a", undefined, caller).catch((x) => x);
    expect([e.status, e.code]).toEqual([429, "user_limit_exceeded"]);
    expect(quota.blockedUntil).toBe(NOW + 600_000);
    expect(simklQuotaLow(NOW, quota)).toBe(true);
    await simkl("GET", "/b", undefined, caller).catch(() => {});
    expect(asked.length).toBe(1);
    advance(600_000);
    expect(simklQuotaLow(NOW + 600_000, quota)).toBe(false);
    await simkl("GET", "/c", undefined, caller).catch(() => {});
    expect(asked.length).toBe(2);
  });

  test("requests left today are kept; background work stops near the end", async () => {
    const { caller, quota } = server(() => ({ status: 200, body: {}, headers: { "X-RateLimit-Remaining": "49" } }));
    await simkl("GET", "/a", undefined, caller);
    expect(quota.remaining).toBe(49);
    expect(simklQuotaLow(NOW, quota)).toBe(true);
    expect(simklQuotaLow(NOW, new SimklQuota())).toBe(false);
  });

  test("a build without a client id has no sign-in", () => {
    expect(simklReady("")).toBe(false);
    expect(simklReady("a b")).toBe(false);
    expect(simklReady(CLIENT)).toBe(true);
  });
});

describe("the device code", () => {
  const answer = {
    device_code: "DEVICE",
    user_code: "BDWP-HQPK",
    verification_uri: "https://simkl.com/pin",
    verification_uri_complete: "https://simkl.com/pin?user_code=BDWP-HQPK",
    expires_in: 900,
    interval: 5,
  };

  test("is read with its wait and life, and only Simkl's pages are shown or opened", () => {
    expect(readDeviceCode(answer, NOW)).toEqual({
      deviceCode: "DEVICE",
      userCode: "BDWP-HQPK",
      verificationUrl: "https://simkl.com/pin",
      completeUrl: "https://simkl.com/pin?user_code=BDWP-HQPK",
      expiresAt: NOW + 900_000,
      interval: 5000,
    });
    const other = readDeviceCode(
      { ...answer, verification_uri: "https://example.com/pin", verification_uri_complete: "https://simkl.com.example.com/pin?user_code=BDWP-HQPK" },
      NOW,
    );
    expect(other?.verificationUrl).toBe("https://simkl.com/pin");
    expect(other?.completeUrl).toBeUndefined();
    expect(readDeviceCode({ ...answer, verification_uri_complete: "https://simkl.com/pin?user_code=OTHER-CODE" }, NOW)?.completeUrl).toBeUndefined();
    expect(readDeviceCode({ ...answer, interval: 0 }, NOW)?.interval).toBe(5000);
    expect(readDeviceCode({ ...answer, interval: 999 }, NOW)?.interval).toBe(30_000);
    expect(readDeviceCode({ ...answer, user_code: "<b>x</b>" }, NOW)).toBeUndefined();
    expect(readDeviceCode({ user_code: "ABCD1234" }, NOW)).toBeUndefined();
    expect(readDeviceCode({ ...answer, expires_in: 1e12 }, NOW)?.expiresAt).toBe(NOW + 1_800_000);
  });

  test("is asked for form-encoded with the client id and both scopes, no secret", async () => {
    const { asked, caller } = server(() => ({ status: 200, body: answer }));
    const code = await startDeviceSignIn({ ...caller, now: NOW });
    expect(code.userCode).toBe("BDWP-HQPK");
    expect(asked[0].url.pathname).toBe("/oauth2/device");
    expect(asked[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(asked[0].body).toEqual({ client_id: CLIENT, scope: "media:read media:write" });
    const refused = server(() => ({ status: 401, body: { error: "invalid_client" } }));
    await expect(startDeviceSignIn(refused.caller)).rejects.toBeInstanceOf(SimklError);
  });

  const code: DeviceCode = { deviceCode: "DEVICE", userCode: "BDWP-HQPK", verificationUrl: "https://simkl.com/pin", expiresAt: NOW + 900_000, interval: 5000 };

  test("each poll says where the sign-in is, as Simkl's error says", async () => {
    const answers: [Answer, string][] = [
      [{ status: 400, body: { error: "authorization_pending" } }, "waiting"],
      [{ status: 400, body: { error: "slow_down" } }, "waiting"],
      [{ status: 400, body: { error: "expired_token" } }, "expired"],
      [{ status: 401, body: { error: "invalid_client" } }, "invalid"],
      [{ status: 502 }, "waiting"],
    ];
    for (const [a, state] of answers) {
      const { caller } = server(() => a);
      expect((await pollDeviceSignIn(code, { ...caller, now: NOW })).state).toBe(state as never);
    }
    const { asked, caller } = server(() => ({
      status: 200,
      body: { access_token: "simkl_at_x", token_type: "Bearer", expires_in: 604800, refresh_token: "simkl_rt_x", scope: "media:read media:write" },
    }));
    expect(await pollDeviceSignIn(code, { ...caller, now: NOW })).toEqual({
      state: "allowed",
      tokens: { token: "simkl_at_x", refreshToken: "simkl_rt_x", expiresAt: NOW + 604_800_000, canWrite: true },
    });
    expect(asked[0].body).toEqual({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: CLIENT, device_code: "DEVICE" });
    expect((await pollDeviceSignIn(code, { ...caller, now: code.expiresAt })).state).toBe("expired");
  });

  test("polling waits its interval, 5 s longer on slow_down, and goes on through network failures", async () => {
    let n = 0;
    const answers: (Answer | null)[] = [
      { status: 400, body: { error: "authorization_pending" } },
      { status: 400, body: { error: "slow_down" } },
      null,
      { status: 400, body: { error: "authorization_pending" } },
      { status: 200, body: { access_token: "T", refresh_token: "R", scope: "media:read media:write" } },
    ];
    const { caller } = server(() => {
      const a = answers[n++];
      if (!a) throw new TypeError("network");
      return a;
    });
    const waits: number[] = [];
    const result = await waitForDeviceSignIn(code, { ...caller, now: () => NOW, sleep: async (ms) => void waits.push(ms) });
    expect(result.state).toBe("allowed");
    expect(waits).toEqual([5000, 5000, 10_000, 10_000, 10_000]);
  });

  test("Simkl never says declined: polling stops when the code runs out or the user closes it", async () => {
    let t = NOW;
    const { caller } = server(() => ({ status: 400, body: { error: "authorization_pending" } }));
    const result = await waitForDeviceSignIn(code, { ...caller, now: () => t, sleep: async (ms) => void (t += ms) });
    expect(result.state).toBe("expired");
    const stop = new AbortController();
    const sleep = async () => {
      stop.abort(new DOMException("closed", "AbortError"));
    };
    await expect(waitForDeviceSignIn(code, { ...caller, signal: stop.signal, now: () => NOW, sleep })).rejects.toThrow("closed");
  });
});

describe("tokens and the link", () => {
  test("tokens say whether Simkl gave write access; the life counts from our clock", () => {
    expect(readTokens({ access_token: "T" }, NOW)).toBeUndefined();
    expect(readTokens({ access_token: "T", refresh_token: "R" }, NOW)).toEqual({
      token: "T",
      refreshToken: "R",
      expiresAt: NOW + 7 * 86_400_000,
      canWrite: false,
    });
    expect(readTokens({ access_token: "T", refresh_token: "R", scope: "media:read" }, NOW)?.canWrite).toBe(false);
    expect(readTokens({ access_token: "T", refresh_token: "R", scope: "media:write media:read" }, NOW)?.canWrite).toBe(true);
    // A refresh answer without the refresh token keeps the one sent.
    expect(readTokens({ access_token: "T" }, NOW, "KEPT")?.refreshToken).toBe("KEPT");
  });

  test("tokens that couldn't go into a header aren't a sign-in; the life stays between a minute and a year", () => {
    expect(readTokens({ access_token: "T\r\nX: y", refresh_token: "R" }, NOW)).toBeUndefined();
    expect(readTokens({ access_token: "T", refresh_token: "R R" }, NOW)).toBeUndefined();
    expect(readTokens({ access_token: "T".repeat(4097), refresh_token: "R" }, NOW)).toBeUndefined();
    expect(readTokens({ access_token: "T", refresh_token: "R", expires_in: -5 }, NOW)?.expiresAt).toBe(NOW + 60_000);
    expect(readTokens({ access_token: "T", refresh_token: "R", expires_in: 1e12 }, NOW)?.expiresAt).toBe(NOW + 365 * 86_400_000);
  });

  test("a stored link is read back only when whole", () => {
    expect(readSimklLink(JSON.stringify(link))).toEqual(link);
    expect(readSimklLink(JSON.stringify({ ...link, refused: true, watchlist: true }))).toEqual({ ...link, refused: true, watchlist: true });
    expect(readSimklLink(JSON.stringify({ ...link, account: "42" }))).toBeUndefined();
    expect(readSimklLink(JSON.stringify({ ...link, refreshToken: undefined }))).toBeUndefined();
    expect(readSimklLink("{")).toBeUndefined();
    expect(readSimklLink(null)).toBeUndefined();
    expect(simklLinkState(undefined)).toBe("none");
    expect(simklLinkState(link)).toBe("linked");
    expect(simklLinkState({ ...link, refused: true })).toBe("refused");
  });

  test("who signed in comes from the user's settings", async () => {
    const { asked, caller } = server(() => ({ status: 200, body: { user: { name: "Some One" }, account: { id: 42, type: "free" } } }));
    expect(await simklViewer({ ...caller, token: "TOKEN" })).toEqual({ account: 42, name: "Some One" });
    expect(asked[0].url.pathname).toBe("/users/settings");
    const nameless = server(() => ({ status: 200, body: { user: { name: " " }, account: { id: 7 } } }));
    expect(await simklViewer({ ...nameless.caller, token: "TOKEN" })).toEqual({ account: 7, name: "Simkl 7" });
    const nobody = server(() => ({ status: 200, body: { user: { name: "x" } } }));
    await expect(simklViewer({ ...nobody.caller, token: "TOKEN" })).rejects.toBeInstanceOf(SimklError);
  });

  test("a refresh keeps the account and the refresh token; a refused one signs out, a busy one doesn't", async () => {
    const { asked, caller } = server(() => ({
      status: 200,
      body: { access_token: "T2", refresh_token: "REFRESH", expires_in: 604800, scope: "media:read media:write" },
    }));
    expect(await refreshSimkl(link, { ...caller, now: NOW })).toEqual({ ...link, token: "T2", expiresAt: NOW + 604_800_000 });
    expect(asked[0].url.pathname).toBe("/oauth2/token");
    expect(asked[0].body).toEqual({ grant_type: "refresh_token", client_id: CLIENT, refresh_token: "REFRESH" });
    const refused = server(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await expect(refreshSimkl(link, refused.caller)).rejects.toBeInstanceOf(SimklSignedOut);
    const busy = server(() => ({ status: 400, body: { error: "RATE_LIMIT" } }));
    await expect(refreshSimkl(link, busy.caller)).rejects.toBeInstanceOf(SimklError);
    const down = server(() => ({ status: 503 }));
    await expect(refreshSimkl(link, down.caller)).rejects.toBeInstanceOf(SimklError);
  });

  test("revoking sends the refresh token and never throws", async () => {
    const { asked, caller } = server(() => ({ status: 200 }));
    await revokeSimkl("REFRESH", caller);
    expect(asked[0].url.pathname).toBe("/oauth2/revoke");
    expect(asked[0].body).toEqual({ client_id: CLIENT, token: "REFRESH" });
    const down = server(() => {
      throw new TypeError("network");
    });
    await revokeSimkl("REFRESH", down.caller);
  });
});

function deps(over: Partial<SimklLinkDeps> = {}) {
  const store = new Map<string, SimklLink>();
  const events: string[] = [];
  const d: SimklLinkDeps = {
    now: () => NOW,
    getLink: async (space) => store.get(space ?? "local"),
    saveLink: async (space, l) => void store.set(space ?? "local", l),
    removeLink: async (space) => void store.delete(space ?? "local"),
    refresh: async (l) => ({ ...l, token: `${l.token}+`, expiresAt: NOW + 7 * 86_400_000 }),
    viewer: async () => ({ account: 42, name: "Someone" }),
    revoke: async (token) => void events.push(`revoke ${token}`),
    changed: (space, linked) => void events.push(`${linked ? "linked" : "unlinked"} ${space}`),
    ...over,
  };
  return { d, store, events };
}

describe("keeping the link usable", () => {
  test("a link with days left is used as it is", async () => {
    const { d, store } = deps();
    store.set("p", link);
    expect(await liveSimklLink("p", false, d)).toEqual(link);
  });

  test("one running out within a day is refreshed first and kept", async () => {
    const { d, store } = deps();
    store.set("p", { ...link, expiresAt: NOW + 3_600_000 });
    expect((await liveSimklLink("p", false, d))?.token).toBe("TOKEN+");
    expect(store.get("p")?.token).toBe("TOKEN+");
  });

  test("two lookups at once refresh once: a second refresh would cut off the first token", async () => {
    let refreshes = 0;
    const { d, store } = deps({
      refresh: async (l) => {
        refreshes++;
        return { ...l, token: "NEW", expiresAt: NOW + 7 * 86_400_000 };
      },
    });
    store.set("p", { ...link, expiresAt: NOW + 1000 });
    const [a, b] = await Promise.all([liveSimklLink("p", false, d), liveSimklLink("p", false, d)]);
    expect(refreshes).toBe(1);
    expect([a?.token, b?.token]).toEqual(["NEW", "NEW"]);
  });

  test("a refused refresh marks the link refused and says so", async () => {
    const { d, store, events } = deps({
      refresh: async () => {
        throw new SimklSignedOut();
      },
    });
    store.set("p", { ...link, expiresAt: NOW + 1000 });
    expect(await liveSimklLink("p", false, d)).toBeUndefined();
    expect(store.get("p")?.refused).toBe(true);
    expect(events).toEqual(["linked p"]);
    expect(await liveSimklLink("p", false, d)).toBeUndefined();
  });

  test("Simkl out of reach: the token in hand while it works, else the failure", async () => {
    const { d, store } = deps({
      refresh: async () => {
        throw new TypeError("network");
      },
    });
    store.set("p", { ...link, expiresAt: NOW + 1000 });
    expect((await liveSimklLink("p", false, d))?.token).toBe("TOKEN");
    await expect(liveSimklLink("p", true, d)).rejects.toThrow("network");
    store.set("p", { ...link, expiresAt: NOW - 1 });
    await expect(liveSimklLink("p", false, d)).rejects.toThrow("network");
  });
});

describe("linking and unlinking", () => {
  const tokens = { token: "T", refreshToken: "R", expiresAt: NOW + 1, canWrite: true };

  test("linking keeps who signed in with the tokens", async () => {
    const { d, store, events } = deps();
    const made = await linkSimkl("p", tokens, d);
    expect(made).toEqual({ token: "T", refreshToken: "R", expiresAt: NOW + 1, account: 42, name: "Someone" });
    expect(store.get("p")).toEqual(made);
    expect(events).toEqual(["linked p"]);
  });

  test("the same account signed in again keeps its watchlist switch; another doesn't", async () => {
    const { d, store } = deps();
    store.set("p", { ...link, watchlist: true });
    expect((await linkSimkl("p", tokens, d)).watchlist).toBe(true);
    store.set("p", { ...link, account: 7, watchlist: true });
    expect((await linkSimkl("p", tokens, d)).watchlist).toBeUndefined();
  });

  test("a read-only sign-in isn't kept: it is revoked and says why", async () => {
    const { d, store, events } = deps();
    await expect(linkSimkl("p", { ...tokens, canWrite: false }, d)).rejects.toBeInstanceOf(SimklReadOnly);
    expect(store.has("p")).toBe(false);
    expect(events).toEqual(["revoke R"]);
  });

  test("unlinking removes the link, tells the hooks, then revokes the sign-in at Simkl", async () => {
    const { d, store, events } = deps();
    store.set("p", link);
    await unlinkSimkl("p", d);
    expect(store.has("p")).toBe(false);
    expect(events).toEqual(["unlinked p", "revoke REFRESH"]);
  });

  test("unlinking still works when Simkl can't be reached", async () => {
    const { d, store, events } = deps({
      revoke: async () => {
        throw new TypeError("network");
      },
    });
    store.set("p", link);
    await unlinkSimkl("p", d);
    expect(store.has("p")).toBe(false);
    expect(events).toEqual(["unlinked p"]);
  });
});
