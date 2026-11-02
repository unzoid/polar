// Builds a signed Windows release and publishes it on GitHub, with the
// `latest.json` feed the in-app updater reads
// (https://github.com/unzoid/polar/releases/latest/download/latest.json).
//
//   bun scripts/release.ts 0.1.3 notes.md            build, then publish
//   bun scripts/release.ts 0.1.3 notes.md --draft    build, upload as a draft (apps won't see it until published)
//   bun scripts/release.ts 0.1.3 notes.md --no-build reuse the installers already in target/
//
// notes.md is the "What's new" list: Markdown bullets, shown in the app's
// update toast and in the "Updated to …" sheet after installing.
//
// Signing key: ~/.tauri/polar.key (or TAURI_SIGNING_PRIVATE_KEY). Back it up:
// without it, installed copies can't verify — and so won't take — new builds.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = "unzoid/polar";
const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [version, notesFile] = args.filter((a) => !a.startsWith("--"));

if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !notesFile) {
  console.error("Usage: bun scripts/release.ts <x.y.z> <notes.md> [--draft] [--no-build]");
  process.exit(1);
}
const notes = readFileSync(notesFile, "utf8").trim();

function run(cmd: string, cmdArgs: string[], env?: Record<string, string>) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 1. One version everywhere.
function bump(file: string, pattern: RegExp, replacement: string) {
  const path = join(root, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(pattern, replacement);
  if (after === before && !before.includes(version)) throw new Error(`Couldn't set the version in ${file}`);
  writeFileSync(path, after);
}
bump("Cargo.toml", /(\[workspace\.package\][^[]*?\nversion = )"[^"]+"/, `$1"${version}"`);
bump("package.json", /("version": )"[^"]+"/, `$1"${version}"`);
bump("src-tauri/tauri.conf.json", /("version": )"[^"]+"/, `$1"${version}"`);

// 2. Build and sign.
if (!flags.has("--no-build")) {
  const env: Record<string, string> = {};
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    const keyPath = join(homedir(), ".tauri", "polar.key");
    if (!existsSync(keyPath)) {
      console.error(`No signing key: set TAURI_SIGNING_PRIVATE_KEY or put it at ${keyPath}`);
      process.exit(1);
    }
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8").trim();
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";
  }
  run("bunx", ["tauri", "build"], env);
}

// 3. The update feed.
const bundle = join(root, "target", "release", "bundle");
const setup = join(bundle, "nsis", `Polar_${version}_x64-setup.exe`);
const msi = join(bundle, "msi", `Polar_${version}_x64_en-US.msi`);
for (const f of [setup, `${setup}.sig`, msi, `${msi}.sig`]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. Was it built with createUpdaterArtifacts and a signing key?`);
    process.exit(1);
  }
}
const download = (file: string) => `https://github.com/${REPO}/releases/download/v${version}/${file.split(/[\\/]/).pop()}`;
const sig = (file: string) => readFileSync(`${file}.sig`, "utf8").trim();
const nsis = { signature: sig(setup), url: download(setup) };
const feed = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": nsis,
    "windows-x86_64-nsis": nsis,
    "windows-x86_64-msi": { signature: sig(msi), url: download(msi) },
  },
};
const feedPath = join(bundle, "latest.json");
writeFileSync(feedPath, JSON.stringify(feed, null, 2));

// 4. Publish.
const body = `Polar for Windows (x64).

**Install:** download \`Polar_${version}_x64-setup.exe\` (recommended) or the \`.msi\`. Already have Polar 0.1.3 or later? It updates itself: you'll be asked to restart when it's ready.

### What's new
${notes}

mpv is still bundled (GPLv2+); its license and source links are installed under \`licenses/mpv\`.
`;
const bodyPath = join(bundle, "release-body.md");
writeFileSync(bodyPath, body);
run("gh", [
  "release", "create", `v${version}`,
  "-R", REPO,
  "--title", `"Polar ${version}"`,
  "--notes-file", `"${bodyPath}"`,
  ...(flags.has("--draft") ? ["--draft"] : []),
  `"${setup}"`, `"${msi}"`, `"${feedPath}"`,
]);
console.log(`\nReleased Polar ${version}. Commit the version bump: git commit -am "Release ${version}"`);
