import { describe, expect, test } from "bun:test";
import { keys } from "../src/lib/queryKeys";

type Key = readonly unknown[];
type Factory = Key | ((...args: never[]) => Key);

/** Every factory by its path, e.g. `anime.media`. */
function flatten(tree: Record<string, unknown>, path = ""): [string, Factory][] {
  return Object.entries(tree).flatMap(([name, v]) =>
    typeof v === "function" || Array.isArray(v) ? [[path + name, v as Factory]] : flatten(v as Record<string, unknown>, `${path}${name}.`),
  );
}

/** The key's shape: its fixed parts, and `*` where an argument goes. */
function shape(f: Factory): unknown[] {
  if (typeof f !== "function") return [...f];
  const call = f as (...args: unknown[]) => Key;
  const a = call("a", "b", "c", "d", "e");
  const b = call("v", "w", "x", "y", "z");
  return a.map((part, i) => (part === b[i] ? part : "*"));
}

/** Could one key built by `x` equal one built by `y`? */
const canMeet = (x: unknown[], y: unknown[]) => x.length === y.length && x.every((p, i) => p === "*" || y[i] === "*" || p === y[i]);

const all = flatten(keys);
const families = all.filter(([name]) => !name.endsWith("All"));
const prefixes = all.filter(([name]) => name.endsWith("All"));

describe("query keys", () => {
  test("no two factories can build the same key (critique C5)", () => {
    const clashes: string[] = [];
    for (let i = 0; i < families.length; i++)
      for (let j = i + 1; j < families.length; j++)
        if (canMeet(shape(families[i][1]), shape(families[j][1]))) clashes.push(`${families[i][0]} / ${families[j][0]}`);
    expect(clashes).toEqual([]);
  });

  test("every …All prefix covers at least one family", () => {
    for (const [name, prefix] of prefixes) {
      const p = shape(prefix);
      const covered = families.some(([, f]) => p.every((part, i) => shape(f)[i] === part));
      expect({ name, covered }).toEqual({ name, covered: true });
    }
  });

  test("Discover's pages and Search's genre row stay apart but share the Discover prefix", () => {
    expect(keys.discover("movie", "popular", "Horror")).not.toEqual(keys.genreRow("movie", "Horror"));
    expect(keys.genreRow("movie", "Horror").slice(0, 1)).toEqual([...keys.discoverAll]);
  });
});
