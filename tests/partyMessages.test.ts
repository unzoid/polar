import { expect, test } from "bun:test";
import { LAG_MAX, OUT_MAX, parseMember, parseMessage, parsePresence, roundTrip, takesOver, V_JUMP_MAX, type Timeline } from "../src/lib/party/messages";

const media = { type: "series", metaId: "tt0000105", videoId: "tt0000105:1:5", label: "S1:E5 · The Lantern and the Key", hint: { release: "Show.S01E05.1080p" } };
const tl = (over: Record<string, unknown> = {}) => ({ v: 3, by: "a", media, paused: false, held: false, position: 61.5, lag: 0.04, ...over });
const state = (over: Record<string, unknown> = {}) => ({ t: "state", from: "a", tl: tl(over) });

test("a well-formed timeline passes unchanged", () => {
  expect(parseMessage(state())).toEqual({ t: "state", from: "a", tl: tl() as Timeline });
  expect(parseMessage({ t: "hello", from: "b" })).toEqual({ t: "hello", from: "b" });
  expect(parseMessage({ t: "ping", from: "b", sent: 12.5 })).toEqual({ t: "ping", from: "b", sent: 12.5 });
});

test("versions must be safe integers, so nobody wins every tie for good", () => {
  expect(parseMessage(state({ v: 1e308 }))).toBeNull();
  expect(parseMessage(state({ v: 2 ** 53 }))).toBeNull();
  expect(parseMessage(state({ v: 2.5 }))).toBeNull();
  expect(parseMessage(state({ v: 0 }))).toBeNull();
  expect(parseMessage(state({ v: "4" }))).toBeNull();
});

test("a timeline speaks for its sender only", () => {
  expect(parseMessage({ ...state(), from: "b" })).toBeNull();
  expect(parseMessage({ ...state(), from: undefined })).toBeNull();
});

test("wrong shapes are dropped", () => {
  for (const bad of [null, 1, "x", [], { t: "nope", from: "a" }, { t: "ping", from: "a" }, { t: "ping", from: "a", sent: NaN }]) {
    expect(parseMessage(bad)).toBeNull();
  }
  expect(parseMessage(state({ paused: "yes" }))).toBeNull();
  expect(parseMessage(state({ position: Infinity }))).toBeNull();
  expect(parseMessage(state({ media: { ...media, type: "channel" } }))).toBeNull();
  expect(parseMessage(state({ media: { ...media, videoId: "a b" } }))).toBeNull();
  expect(parseMessage(state({ media: { ...media, metaId: "x".repeat(201) } }))).toBeNull();
  expect(parseMessage(state({ by: "a<script>" }))).toBeNull();
});

test("numbers are kept in range and text cut to size", () => {
  const m = parseMessage(state({ position: -5, lag: 1e9, media: { ...media, label: `${"L".repeat(500)}\n`, hint: { release: 7 } } }));
  if (m?.t !== "state") throw new Error("expected a state");
  expect(m.tl.position).toBe(0);
  expect(m.tl.lag).toBe(LAG_MAX);
  expect(m.tl.media.label).toHaveLength(120);
  expect(m.tl.media.hint).toBeUndefined();
  const n = parseMessage(state({ lag: "slow", position: 1e12 }));
  if (n?.t !== "state") throw new Error("expected a state");
  expect(n.tl.lag).toBe(0);
  expect(n.tl.position).toBe(7 * 24 * 3600);
});

test("presence entries must carry their key, and are cleaned up", () => {
  const sam = { id: "s1", name: " Sam\u0007 ", avatar: "nope", joinedAt: 5, waiting: true, away: "yes", extra: "x" };
  expect(parseMember(sam, "s1")).toEqual({ id: "s1", name: "Sam", avatar: parseMember({ ...sam, avatar: "" })!.avatar, joinedAt: 5, waiting: true });
  expect(parseMember(sam, "other")).toBeUndefined();
  expect(parseMember({ ...sam, joinedAt: "0" })).toBeUndefined();
  expect(parseMember({ ...sam, name: "x".repeat(99) })!.name).toHaveLength(40);
  expect(parseMember({ ...sam, name: 3 })!.name).toBe("Guest");
  const list = parsePresence({ s1: [{ ...sam, name: "old" }, sam], fake: [{ ...sam, id: "s1" }], empty: [] });
  expect(list.map((m) => [m.id, m.name])).toEqual([["s1", "Sam"]]);
});

test("a timeline takes over when it's newer, from the room, and not too far ahead", () => {
  const members = [{ id: "h" }, { id: "a" }];
  const cur = { v: 10, by: "h" };
  const next = (v: number, by = "a") => ({ ...(tl({ v, by }) as Timeline) });
  expect(takesOver(cur, next(11), members, "h")).toBe(true);
  expect(takesOver(cur, next(10, "a"), members, "h")).toBe(false); // "a" < "h"
  expect(takesOver(cur, next(9), members, "h")).toBe(false);
  expect(takesOver(cur, next(10 + V_JUMP_MAX), members, "h")).toBe(true);
  expect(takesOver(cur, next(11 + V_JUMP_MAX), members, "h")).toBe(false);
  // The host's is taken however far ahead: we missed messages while offline.
  expect(takesOver({ v: 10, by: "a" }, next(5000, "h"), members, "h")).toBe(true);
  expect(takesOver(cur, next(11, "stranger"), members, "h")).toBe(false);
  // Before the first presence list, a joiner can't check who's in the room.
  expect(takesOver(null, next(5000, "stranger"), null, null)).toBe(true);
});

test("forged pings don't skew the latency", () => {
  expect(roundTrip(100, 180)).toBe(80);
  expect(roundTrip(500, 100)).toBeUndefined();
  expect(roundTrip(-1e9, 100)).toBeUndefined();
});

test("bye speaks for its sender", () => {
  expect(parseMessage({ t: "bye", from: "b" })).toEqual({ t: "bye", from: "b" });
  expect(parseMessage({ t: "bye" })).toBeNull();
});

test("a key holding several presence entries counts as its newest, wherever the server puts it", () => {
  const entry = (seq: number, over: Record<string, unknown> = {}) => ({ id: "a", name: "Ash", avatar: "", joinedAt: 1, waiting: seq < 3, seq, ...over });
  for (const metas of [
    [entry(3), entry(1)],
    [entry(1), entry(3)],
  ]) {
    expect(parsePresence({ a: metas })).toEqual([expect.objectContaining({ id: "a", seq: 3, waiting: false })]);
  }
  // Without numbers, the last one, as before; an invalid entry doesn't hide a valid one.
  expect(parsePresence({ a: [entry(0, { seq: undefined, name: "Old" }), entry(0, { seq: undefined, name: "New" })] })[0].name).toBe("New");
  expect(parsePresence({ a: [entry(2), { id: "a" }] })).toEqual([expect.objectContaining({ seq: 2 })]);
  expect(parseMember({ ...entry(2), buffering: true, seq: -1 })).toEqual(expect.not.objectContaining({ seq: expect.anything() }));
  expect(parseMember({ ...entry(2), buffering: true })?.buffering).toBe(true);
});

test("the host's rules and answers are checked like everything else (#156)", () => {
  const rules = { v: 2, host: null, locked: true, control: "host", wait: false, approve: true, out: ["b", "b", "c<"] };
  expect(parseMessage({ t: "rules", from: "a", rules })).toEqual({ t: "rules", from: "a", rules: { ...rules, control: "host", out: ["b"] } as never });
  expect(parseMessage({ t: "rules", from: "a", rules: { ...rules, control: "anyone" } })).toBeNull();
  expect(parseMessage({ t: "rules", from: "a", rules: { ...rules, v: 0 } })).toBeNull();
  expect(parseMessage({ t: "rules", from: "a", rules: { ...rules, locked: "yes" } })).toBeNull();
  expect(parseMessage({ t: "rules", from: "a", rules: { ...rules, host: "x y" } })).toBeNull();
  const many = parseMessage({ t: "rules", from: "a", rules: { ...rules, out: Array.from({ length: 80 }, (_, i) => `m${i}`) } });
  if (many?.t !== "rules") throw new Error("expected rules");
  expect(many.rules.out).toHaveLength(OUT_MAX);
  expect(many.rules.out.at(-1)).toBe("m79");

  expect(parseMessage({ t: "admit", from: "a", to: "b" })).toEqual({ t: "admit", from: "a", to: "b" });
  expect(parseMessage({ t: "kick", from: "a" })).toBeNull();
  expect(parseMessage({ t: "refuse", from: "a", to: "b", why: "locked" })).toEqual({ t: "refuse", from: "a", to: "b", why: "locked" });
  expect(parseMessage({ t: "refuse", from: "a", to: "b", why: "because" })).toBeNull();
  expect(parseMessage({ t: "end", from: "a" })).toEqual({ t: "end", from: "a" });
  expect(parseMessage({ t: "at", from: "b", videoId: "tt0000105:1:5", position: -3, paused: false, lag: 99 })).toEqual({
    t: "at",
    from: "b",
    videoId: "tt0000105:1:5",
    position: 0,
    paused: false,
    lag: LAG_MAX,
  });
  expect(parseMessage({ t: "at", from: "b", videoId: "tt0000105:1:5", position: 3 })).toBeNull();
  expect(parseMember({ id: "s1", name: "Sam", avatar: "", joinedAt: 1, waiting: false, knock: true }, "s1")?.knock).toBe(true);
});

test("only the host's timeline counts when only the host controls playback", () => {
  const members = [{ id: "a" }, { id: "b" }];
  const next = tl({ v: 4, by: "b" }) as Timeline;
  expect(takesOver({ v: 3, by: "a" }, next, members, "a")).toBe(true);
  expect(takesOver({ v: 3, by: "a" }, next, members, "a", true)).toBe(false);
  expect(takesOver({ v: 3, by: "a" }, next, members, "b", true)).toBe(true);
});
