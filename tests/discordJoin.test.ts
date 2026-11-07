import { expect, test } from "bun:test";
import {
  ASK_MS,
  askToJoin,
  createJoinDesk,
  isJoinToken,
  JOIN_TOKEN_MS,
  joinTopic,
  parseJoinMessage,
  PENDING_MAX,
  REFUSALS,
  SEEN_MS,
  type DeskRoom,
  type JoinDeps,
  type JoinMode,
} from "../src/lib/party/discordJoin";

// Joining a watch party from a Discord profile's button (#153, #154).

/** Channels by topic, a clock that only moves when told, and everything anyone sent. */
function world() {
  const topics = new Map<string, Set<(m: Record<string, unknown>) => void>>();
  const sent: { topic: string; m: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  let now = 0;
  let timers: { at: number; fn: () => void }[] = [];
  let ids = 0;
  const deps: JoinDeps = {
    connect(topic, onMessage, onReady) {
      opened.push(topic);
      const set = topics.get(topic) ?? new Set();
      topics.set(topic, set);
      set.add(onMessage);
      queueMicrotask(onReady);
      return {
        send: (m) => {
          sent.push({ topic, m });
          // Over the wire: a copy, a moment later.
          const copy = JSON.parse(JSON.stringify(m));
          queueMicrotask(() => [...(topics.get(topic) ?? [])].forEach((h) => h(copy)));
        },
        close: () => void set.delete(onMessage),
      };
    },
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    newId: () => `joiner-${String(++ids).padStart(4, "0")}`,
    after(fn, ms) {
      const t = { at: now + ms, fn };
      timers.push(t);
      return () => void (timers = timers.filter((x) => x !== t));
    },
    subtle: crypto.subtle,
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((t) => t !== next);
      now = next.at;
      next.fn();
      await settle();
    }
    now = end;
  };
  const listeners = (topic: string) => topics.get(topic)?.size ?? 0;
  return { deps, sent, opened, settle, advance, listeners };
}

function party(w: ReturnType<typeof world>, mode: JoinMode = "ask") {
  const room: DeskRoom = { code: "K7Q2ZP", locked: false };
  let m = mode;
  const desk = createJoinDesk(
    w.deps,
    () => room,
    () => m,
  );
  return { desk, room, setMode: (next: JoinMode) => (m = next) };
}

const outcome = (p: Promise<string>) =>
  p.then(
    (code) => ({ code }),
    (e: Error) => ({ error: e.message }),
  );

/** Asks at once, with the outcome caught as it comes (a refusal can arrive before the test looks). */
function join(...args: Parameters<typeof askToJoin>) {
  const ask = askToJoin(...args);
  return { done: outcome(ask.done), cancel: ask.cancel };
}

test("a token is 16 random bytes and a key's fingerprint, and its channel is named after a hash, not the token", async () => {
  const w = world();
  const { desk } = party(w);
  expect(desk.token()).toBeNull();
  await w.settle();
  const token = desk.token()!;
  expect(isJoinToken(token)).toBe(true);
  expect(w.opened).toEqual([`join-${await joinTopic(crypto.subtle, token)}`]);
  expect(w.opened[0]).not.toContain(token);
  expect(w.opened[0]).toMatch(/^join-[0-9a-f]{32}$/);
});

test("Anyone who sees it: the joiner gets the code, sealed so others on the channel can't read it", async () => {
  const w = world();
  const { desk } = party(w, "anyone");
  await w.settle();
  const progress: string[] = [];
  const ask = join(w.deps, desk.token()!, "Moa", (p) => progress.push(p));
  await w.settle();
  expect(await ask.done).toEqual({ code: "K7Q2ZP" });
  expect(progress).toEqual(["asking", "waiting"]);
  // Nothing on the channel carries the code in the clear.
  expect(JSON.stringify(w.sent)).not.toContain("K7Q2ZP");
  expect(desk.requests()).toEqual([]);
});

test("Ask me: the member sees the request and only an allowed one gets in", async () => {
  const w = world();
  const { desk } = party(w, "ask");
  await w.settle();
  const token = desk.token()!;
  const first = join(w.deps, token, "Moa‮\u0000 ");
  const second = join(w.deps, token, "x".repeat(200));
  await w.settle();
  const requests = desk.requests();
  expect(requests.map((r) => r.name)).toEqual(["Moa", "x".repeat(40)]);
  desk.answer(requests[0].id, true);
  desk.answer(requests[1].id, false);
  await w.settle();
  expect(await first.done).toEqual({ code: "K7Q2ZP" });
  expect(await second.done).toEqual({ error: REFUSALS.declined });
  expect(desk.requests()).toEqual([]);
});

test("an unanswered request is declined after a while, on both sides", async () => {
  const w = world();
  const { desk } = party(w, "ask");
  await w.settle();
  const ask = join(w.deps, desk.token()!, "Moa");
  await w.settle();
  expect(desk.requests()).toHaveLength(1);
  await w.advance(ASK_MS);
  expect(desk.requests()).toEqual([]);
  expect(await ask.done).toEqual({ error: REFUSALS.declined });
});

test("a locked room turns joiners away, also one allowed after it locked", async () => {
  const w = world();
  const { desk, room } = party(w, "ask");
  await w.settle();
  const token = desk.token()!;
  const waiting = join(w.deps, token, "Moa");
  await w.settle();
  room.locked = true;
  const late = join(w.deps, token, "Sam");
  desk.answer(desk.requests()[0].id, true);
  await w.settle();
  expect(await waiting.done).toEqual({ error: REFUSALS.locked });
  expect(await late.done).toEqual({ error: REFUSALS.locked });
});

test("Nobody, or out of the party: no code for anyone", async () => {
  const w = world();
  const { desk, setMode, room } = party(w, "anyone");
  await w.settle();
  const token = desk.token()!;
  setMode("nobody");
  const a = join(w.deps, token, "Moa");
  await w.settle();
  expect(await a.done).toEqual({ error: REFUSALS.closed });
  setMode("anyone");
  room.code = null;
  const b = join(w.deps, token, "Sam");
  await w.settle();
  expect(await b.done).toEqual({ error: REFUSALS.closed });
});

test("too many waiting requests: the rest are told the host is busy", async () => {
  const w = world();
  const { desk } = party(w, "ask");
  await w.settle();
  const asks = Array.from({ length: PENDING_MAX + 1 }, (_, i) => join(w.deps, desk.token()!, `Guest ${i}`));
  await w.settle();
  expect(desk.requests()).toHaveLength(PENDING_MAX);
  expect(await asks[PENDING_MAX].done).toEqual({ error: REFUSALS.busy });
});

test("tokens change: the previous one still works for a while, older ones don't", async () => {
  const w = world();
  const { desk } = party(w, "anyone");
  await w.settle();
  const first = desk.token()!;
  await w.advance(JOIN_TOKEN_MS);
  const second = desk.token()!;
  expect(second).not.toBe(first);
  expect(await join(w.deps, first, "Moa").done).toEqual({ code: "K7Q2ZP" });
  await w.advance(JOIN_TOKEN_MS);
  const old = join(w.deps, first, "Sam");
  await w.settle();
  await w.advance(SEEN_MS);
  expect(await old.done).toEqual({ error: REFUSALS.expired });
  expect(await join(w.deps, second, "Kai").done).toEqual({ code: "K7Q2ZP" });
});

test("a token nobody answers for, or one that isn't a token, says the link has expired", async () => {
  const w = world();
  const nobody = join(w.deps, "A".repeat(43), "Moa");
  await w.settle();
  await w.advance(SEEN_MS);
  expect(await nobody.done).toEqual({ error: REFUSALS.expired });
  expect(await join(w.deps, "K7Q2ZP", "Moa").done).toEqual({ error: REFUSALS.expired });
});

test("stopping the desk closes its channels and turns waiting joiners away", async () => {
  const w = world();
  const { desk } = party(w, "ask");
  await w.settle();
  const topic = w.opened[0];
  const ask = join(w.deps, desk.token()!, "Moa");
  await w.settle();
  desk.stop();
  await w.settle();
  expect(await ask.done).toEqual({ error: REFUSALS.closed });
  expect(w.listeners(topic)).toBe(0);
  expect(desk.token()).toBeNull();
});

test("a joiner who cancels stops listening", async () => {
  const w = world();
  const { desk } = party(w, "ask");
  await w.settle();
  const ask = join(w.deps, desk.token()!, "Moa");
  await w.settle();
  ask.cancel();
  expect(await ask.done).toEqual({ error: "cancelled" });
  expect(w.listeners(w.opened[0])).toBe(1);
});

test("someone else with the token can't answer in the member's place; malformed messages are dropped", async () => {
  const w = world();
  const { desk } = party(w, "ask");
  await w.settle();
  const token = desk.token()!;
  const ask = join(w.deps, token, "Moa");
  await w.settle();
  const [{ id }] = desk.requests();
  // A listener with the token answers first, with the code of a party of its own, sealed with its own key.
  const forger = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
  const jwk = await crypto.subtle.exportKey("jwk", forger.publicKey);
  const ch = w.deps.connect(w.opened[0], () => {}, () => {});
  ch.send({ t: "ok", to: id, key: { x: jwk.x, y: jwk.y }, iv: "AAAAAAAAAAAAAAAA", box: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
  ch.send({ t: "no", to: "joiner-9999", why: "declined" });
  await w.settle();
  // Still waiting for the member, who lets them in.
  desk.answer(id, true);
  await w.settle();
  expect(await ask.done).toEqual({ code: "K7Q2ZP" });
  for (const bad of [{ t: "ask", id: "x", name: "a", key: {} }, { t: "no", to: "a", why: "because" }, { t: "ok", to: "a" }, { t: "hello" }, null]) {
    expect(parseJoinMessage(bad as Record<string, unknown>)).toBeNull();
  }
});
