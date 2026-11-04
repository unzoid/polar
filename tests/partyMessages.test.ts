import { expect, test } from "bun:test";
import { LAG_MAX, parseMember, parseMessage, parsePresence, roundTrip, takesOver, V_JUMP_MAX, type Timeline } from "../src/lib/party/messages";

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
