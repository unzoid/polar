import { describe, expect, test } from "bun:test";
import { added, contract, unread } from "../src/lib/contract";
import addon from "../contract/addon.json";
import library from "../contract/library.json";
import app from "../contract/app.json";

/** What the Rust tests found each type sends, by Rust type name. */
const sent: Record<string, string[]> = { ...addon, ...library, ...app };
const declared = contract as Record<string, Record<string, true>>;
const byName = (list: Partial<Record<string, string[]>>, name: string) => list[name] ?? [];

describe("TS mirrors of the Rust types (critique M5)", () => {
  test("no type is written by two crates", () => {
    const names = [addon, library, app].flatMap(Object.keys);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every type Rust sends has a TS entry, and every entry a Rust type", () => {
    expect(Object.keys(declared).sort()).toEqual(Object.keys(sent).sort());
  });

  for (const [name, keys] of Object.entries(sent)) {
    test(`${name}: the TS type reads the fields Rust sends`, () => {
      const own = byName(added, name);
      const mirrored = Object.keys(declared[name] ?? {}).filter((k) => !own.includes(k));
      expect([...mirrored, ...byName(unread, name)].sort()).toEqual([...keys].sort());
    });
  }

  test("left-out and added fields are named once and not also declared", () => {
    for (const [name, keys] of Object.entries(unread)) for (const k of keys ?? []) expect(declared[name]).not.toHaveProperty(k);
    for (const [name, keys] of Object.entries(added)) {
      for (const k of keys ?? []) {
        expect(declared[name]).toHaveProperty(k);
        expect(sent[name]).not.toContain(k);
      }
    }
  });
});
