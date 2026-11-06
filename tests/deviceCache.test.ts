import { beforeEach, expect, test } from "bun:test";

const mem = new Map<string, string>();
let quota = Infinity;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    const used = [...mem].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
    if (used + v.length > quota) throw new Error("QuotaExceededError");
    mem.set(k, v);
  },
  removeItem: (k: string) => void mem.delete(k),
};
const { BUDGET, cachedBytes, clearCached, readCached, writeCached } = await import("../src/lib/net/deviceCache");

beforeEach(() => {
  mem.clear();
  quota = Infinity;
});

const HOUR = 60 * 60_000;

test("an answer kept on the device reads back with when it came, until it's older than the reader allows (#109)", () => {
  writeCached("rows", { a: 1 }, 1000);
  expect(readCached("rows", HOUR, 1000 + HOUR / 2)).toEqual({ data: { a: 1 }, at: 1000 });
  expect(readCached("rows", HOUR, 1000 + 2 * HOUR)).toBeUndefined();
  expect(readCached("missing", HOUR, 1000)).toBeUndefined();
});

test("whatever else is in storage under the key reads as nothing", () => {
  mem.set("polar.cache.rows", "not json");
  expect(readCached("rows", HOUR)).toBeUndefined();
  mem.set("polar.cache.rows", JSON.stringify({ data: 1 }));
  expect(readCached("rows", HOUR)).toBeUndefined();
});

test("the store stays under its budget, the oldest entries going first", () => {
  const big = "x".repeat(BUDGET / 5);
  for (let i = 0; i < 8; i++) writeCached(`e${i}`, big, i);
  expect(readCached("e0", HOUR, 10)).toBeUndefined();
  expect(readCached("e7", HOUR, 10)?.data).toBe(big);
  expect(cachedBytes()).toBeLessThanOrEqual(BUDGET * 2);
});

test("a full origin makes room from our own oldest entries, and gives up quietly when it can't", () => {
  writeCached("old", "x".repeat(1000), 1);
  quota = 1500;
  writeCached("new", "y".repeat(1000), 2);
  expect(readCached("old", HOUR, 3)).toBeUndefined();
  expect(readCached("new", HOUR, 3)?.data).toBe("y".repeat(1000));
  quota = 10;
  expect(() => writeCached("more", "z".repeat(1000), 4)).not.toThrow();
});

test("clearing drops every entry and nothing else", () => {
  mem.set("polar.prefs", "{}");
  writeCached("a", 1);
  writeCached("b", 2);
  clearCached();
  expect([...mem.keys()]).toEqual(["polar.prefs"]);
  expect(cachedBytes()).toBe(0);
});
