// The source of every library the macOS app bundles, for the release page:
// the GPL asks that whoever gets mpv can get the exact source it was built
// from. bundle-libmpv.ts records which Homebrew kegs it copied
// (src-tauri/vendor/libmpv/formulae.json); this fetches each one's source
// with Homebrew (tarball, resources, patches) into a fresh cache and packs
// them with each keg's own formula file, the recipe it was built with.
//
//   bun scripts/macSources.ts <formulae.json> <archive.tar>
//
// (the Release workflow's macOS job; scripts/release-mac.ts calls packMacSources itself).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

/** A Homebrew keg bundle-libmpv.ts copied a library from. */
export type Keg = { formula: string; version: string; prefix: string };

/** The keg a library's real path lies in, e.g. /opt/homebrew/Cellar/ffmpeg/8.0_1/lib/libavcodec.62.dylib. */
export function kegOf(path: string): Keg | undefined {
  const m = path.match(/^(.*\/Cellar\/([^/]+)\/([^/]+))\//);
  return m ? { formula: m[2], version: m[3], prefix: m[1] } : undefined;
}

/** One entry per keg, sorted by formula. */
export function kegsOf(paths: string[]): Keg[] {
  const kegs = new Map<string, Keg>();
  for (const p of paths) {
    const keg = kegOf(p);
    if (keg) kegs.set(keg.prefix, keg);
  }
  return [...kegs.values()].sort((a, b) => a.formula.localeCompare(b.formula));
}

type FormulaInfo = { name: string; versions: { stable: string }; revision: number };

/** The keg version Homebrew's formula builds now ("8.0_1" for 8.0, revision 1). */
export const pkgVersion = (f: FormulaInfo) => (f.revision ? `${f.versions.stable}_${f.revision}` : f.versions.stable);

/** Kegs whose formula has moved on: fetching would get another version's source than the one bundled. */
export function outdated(kegs: Keg[], info: FormulaInfo[]): string[] {
  const now = new Map(info.map((f) => [f.name, pkgVersion(f)]));
  return kegs.filter((k) => now.get(k.formula) !== k.version).map((k) => `${k.formula} ${k.version} (Homebrew now has ${now.get(k.formula) ?? "none"})`);
}

/** Homebrew keeps downloads as `<sha256>--<name>`; the archive keeps the name. */
export const downloadName = (file: string) => file.replace(/^[0-9a-f]{64}--/, "");

export function sourcesTxt(kegs: Keg[], files: string[]): string {
  return (
    "Source code of mpv and the libraries bundled in Polarity for macOS, as Homebrew built them.\n\n" +
    "sources/  each formula's source archive, the resources it builds with, and the patches it applies\n" +
    "recipes/  each formula file as installed (Homebrew's build recipe, with any inline patches)\n\n" +
    "To build one: brew install --build-from-source recipes/<formula>.rb\n\n" +
    "Bundled:\n" +
    kegs.map((k) => `  ${k.formula} ${k.version}`).join("\n") +
    "\n\nFiles:\n" +
    files.map((f) => `  sources/${f}`).join("\n") +
    "\n"
  );
}

function brew(args: string[], env: Record<string, string> = {}): string {
  const r = spawnSync("brew", args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) throw new Error(`brew ${args.join(" ")} failed`);
  return r.stdout;
}

/** Packs the sources of the kegs listed in `formulaeJson` into `archive` (a .tar). */
export function packMacSources(formulaeJson: string, archive: string, work: string) {
  const kegs: Keg[] = JSON.parse(readFileSync(formulaeJson, "utf8"));
  const names = kegs.map((k) => k.formula);
  const info: FormulaInfo[] = JSON.parse(brew(["info", "--json=v2", "--formula", ...names])).formulae;
  const stale = outdated(kegs, info);
  if (stale.length) {
    throw new Error(`Homebrew's formulae no longer match the bundled libraries: ${stale.join(", ")}.\nRun brew upgrade, then build again.`);
  }

  rmSync(work, { recursive: true, force: true });
  // Absolute: Homebrew refuses a relative HOMEBREW_CACHE ("different prefix").
  const cache = resolve(work, "cache");
  const out = join(work, "polarity-mac-sources");
  mkdirSync(join(out, "sources"), { recursive: true });
  mkdirSync(join(out, "recipes"), { recursive: true });
  // A fresh cache holds exactly what these formulae download from source.
  brew(["fetch", "--build-from-source", "--formula", ...names], { HOMEBREW_CACHE: cache });
  const downloads = join(cache, "downloads");
  const files = readdirSync(downloads)
    .filter((f) => !f.endsWith(".incomplete") && !f.endsWith(".json"))
    .map((f) => {
      copyFileSync(join(downloads, f), join(out, "sources", downloadName(f)));
      return downloadName(f);
    })
    .sort();
  for (const k of kegs) {
    const recipe = join(k.prefix, ".brew", `${k.formula}.rb`);
    if (!existsSync(recipe)) throw new Error(`${k.formula} ${k.version} has no formula file at ${recipe}`);
    copyFileSync(recipe, join(out, "recipes", basename(recipe)));
  }
  writeFileSync(join(out, "SOURCES.txt"), sourcesTxt(kegs, files));
  const r = spawnSync("tar", ["-cf", archive, "-C", work, basename(out)], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("packing the sources failed");
  rmSync(work, { recursive: true, force: true });
}

if (import.meta.main) {
  const [formulaeJson, archive] = process.argv.slice(2);
  if (!formulaeJson || !archive) {
    console.error("Usage: bun scripts/macSources.ts <formulae.json> <archive.tar>");
    process.exit(1);
  }
  mkdirSync(dirname(archive), { recursive: true });
  packMacSources(formulaeJson, archive, join(dirname(archive), "mpv-sources"));
}
