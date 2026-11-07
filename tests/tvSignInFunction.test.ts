// The tv-sign-in Edge Function's steps (supabase/functions/tv-sign-in/handler.ts, #133) against an
// in-memory stand-in for the database, which keeps to the migration's rules (one answer, handed out once).
import { describe, expect, test } from "bun:test";
import { CODE_ALPHABET, CODE_LENGTH, cleanDevice, handleTvSignIn, normalizeCode, sha256, type TvSignInDeps } from "../supabase/functions/tv-sign-in/handler";
import { normalizeTvCode } from "../src/lib/account/tvSignIn";

type Row = { codeHash: string; pollHash: string; device: string; ipHash: string; answer?: "approved" | "denied"; userId?: string };

function setup(over: Partial<TvSignInDeps> = {}) {
  const rows: Row[] = [];
  const tokens: Record<string, string> = { "token-a": "user-a", "token-b": "user-b" };
  let seed = 7;
  const deps: TvSignInDeps = {
    async start(codeHash, pollHash, device, ipHash) {
      if (rows.some((r) => r.codeHash === codeHash)) throw new Error('duplicate key value violates unique constraint "tv_sign_in_code_hash_key"');
      if (rows.filter((r) => r.ipHash === ipHash).length >= 5) throw new Error("rate_limited");
      rows.push({ codeHash, pollHash, device, ipHash });
      return "2026-11-07T12:05:00Z";
    },
    look: async (_u, codeHash) => rows.find((r) => r.codeHash === codeHash && !r.answer)?.device ?? null,
    async answer(userId, codeHash, approve) {
      const r = rows.find((x) => x.codeHash === codeHash && !x.answer);
      if (!r) return false;
      r.answer = approve ? "approved" : "denied";
      if (approve) r.userId = userId;
      return true;
    },
    async claim(pollHash) {
      const i = rows.findIndex((r) => r.pollHash === pollHash);
      if (i < 0) return { state: "expired", userId: null };
      const r = rows[i];
      if (!r.answer) return { state: "pending", userId: null };
      rows.splice(i, 1);
      return { state: r.answer, userId: r.userId ?? null };
    },
    userOf: async (t) => tokens[t] ?? null,
    signInToken: async (userId) => `hashed-for-${userId}`,
    secret: "SECRET",
    now: () => Date.parse("2026-11-07T12:00:00Z"),
    random: (n) => Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) & 0xff),
    ...over,
  };
  const call = async (body: unknown, opts: { token?: string; ip?: string; method?: string; raw?: string } = {}) => {
    const res = await handleTvSignIn(
      new Request("https://project.example.com/functions/v1/tv-sign-in", {
        method: opts.method ?? "POST",
        headers: {
          ...(opts.token && { authorization: `Bearer ${opts.token}` }),
          "x-forwarded-for": opts.ip ?? "203.0.113.5, 10.0.0.1",
        },
        body: opts.method === "OPTIONS" ? undefined : (opts.raw ?? JSON.stringify(body)),
      }),
      deps,
    );
    return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Record<string, unknown>), headers: res.headers };
  };
  return { rows, call, deps };
}

describe("tv-sign-in", () => {
  test("start → look → approve → claim: the TV gets a sign-in token for the approving account, once", async () => {
    const { rows, call } = setup();
    const started = await call({ action: "start", device: "Living room TV" });
    expect(started.status).toBe(200);
    const { code, poll } = started.body as { code: string; poll: string };
    expect(code).toHaveLength(CODE_LENGTH);
    expect(started.body?.expiresIn).toBe(300);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    // Stored hashed only.
    expect(rows[0].codeHash).toBe(await sha256(code));
    expect(rows[0].pollHash).toBe(await sha256(poll));
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.5");

    expect((await call({ action: "claim", poll })).body).toEqual({ state: "pending" });
    // Typed as people type it: lower case, a dash, spaces.
    const typed = `${code.slice(0, 4).toLowerCase()}- ${code.slice(4)}`;
    expect((await call({ action: "look", code: typed }, { token: "token-a" })).body).toEqual({ device: "Living room TV" });
    expect((await call({ action: "answer", code: typed, approve: true }, { token: "token-a" })).body).toEqual({ ok: true });
    expect((await call({ action: "claim", poll })).body).toEqual({ state: "approved", tokenHash: "hashed-for-user-a" });
    expect((await call({ action: "claim", poll })).body).toEqual({ state: "expired" });
  });

  test("denied: the TV hears so and gets no token", async () => {
    const { call } = setup();
    const { code, poll } = (await call({ action: "start", device: "TV" })).body as { code: string; poll: string };
    expect((await call({ action: "answer", code, approve: false }, { token: "token-b" })).status).toBe(200);
    expect((await call({ action: "claim", poll })).body).toEqual({ state: "denied" });
  });

  test("looking up and answering need a signed-in user; the TV's steps don't", async () => {
    const { call } = setup();
    const { code } = (await call({ action: "start", device: "TV" })).body as { code: string };
    expect(await call({ action: "look", code })).toMatchObject({ status: 401, body: { error: "signed_out" } });
    expect(await call({ action: "answer", code, approve: true }, { token: "made-up" })).toMatchObject({ status: 401, body: { error: "signed_out" } });
  });

  test("a wrong, malformed or answered code is invalid_code", async () => {
    const { call } = setup();
    const { code } = (await call({ action: "start", device: "TV" })).body as { code: string };
    const other = code.replace(/^./, (c) => (c === "A" ? "B" : "A"));
    expect(await call({ action: "look", code: other }, { token: "token-a" })).toMatchObject({ status: 404, body: { error: "invalid_code" } });
    expect(await call({ action: "look", code: "SHORT" }, { token: "token-a" })).toMatchObject({ status: 404 });
    expect(await call({ action: "look", code: "OOOOIIII" }, { token: "token-a" })).toMatchObject({ status: 404 });
    await call({ action: "answer", code, approve: true }, { token: "token-a" });
    expect(await call({ action: "answer", code, approve: true }, { token: "token-b" })).toMatchObject({ status: 404 });
  });

  test("bad requests: not JSON, too big, unknown action, missing fields, bad poll secret, GET", async () => {
    const { call } = setup();
    expect((await call(null, { raw: "{" })).status).toBe(400);
    expect((await call(null, { raw: "[1]" })).status).toBe(400);
    expect((await call({ action: "start", device: "x".repeat(3000) })).status).toBe(400);
    expect((await call({ action: "nope" })).status).toBe(400);
    expect((await call({ action: "start" })).status).toBe(400);
    expect((await call({ action: "start", device: " \n\t " })).status).toBe(400);
    expect((await call({ action: "claim", poll: "short" })).status).toBe(400);
    const { code } = (await call({ action: "start", device: "TV" })).body as { code: string };
    expect((await call({ action: "answer", code, approve: "yes" }, { token: "token-a" })).status).toBe(400);
    expect((await call(null, { method: "GET", raw: undefined as unknown as string })).status).toBe(405);
  });

  test("CORS: the preflight is answered, and every answer carries the headers", async () => {
    const { call } = setup();
    const pre = await call(null, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    expect((await call({ action: "nope" })).headers.get("access-control-allow-origin")).toBe("*");
  });

  test("rate limits come back as 429; a taken code is replaced by another", async () => {
    const { call } = setup();
    for (let i = 0; i < 5; i++) expect((await call({ action: "start", device: "TV" }, { ip: "198.51.100.9" })).status).toBe(200);
    expect(await call({ action: "start", device: "TV" }, { ip: "198.51.100.9" })).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect((await call({ action: "start", device: "TV" }, { ip: "198.51.100.10" })).status).toBe(200);
    // Past the user's tries (misses, in the database), looking up and answering are 429 too.
    const tired = setup({ look: () => Promise.reject(new Error("rate_limited")), answer: () => Promise.reject(new Error("rate_limited")) });
    for (const action of ["look", "answer"])
      expect(await tired.call({ action, code: "AAAAAAAA", approve: true }, { token: "token-a" })).toMatchObject({
        status: 429,
        body: { error: "rate_limited" },
      });

    // The second request's first code is the first request's: it draws another.
    let codes = 0;
    const fixed = setup({ random: (len) => new Uint8Array(len).fill(len === 32 ? 9 : codes++ < 2 ? 0 : 1) });
    expect(((await fixed.call({ action: "start", device: "TV" })).body as { code: string }).code).toBe("AAAAAAAA");
    expect(((await fixed.call({ action: "start", device: "TV" })).body as { code: string }).code).toBe("BBBBBBBB");
    // Always taken: it gives up after a few draws.
    const stuck = setup({ random: (len) => new Uint8Array(len) });
    await stuck.call({ action: "start", device: "TV" });
    expect(await stuck.call({ action: "start", device: "TV" })).toMatchObject({ status: 500, body: { error: "unknown" } });
  });

  test("server errors are 500 without details; an approved request whose account is gone gets expired", async () => {
    const broken = setup({ look: async () => Promise.reject(new Error("connection refused")) });
    const { code } = (await broken.call({ action: "start", device: "TV" })).body as { code: string };
    expect(await broken.call({ action: "look", code }, { token: "token-a" })).toEqual(expect.objectContaining({ status: 500, body: { error: "unknown" } }));

    const gone = setup({ signInToken: async () => null });
    const s = (await gone.call({ action: "start", device: "TV" })).body as { code: string; poll: string };
    await gone.call({ action: "answer", code: s.code, approve: true }, { token: "token-a" });
    expect((await gone.call({ action: "claim", poll: s.poll })).body).toEqual({ state: "expired" });
  });

  test("device names: control characters and runs of space folded, 40 characters at most", () => {
    expect(cleanDevice("  Living\nroom\u0007 TV  ")).toBe("Living room TV");
    expect(cleanDevice("x".repeat(60))).toHaveLength(40);
    expect(cleanDevice(42)).toBeNull();
    expect(cleanDevice("\u0000")).toBeNull();
  });

  test("the app reads a typed code the way the function does", () => {
    for (const typed of ["abcd-efgh", " ABCD EFGH ", "ab.cd/ef gh", "ÄBCD-EFGH"]) expect(normalizeTvCode(typed)).toBe(normalizeCode(typed));
  });
});
