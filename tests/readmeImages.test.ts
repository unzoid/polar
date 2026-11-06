import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// docs/screenshots.md: the README's pictures are of the open films, each one credited under it.
const ROOT = join(import.meta.dir, "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const local = [...readme.matchAll(/(?:src="|\]\()(readme-images\/[^")]+)/g)].map((m) => m[1]);

test("every picture the README shows is in the repository", () => {
  expect(local.length).toBeGreaterThan(0);
  for (const path of local) expect(existsSync(join(ROOT, path)), path).toBe(true);
});

test("readme-images holds only what the README shows", () => {
  const files = readdirSync(join(ROOT, "readme-images")).filter((f) => f !== "holder.txt");
  expect(files.map((f) => `readme-images/${f}`).sort()).toEqual([...new Set(local)].sort());
});

test("a credit for the films follows each screenshot", () => {
  for (const path of local) {
    const after = readme.slice(readme.indexOf(path), readme.indexOf(path) + 900);
    expect(after, path).toContain("Blender Foundation");
  }
});
