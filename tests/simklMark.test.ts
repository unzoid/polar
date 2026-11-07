import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CREDITS, SIMKL_MARK_CREDIT } from "../src/lib/settings/credits";

// #319: Simkl's monochrome mark in the title page's "View on Simkl" link, its file unchanged and credited.
const ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const SIMKL_MARK_SHA256 = "e6b3dcd9485afabf762c36b7820e565700123a32e9dd2a351d7233b9c1e6ed25";

test("the mark is Simkl's own file, byte for byte", () => {
  const bytes = readFileSync(join(ROOT, "src/assets/simkl-mark.svg"));
  // sha256 of https://us.simkl.in/img_favicon/v2/safari-pinned-tab.svg, the monochrome SVG in Simkl's API rules.
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(SIMKL_MARK_SHA256);
});

test("the mark sits inside the View on Simkl link, in the link's colour", () => {
  const panel = read("src/components/title/SimklPanel.tsx");
  expect(panel).toContain('import simklMark from "../../assets/simkl-mark.svg";');
  const link = panel.slice(panel.indexOf('className="simkl-page'), panel.indexOf("</button>", panel.indexOf('className="simkl-page')));
  expect(link).toMatch(/<span className="simkl-mark" aria-hidden[^\n]*\/>\s*View on Simkl\s*$/);
  const css = read("src/styles/detail.css").replace(/\s+/g, " ");
  expect(css).toMatch(/\.simkl-mark \{[^}]*background-color: currentColor;[^}]*mask: var\(--simkl-mark\)/);
});

test("it's credited as Simkl's trademark, with where it came from", () => {
  expect(SIMKL_MARK_CREDIT).toContain("trademark of Simkl");
  expect(SIMKL_MARK_CREDIT).toContain("api.simkl.org/api-rules");
  expect(CREDITS.find((c) => c.name === "Simkl")?.use).toContain(SIMKL_MARK_CREDIT);
  const licensing = read("docs/licensing.md");
  expect(licensing).toContain("`src/assets/simkl-mark.svg`");
  expect(licensing).toContain("https://us.simkl.in/img_favicon/v2/safari-pinned-tab.svg` on 07/11/2026");
  expect(licensing).toContain(SIMKL_MARK_SHA256);
});
