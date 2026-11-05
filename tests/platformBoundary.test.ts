import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// docs/ARCHITECTURE.md: only src/lib/platform talks to Tauri; everything else goes through its interfaces.
const SRC = join(import.meta.dir, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

test("only src/lib/platform imports @tauri-apps", () => {
  const platform = join(SRC, "lib", "platform");
  const outside = files(SRC).filter((f) => !f.startsWith(platform) && /from ["']@tauri-apps\//.test(readFileSync(f, "utf8")));
  expect(outside.map((f) => f.slice(SRC.length + 1))).toEqual([]);
});
