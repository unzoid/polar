// Builds a signed Windows release and publishes it on GitHub, with the
// `latest.json` feed the in-app updater reads
// (https://github.com/unzoid/polarity/releases/latest/download/latest.json).
//
//   bun scripts/release.ts 0.1.3 notes.md            build, then publish
//   bun scripts/release.ts 0.1.3 notes.md --draft    build, upload as a draft (apps won't see it until published)
//   bun scripts/release.ts 0.1.3 notes.md --no-build reuse the installers already in target/
//   bun scripts/release.ts 0.1.3 notes.md --no-account  build without accounts (no sign-in)
//
// Accounts need VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (environment
// or .env); without them and without --no-account the build stops.
//
// notes.md is the "What's new" list: Markdown bullets, shown in the app's
// update toast and in the "Updated to …" sheet after installing.
//
// Signing key: ~/.tauri/polar.key (or TAURI_SIGNING_PRIVATE_KEY). Back it up:
// without it, installed copies can't verify — and so won't take — new builds.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { requireAccountEnv } from "./accountEnv";
import { mpvVersion, vendoredMpvVersion } from "./windowsMpv";

const REPO = "unzoid/polarity";
const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [version, notesFile] = args.filter((a) => !a.startsWith("--"));

if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !notesFile) {
  console.error("Usage: bun scripts/release.ts <x.y.z> <notes.md> [--draft] [--no-build] [--no-account]");
  process.exit(1);
}
const notes = readFileSync(notesFile, "utf8").trim();

function run(cmd: string, cmdArgs: string[], env?: Record<string, string>) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Accounts are built in: without their settings nobody could sign in (#14).
if (!flags.has("--no-build")) requireAccountEnv(root, flags);

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
const setup = join(bundle, "nsis", `Polarity_${version}_x64-setup.exe`);
const msi = join(bundle, "msi", `Polarity_${version}_x64_en-US.msi`);
for (const f of [setup, `${setup}.sig`, msi, `${msi}.sig`]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. Was it built with createUpdaterArtifacts and a signing key?`);
    process.exit(1);
  }
}
// The bundled mpv.exe must be the build of this checkout's scripts/windows-mpv.lock, with the exact
// sources it was built from beside it (scripts/fetch-mpv.ts): those are attached to the release.
const mpv = vendoredMpvVersion(root);
if (mpv !== mpvVersion(root)) {
  console.error(
    mpv
      ? `src-tauri/vendor/mpv holds mpv build ${mpv}, not ${mpvVersion(root)}: delete src-tauri/vendor/mpv and build again.`
      : "src-tauri/vendor/mpv isn't a whole mpv build with its sources (empty stand-ins?): delete it and build again.",
  );
  process.exit(1);
}
const sourcesFrom = join(root, "src-tauri", "vendor", "mpv-sources", "polarity-windows-mpv-sources.tar");
const sources = join(bundle, `Polarity_${version}_x64_mpv-sources.tar`);
copyFileSync(sourcesFrom, sources);
// The player with its licence texts, for development builds without a signed-in gh (scripts/fetch-mpv.ts, #186).
const playerZip = join(bundle, `Polarity_${version}_x64_mpv.zip`);
rmSync(playerZip, { force: true });
const zipped = spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-cf", playerZip, "-C", join(root, "src-tauri", "vendor", "mpv"), "."], { stdio: "inherit" });
if (zipped.status !== 0) throw new Error("couldn't pack the player's zip");
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
const body = `Polarity for Windows (x64).

**Install:** download \`Polarity_${version}_x64-setup.exe\` (recommended) or the \`.msi\`. Already have Polarity 0.1.3 or later? It updates itself: you'll be asked to restart when it's ready.

### What's new
${notes}

mpv is bundled (GPLv2+, with FFmpeg and the libraries listed in \`licenses/mpv/BUNDLED.txt\`); its licences are installed under \`licenses/mpv\`, and the exact source code it was built from, with the build scripts, is \`Polarity_${version}_x64_mpv-sources.tar\` below.
`;
const bodyPath = join(bundle, "release-body.md");
writeFileSync(bodyPath, body);
run("gh", [
  "release", "create", `v${version}`,
  "-R", REPO,
  "--title", `"Polarity ${version}"`,
  "--notes-file", `"${bodyPath}"`,
  ...(flags.has("--draft") ? ["--draft"] : []),
  `"${setup}"`, `"${msi}"`, `"${feedPath}"`, `"${sources}"`, `"${playerZip}"`,
]);
console.log(`\nReleased Polarity ${version}. Commit the version bump: git commit -am "Release ${version}"`);
