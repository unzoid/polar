import "./storageStub";
import { describe, expect, test } from "bun:test";
import { Limiter } from "../src/lib/net/limiter";
import { trakt, TraktError, traktOffline, traktReady, TraktSignedOut, type TraktCaller } from "../src/lib/trakt/api";
import { readTraktLink, type TraktLink } from "../src/lib/trakt/link";
import { linkTrakt, liveTraktLink, traktLinkState, unlinkTrakt, type TraktLinkDeps } from "../src/lib/trakt/linking";
import {
  pollDeviceSignIn,
  readDeviceCode,
  readTokens,
  refreshTrakt,
  startDeviceSignIn,
  traktViewer,
  waitForDeviceSignIn,
  type DeviceCode,
} from "../src/lib/trakt/signIn";

// #85: a profile linked to Trakt with the device code flow; tokens refreshed before they run out.
const NOW = 1_800_000_000_000;
const CLIENT = "0123456789abcdef".repeat(4);
const free = () => new Limiter({ burst: 1000, perMinute: 60_000, retries: 0, defaultWait: 0, maxWait: 0 });

interface Asked {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch answering from `answer`, keeping what was asked. */
function server(answer: (req: Asked) => { status: number; body?: unknown }) {
  const asked: Asked[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const req: Asked = {
      method: init.method ?? "GET",
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    asked.push(req);
    const { status, body } = answer(req);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  const caller: TraktCaller = { fetch, clientId: CLIENT, limiter: free() };
  return { asked, caller };
}

const link: TraktLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: NOW + 6 * 86_400_000, slug: "someone", name: "Someone" };

describe("requests", () => {
  test("carry Trakt's headers, the token only when signed in", async () => {
    const { asked, caller } = server(() => ({ status: 200, body: { ok: true } }));
    expect(await trakt("GET", "/users/settings", undefined, { ...caller, token: "TOKEN" })).toEqual({ ok: true });
    expect(asked[0].url).toBe("https://api.trakt.tv/users/settings");
    expect(asked[0].headers).toEqual({
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": CLIENT,
      Authorization: "Bearer TOKEN",
    });
    await trakt("POST", "/oauth/device/code", { client_id: CLIENT }, caller);
    expect(asked[1].headers.Authorization).toBeUndefined();
    expect(asked[1].body).toEqual({ client_id: CLIENT });
  });

  test("a 401 signs out, other failures say their status", async () => {
    const { caller } = server((req) => (req.url.endsWith("/a") ? { status: 401 } : { status: 420, body: { error: "limit" } }));
    await expect(trakt("GET", "/a", undefined, caller)).rejects.toBeInstanceOf(TraktSignedOut);
    const e = await trakt("POST", "/b", {}, caller).catch((x) => x);
    expect(e).toBeInstanceOf(TraktError);
    expect(e.status).toBe(420);
    expect(traktOffline(e)).toBe(false);
    expect(traktOffline(new TraktError("busy", 429))).toBe(true);
    expect(traktOffline(new TraktError("down", 503))).toBe(true);
    expect(traktOffline(new TypeError("network"))).toBe(true);
  });

  test("a build without a client id has no sign-in", () => {
    expect(traktReady("")).toBe(false);
    expect(traktReady("abc")).toBe(false);
    expect(traktReady(CLIENT)).toBe(true);
  });
});

describe("the device code", () => {
  const answer = { device_code: "DEVICE", user_code: "5055CC52", verification_url: "https://trakt.tv/activate", expires_in: 600, interval: 5 };

  test("is read with its wait and life, and only Trakt's page is shown", () => {
    expect(readDeviceCode(answer, NOW)).toEqual({
      deviceCode: "DEVICE",
      userCode: "5055CC52",
      verificationUrl: "https://trakt.tv/activate",
      expiresAt: NOW + 600_000,
      interval: 5000,
    });
    expect(readDeviceCode({ ...answer, verification_url: "https://example.com/activate" }, NOW)?.verificationUrl).toBe("https://trakt.tv/activate");
    expect(readDeviceCode({ ...answer, verification_url: "https://trakt.tv.example.com/x" }, NOW)?.verificationUrl).toBe("https://trakt.tv/activate");
    expect(readDeviceCode({ ...answer, interval: 0 }, NOW)?.interval).toBe(1000);
    expect(readDeviceCode({ ...answer, interval: 999 }, NOW)?.interval).toBe(30_000);
    expect(readDeviceCode({ ...answer, user_code: "<b>x</b>" }, NOW)).toBeUndefined();
    expect(readDeviceCode({ user_code: "ABCD1234" }, NOW)).toBeUndefined();
  });

  test("is asked for with the client id only, no secret", async () => {
    const { asked, caller } = server(() => ({ status: 200, body: answer }));
    const code = await startDeviceSignIn({ ...caller, now: NOW });
    expect(code.userCode).toBe("5055CC52");
    expect(asked[0].url).toBe("https://api.trakt.tv/oauth/device/code");
    expect(asked[0].body).toEqual({ client_id: CLIENT });
  });

  const code: DeviceCode = { deviceCode: "DEVICE", userCode: "5055CC52", verificationUrl: "https://trakt.tv/activate", expiresAt: NOW + 600_000, interval: 5000 };

  test("each poll says where the sign-in is, as Trakt's status says", async () => {
    const statuses: [number, string][] = [
      [400, "waiting"],
      [404, "invalid"],
      [409, "used"],
      [410, "expired"],
      [418, "denied"],
      [429, "waiting"],
      [502, "waiting"],
    ];
    for (const [status, state] of statuses) {
      const { caller } = server(() => ({ status }));
      expect((await pollDeviceSignIn(code, { ...caller, now: NOW })).state).toBe(state as never);
    }
    const { asked, caller } = server(() => ({ status: 200, body: { access_token: "TOKEN", refresh_token: "REFRESH", expires_in: 604800, created_at: 1 } }));
    expect(await pollDeviceSignIn(code, { ...caller, now: NOW })).toEqual({
      state: "allowed",
      tokens: { token: "TOKEN", refreshToken: "REFRESH", expiresAt: NOW + 604_800_000 },
    });
    expect(asked[0].body).toEqual({ code: "DEVICE", client_id: CLIENT });
    expect((await pollDeviceSignIn(code, { ...caller, now: code.expiresAt })).state).toBe("expired");
  });

  test("polling waits its interval, longer when asked, and goes on through network failures", async () => {
    let n = 0;
    const answers = [{ status: 400 }, { status: 429 }, null, { status: 400 }, { status: 200, body: { access_token: "T", refresh_token: "R" } }];
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

  test("polling stops when the code is declined or the user closes it", async () => {
    const { caller } = server(() => ({ status: 418 }));
    expect((await waitForDeviceSignIn(code, { ...caller, now: () => NOW, sleep: async () => {} })).state).toBe("denied");
    const stop = new AbortController();
    const waiting = server(() => ({ status: 400 }));
    const sleep = async () => {
      stop.abort(new DOMException("closed", "AbortError"));
    };
    await expect(waitForDeviceSignIn(code, { ...waiting.caller, signal: stop.signal, now: () => NOW, sleep })).rejects.toThrow("closed");
  });
});

describe("tokens and the link", () => {
  test("tokens without both halves aren't a sign-in; the life counts from our clock", () => {
    expect(readTokens({ access_token: "T" }, NOW)).toBeUndefined();
    expect(readTokens({ access_token: "T", refresh_token: "R" }, NOW)?.expiresAt).toBe(NOW + 7 * 86_400_000);
  });

  test("a stored link is read back only when whole", () => {
    expect(readTraktLink(JSON.stringify(link))).toEqual(link);
    expect(readTraktLink(JSON.stringify({ ...link, refused: true }))?.refused).toBe(true);
    expect(readTraktLink(JSON.stringify({ ...link, refreshToken: undefined }))).toBeUndefined();
    expect(readTraktLink("{")).toBeUndefined();
    expect(readTraktLink(null)).toBeUndefined();
    expect(traktLinkState(undefined)).toBe("none");
    expect(traktLinkState(link)).toBe("linked");
    expect(traktLinkState({ ...link, refused: true })).toBe("refused");
  });

  test("who signed in comes from the user's settings", async () => {
    const { caller } = server(() => ({ status: 200, body: { user: { username: "someone", name: "Some One", ids: { slug: "some-one" } } } }));
    expect(await traktViewer({ ...caller, token: "TOKEN" })).toEqual({ slug: "some-one", name: "Some One" });
    const nameless = server(() => ({ status: 200, body: { user: { username: "someone", ids: { slug: "someone" } } } }));
    expect(await traktViewer({ ...nameless.caller, token: "TOKEN" })).toEqual({ slug: "someone", name: "someone" });
  });

  test("a refresh sends the refresh token once and keeps the account; a refused one signs out", async () => {
    const { asked, caller } = server(() => ({ status: 200, body: { access_token: "T2", refresh_token: "R2", expires_in: 604800 } }));
    expect(await refreshTrakt(link, { ...caller, now: NOW })).toEqual({ ...link, token: "T2", refreshToken: "R2", expiresAt: NOW + 604_800_000 });
    expect(asked[0].url).toBe("https://api.trakt.tv/oauth/token");
    expect(asked[0].body).toEqual({ refresh_token: "REFRESH", client_id: CLIENT, grant_type: "refresh_token" });
    const refused = server(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await expect(refreshTrakt(link, refused.caller)).rejects.toBeInstanceOf(TraktSignedOut);
    const down = server(() => ({ status: 503 }));
    await expect(refreshTrakt(link, down.caller)).rejects.toBeInstanceOf(TraktError);
  });
});

function deps(over: Partial<TraktLinkDeps> = {}) {
  const store = new Map<string, TraktLink>();
  const events: string[] = [];
  const d: TraktLinkDeps = {
    now: () => NOW,
    getLink: async (space) => store.get(space ?? "local"),
    saveLink: async (space, l) => void store.set(space ?? "local", l),
    removeLink: async (space) => void store.delete(space ?? "local"),
    refresh: async (l) => ({ ...l, token: `${l.token}+`, refreshToken: `${l.refreshToken}+`, expiresAt: NOW + 7 * 86_400_000 }),
    viewer: async () => ({ slug: "someone", name: "Someone" }),
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
    expect(await liveTraktLink("p", false, d)).toEqual(link);
  });

  test("one running out within a day is refreshed first and kept", async () => {
    const { d, store } = deps();
    store.set("p", { ...link, expiresAt: NOW + 3_600_000 });
    const fresh = await liveTraktLink("p", false, d);
    expect(fresh?.token).toBe("TOKEN+");
    expect(store.get("p")?.refreshToken).toBe("REFRESH+");
  });

  test("two lookups at once refresh once: the second gets the new link", async () => {
    let refreshes = 0;
    const { d, store } = deps({
      refresh: async (l) => {
        refreshes++;
        return { ...l, token: "NEW", expiresAt: NOW + 7 * 86_400_000 };
      },
    });
    store.set("p", { ...link, expiresAt: NOW + 1000 });
    const [a, b] = await Promise.all([liveTraktLink("p", false, d), liveTraktLink("p", false, d)]);
    expect(refreshes).toBe(1);
    expect([a?.token, b?.token]).toEqual(["NEW", "NEW"]);
  });

  test("a refused refresh marks the link refused and says so", async () => {
    const { d, store, events } = deps({
      refresh: async () => {
        throw new TraktSignedOut();
      },
    });
    store.set("p", { ...link, expiresAt: NOW + 1000 });
    expect(await liveTraktLink("p", false, d)).toBeUndefined();
    expect(store.get("p")?.refused).toBe(true);
    expect(events).toEqual(["linked p"]);
    expect(await liveTraktLink("p", false, d)).toBeUndefined();
  });

  test("Trakt out of reach: the token in hand while it works, else the failure", async () => {
    const { d, store } = deps({
      refresh: async () => {
        throw new TypeError("network");
      },
    });
    store.set("p", { ...link, expiresAt: NOW + 1000 });
    expect((await liveTraktLink("p", false, d))?.token).toBe("TOKEN");
    await expect(liveTraktLink("p", true, d)).rejects.toThrow("network");
    store.set("p", { ...link, expiresAt: NOW - 1 });
    await expect(liveTraktLink("p", false, d)).rejects.toThrow("network");
  });
});

describe("linking and unlinking", () => {
  test("linking keeps who signed in with the tokens", async () => {
    const { d, store, events } = deps();
    const made = await linkTrakt("p", { token: "T", refreshToken: "R", expiresAt: NOW + 1 }, d);
    expect(made).toEqual({ token: "T", refreshToken: "R", expiresAt: NOW + 1, slug: "someone", name: "Someone" });
    expect(store.get("p")).toEqual(made);
    expect(events).toEqual(["linked p"]);
  });

  test("unlinking removes the link, tells the hooks, then revokes the token at Trakt", async () => {
    const { d, store, events } = deps();
    store.set("p", link);
    await unlinkTrakt("p", d);
    expect(store.has("p")).toBe(false);
    expect(events).toEqual(["unlinked p", "revoke TOKEN"]);
  });

  test("unlinking still works when Trakt can't be reached", async () => {
    const { d, store, events } = deps({
      revoke: async () => {
        throw new TypeError("network");
      },
    });
    store.set("p", link);
    await unlinkTrakt("p", d);
    expect(store.has("p")).toBe(false);
    expect(events).toEqual(["unlinked p"]);
  });
});
