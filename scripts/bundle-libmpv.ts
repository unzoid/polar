// Copies libmpv and every non-system library it links into
// src-tauri/vendor/libmpv, rewired to find each other next to themselves
// (@loader_path), so the macOS app plays without Homebrew. The build ships
// them in Polarity.app/Contents/Frameworks, where player.rs looks first.
//
//   bun scripts/bundle-libmpv.ts [path/to/libmpv.2.dylib]   (default: Homebrew's)
//
// Writes src-tauri/vendor/libmpv/tauri.conf.json, a config fragment listing
// the libraries for the bundle: `tauri build --config src-tauri/vendor/libmpv/tauri.conf.json`,
// and formulae.json, the Homebrew kegs they came from (macSources.ts packs their sources).
//
// The libraries run on the macOS version (and CPU) they were built for:
// Homebrew's bottles target the Mac they were installed on. The fragment
// sets the app's minimum macOS to match.
import { copyFileSync, chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { kegsOf } from "./macSources";

if (process.platform !== "darwin") process.exit(0);

const source = process.argv[2] ?? "/opt/homebrew/lib/libmpv.2.dylib";
const tauriDir = join(import.meta.dir, "..", "src-tauri");
const out = join(tauriDir, "vendor", "libmpv");

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const isSystem = (p: string) => p.startsWith("/usr/lib/") || p.startsWith("/System/");
const installName = (lib: string) => run("otool", ["-D", lib]).split("\n")[1]?.trim() || lib;
const linked = (lib: string) =>
  run("otool", ["-L", lib])
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(" (")[0])
    .filter(Boolean);
const rpaths = (lib: string) => {
  const lines = run("otool", ["-l", lib]).split("\n");
  return lines.flatMap((l, i) => (l.includes("LC_RPATH") ? [lines[i + 2].trim().split(" ")[1]] : []));
};

/** Where a load command's library actually is on this machine. */
function resolve(dep: string, from: string): string {
  const here = dirname(from);
  const candidates = dep.startsWith("@rpath/")
    ? [...rpaths(from).map((r) => join(r.replace("@loader_path", here), dep.slice(7))), join("/opt/homebrew/lib", dep.slice(7))]
    : dep.startsWith("@loader_path/")
      ? [join(here, dep.slice(13))]
      : [dep];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`can't find ${dep} (needed by ${from})`);
  return realpathSync(found);
}

// 1. Walk the dependency tree.
const libs = new Map<string, string>(); // real path -> file name in the bundle
const edges = new Map<string, Map<string, string>>(); // real path -> (load command -> dependency's real path)
(function walk(lib: string) {
  lib = realpathSync(lib);
  if (libs.has(lib)) return;
  libs.set(lib, basename(installName(lib)));
  const deps = new Map<string, string>();
  edges.set(lib, deps);
  for (const dep of linked(lib)) {
    if (isSystem(dep) || dep === installName(lib)) continue;
    const real = resolve(dep, lib);
    deps.set(dep, real);
    walk(real);
  }
})(source);
// Polarity's mpv ships without libdvdcss (Homebrew's mpv doesn't link it today).
const dvdcss = [...libs.values()].filter((name) => /^libdvdcss\b/.test(name));
if (dvdcss.length) throw new Error(`libmpv links ${dvdcss.join(", ")}, which Polarity doesn't ship`);

// 2. Copy and rewire.
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "licenses"), { recursive: true });
for (const [lib, name] of libs) {
  const dest = join(out, name);
  copyFileSync(lib, dest);
  chmodSync(dest, 0o755);
  const args = ["-id", `@rpath/${name}`];
  for (const [command, real] of edges.get(lib)!) args.push("-change", command, `@loader_path/${libs.get(real)}`);
  for (const r of rpaths(dest)) args.push("-delete_rpath", r);
  run("install_name_tool", [...args, dest]);
  // Rewriting voids the signature, and arm64 refuses unsigned code.
  run("codesign", ["--force", "--sign", "-", dest]);
}
for (const name of libs.values()) {
  const left = linked(join(out, name)).filter((d) => !isSystem(d) && !d.startsWith("@"));
  if (left.length) throw new Error(`${name} still links ${left.join(", ")}`);
}

// 3. Licences: mpv's, and which build of each library ships (Homebrew keeps
// each one's licence and source URL in its formula).
const cellar = (p: string) => p.match(/\/Cellar\/([^/]+)\/([^/]+)\//);
const mpvPrefix = dirname(dirname(realpathSync(source)));
for (const f of ["LICENSE.GPL", "LICENSE.LGPL", "Copyright"]) {
  if (existsSync(join(mpvPrefix, f))) copyFileSync(join(mpvPrefix, f), join(out, "licenses", f));
}
const list = [...libs.keys()].map((p) => {
  const m = cellar(p);
  return m ? `${basename(p)}: ${m[1]} ${m[2]} (https://formulae.brew.sh/formula/${m[1]})` : basename(p);
});
writeFileSync(
  join(out, "licenses", "BUNDLED.txt"),
  `Polarity plays video with mpv (https://mpv.io, GPLv2+), built by Homebrew with the libraries below.\n` +
    `The exact source code of each, with Homebrew's build recipes, is attached to every release of Polarity for macOS\n` +
    `on GitHub (Polarity_<version>_aarch64_mpv-sources.tar), and linked from its Homebrew formula page.\n\n${list.join("\n")}\n`,
);
writeFileSync(join(out, "formulae.json"), JSON.stringify(kegsOf([...libs.keys()]), null, 2));

// 4. The config fragment for `tauri build --config`.
const minos = run("vtool", ["-show-build", realpathSync(source)]).match(/minos (\d+\.\d+)/)?.[1];
writeFileSync(
  join(out, "tauri.conf.json"),
  JSON.stringify(
    {
      bundle: {
        resources: { "vendor/libmpv/licenses/": "licenses/mpv/" },
        macOS: {
          frameworks: [...libs.values()].map((n) => `vendor/libmpv/${n}`),
          ...(minos ? { minimumSystemVersion: minos } : {}),
        },
      },
    },
    null,
    2,
  ),
);
const size = readdirSync(out).length;
console.log(`libmpv + ${libs.size - 1} libraries in ${out} (${size} entries)${minos ? `, macOS ${minos}+` : ""}`);
