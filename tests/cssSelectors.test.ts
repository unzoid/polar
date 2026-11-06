import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Selectors a browser accepts but that can never match: the rule is silently dead.
const SRC = join(import.meta.dir, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : []));
}

/** Every selector in a stylesheet, comments removed, one per comma-separated item. */
function selectors(css: string): string[] {
  const out: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of text.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim().replace(/\s+/g, " ");
    if (!head || head.startsWith("@") || /^(from|to|\d+%)/.test(head)) continue;
    out.push(...head.split(",").map((s) => s.trim()));
  }
  return out;
}

test(":root only starts a selector (nothing is ever an ancestor of the root)", () => {
  const dead = files(SRC).flatMap((f) =>
    selectors(readFileSync(f, "utf8"))
      .filter((s) => /\S\s*[ >+~]\s*:root\b/.test(s))
      .map((s) => `${f.slice(SRC.length + 1)}: ${s}`),
  );
  expect(dead).toEqual([]);
});

test("Home's shelves out of view are skipped in Chromium (#134)", () => {
  const css = readFileSync(join(SRC, "styles", "cards.css"), "utf8");
  const rule = selectors(css).find((s) => s.includes(".row") && s.includes("data-engine"));
  expect(rule).toBe(':root[data-engine="chromium"] .home .row');
});
