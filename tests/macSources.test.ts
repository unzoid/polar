import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { downloadName, kegOf, kegsOf, outdated, packMacSources } from "../scripts/macSources";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("each bundled library is traced to its keg, one entry per keg", () => {
  expect(kegOf("/opt/homebrew/Cellar/ffmpeg/8.0_1/lib/libavcodec.62.dylib")).toEqual({
    formula: "ffmpeg",
    version: "8.0_1",
    prefix: "/opt/homebrew/Cellar/ffmpeg/8.0_1",
  });
  expect(kegOf("/usr/local/lib/libfoo.dylib")).toBeUndefined();
  const kegs = kegsOf([
    "/opt/homebrew/Cellar/mpv/0.41.0/lib/libmpv.2.dylib",
    "/opt/homebrew/Cellar/ffmpeg/8.0_1/lib/libavcodec.62.dylib",
    "/opt/homebrew/Cellar/ffmpeg/8.0_1/lib/libavformat.62.dylib",
  ]);
  expect(kegs.map((k) => `${k.formula} ${k.version}`)).toEqual(["ffmpeg 8.0_1", "mpv 0.41.0"]);
});

test("a formula Homebrew has moved on from stops the release: its source wouldn't be what shipped", () => {
  const kegs = kegsOf(["/opt/homebrew/Cellar/ffmpeg/8.0_1/lib/a.dylib", "/opt/homebrew/Cellar/mpv/0.41.0/lib/b.dylib"]);
  const info = (ffmpegRevision: number) => [
    { name: "ffmpeg", versions: { stable: "8.0" }, revision: ffmpegRevision },
    { name: "mpv", versions: { stable: "0.41.0" }, revision: 0 },
  ];
  expect(outdated(kegs, info(1))).toEqual([]);
  expect(outdated(kegs, info(2))).toEqual(["ffmpeg 8.0_1 (Homebrew now has 8.0_2)"]);
});

test("downloads keep their own names in the archive", () => {
  expect(downloadName(`${"a".repeat(64)}--mpv-0.41.0.tar.gz`)).toBe("mpv-0.41.0.tar.gz");
  expect(downloadName("mpv-0.41.0.tar.gz")).toBe("mpv-0.41.0.tar.gz");
});

test("the archive holds every fetched source, patch and recipe, and a list of them", () => {
  const dir = mkdtempSync(join(tmpdir(), "polar-macsrc-"));
  dirs.push(dir);
  // A keg as Homebrew installs it, with its formula file.
  const prefix = join(dir, "Cellar", "mpv", "0.41.0");
  mkdirSync(join(prefix, ".brew"), { recursive: true });
  writeFileSync(join(prefix, ".brew", "mpv.rb"), "class Mpv < Formula\nend\n");
  writeFileSync(join(dir, "formulae.json"), JSON.stringify([{ formula: "mpv", version: "0.41.0", prefix }]));
  // A stand-in brew: `info` answers, `fetch` downloads a source and a patch into $HOMEBREW_CACHE.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "brew"),
    `#!/bin/sh
case "$1" in
info) echo '{"formulae":[{"name":"mpv","versions":{"stable":"0.41.0"},"revision":0}]}' ;;
fetch) mkdir -p "$HOMEBREW_CACHE/downloads" "$HOMEBREW_CACHE/api"
  echo src > "$HOMEBREW_CACHE/downloads/${"b".repeat(64)}--mpv-0.41.0.tar.gz"
  echo fix > "$HOMEBREW_CACHE/downloads/${"c".repeat(64)}--fix.patch"
  echo partial > "$HOMEBREW_CACHE/downloads/${"d".repeat(64)}--other.tar.gz.incomplete"
  echo {} > "$HOMEBREW_CACHE/api/formula.jws.json" ;;
*) exit 1 ;;
esac
`,
  );
  chmodSync(join(bin, "brew"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    packMacSources(join(dir, "formulae.json"), join(dir, "sources.tar"), join(dir, "work"));
  } finally {
    process.env.PATH = path;
  }
  const listing = spawnSync("tar", ["-tf", join(dir, "sources.tar")], { encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean)
    .sort();
  expect(listing.filter((f) => !f.endsWith("/"))).toEqual([
    "polarity-mac-sources/SOURCES.txt",
    "polarity-mac-sources/recipes/mpv.rb",
    "polarity-mac-sources/sources/fix.patch",
    "polarity-mac-sources/sources/mpv-0.41.0.tar.gz",
  ]);
  const list = spawnSync("tar", ["-xOf", join(dir, "sources.tar"), "polarity-mac-sources/SOURCES.txt"], { encoding: "utf8" }).stdout;
  expect(list).toContain("  mpv 0.41.0\n");
  expect(list).toContain("  sources/fix.patch\n");
});
