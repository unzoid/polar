// Builds the macOS app (Apple Silicon) with libmpv bundled and publishes it
// on GitHub as a pre-release, so the "Latest" release and its latest.json —
// what installed Windows copies update from — stay as they are.
//
//   bun scripts/release-mac.ts 0.16.0-beta.1 notes.md            build, then publish
//   bun scripts/release-mac.ts 0.16.0-beta.1 notes.md --draft    upload as a draft
//   bun scripts/release-mac.ts 0.16.0-beta.1 notes.md --no-build reuse what's in target/
//   bun scripts/release-mac.ts 0.16.0-beta.1 notes.md --no-account  build without accounts (no sign-in)
//
// Accounts need VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (environment
// or .env); without them and without --no-account the build stops.
//
// The version is set for this build only (the repo's version files aren't
// touched). Needs the updater key (~/.tauri/polar.key or TAURI_SIGNING_PRIVATE_KEY),
// Homebrew's mpv (brew install mpv) and a clean, pushed commit: the tag points at HEAD.
//
// The app is ad-hoc signed, not notarized: without an Apple Developer ID,
// people open it the first time with right-click → Open.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { requireAccountEnv } from "./accountEnv";
import { packMacSources } from "./macSources";

const REPO = "unzoid/polarity";
const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [version, notesFile] = args.filter((a) => !a.startsWith("--"));

if (process.platform !== "darwin" || !version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version) || !notesFile) {
  console.error("On a Mac: bun scripts/release-mac.ts <x.y.z[-pre]> <notes.md> [--draft] [--no-build] [--no-account]");
  process.exit(1);
}
const notes = readFileSync(notesFile, "utf8").trim();

function run(cmd: string, cmdArgs: string[], env?: Record<string, string>) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();

// The tag goes on HEAD, so HEAD must be what was built and must be on GitHub.
if (git("status", "--porcelain", "--untracked-files=no")) {
  console.error("Commit your changes first: the release is tagged at HEAD.");
  process.exit(1);
}
const head = git("rev-parse", "HEAD");
if (!git("branch", "-r", "--contains", head)) {
  console.error("Push HEAD first: GitHub needs the commit to tag it.");
  process.exit(1);
}

// Accounts are built in: without their settings nobody could sign in (#14).
if (!flags.has("--no-build")) requireAccountEnv(root, flags);

// 1. Build.
if (!flags.has("--no-build")) {
  const env: Record<string, string> = { CI: "true" }; // no Finder scripting for the DMG window
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    const keyPath = join(homedir(), ".tauri", "polar.key");
    if (!existsSync(keyPath)) {
      console.error(`No signing key: set TAURI_SIGNING_PRIVATE_KEY or put it at ${keyPath}`);
      process.exit(1);
    }
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8").trim();
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";
  }
  run("bun", ["scripts/bundle-libmpv.ts"]);
  run(
    "bunx",
    [
      "tauri", "build", "--bundles", "app,dmg",
      "-c", "src-tauri/vendor/libmpv/tauri.conf.json",
      "-c", JSON.stringify({ version, bundle: { macOS: { signingIdentity: "-" } } }),
    ],
    env,
  );
}

// 2. Publish.
const bundle = join(root, "target", "release", "bundle");
const dmg = join(bundle, "dmg", `Polarity_${version}_aarch64.dmg`);
const update = join(bundle, "macos", "Polarity.app.tar.gz");
const formulae = join(root, "src-tauri", "vendor", "libmpv", "formulae.json");
for (const f of [dmg, update, `${update}.sig`, formulae]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}.`);
    process.exit(1);
  }
}
// The exact source of mpv and every library bundled with it, attached to the release.
const sources = join(bundle, `Polarity_${version}_aarch64_mpv-sources.tar`);
console.log("> packing the bundled libraries' sources");
packMacSources(formulae, sources, join(bundle, "mpv-sources"));
const minos = (() => {
  const plist = join(bundle, "macos", "Polarity.app", "Contents", "Info.plist");
  return readFileSync(plist, "utf8").match(/LSMinimumSystemVersion<\/key>\s*<string>([^<]+)/)?.[1];
})();
const body = `Polarity for macOS (Apple Silicon${minos ? `, macOS ${minos} or later` : ""}). A preview of the Mac app.

**Install:** download \`Polarity_${version}_aarch64.dmg\`, open it and drag Polarity to Applications. The app isn't notarized yet, so the first time, right-click Polarity in Applications and choose **Open**, then **Open** again. If macOS still says it's damaged, run \`xattr -cr /Applications/Polarity.app\` in Terminal.

mpv is built in (no Homebrew needed).

### What's new
${notes}

mpv and its libraries are bundled (GPLv2+). Their licences are in \`Polarity.app/Contents/Resources/licenses/mpv\`; their exact source code, with Homebrew's build recipes, is \`Polarity_${version}_aarch64_mpv-sources.tar\` below.
`;
const bodyPath = join(bundle, "release-body-mac.md");
writeFileSync(bodyPath, body);
run("gh", [
  "release", "create", `v${version}`,
  "-R", REPO,
  "--target", head,
  "--title", `Polarity ${version} for Mac`,
  "--notes-file", bodyPath,
  "--prerelease",
  ...(flags.has("--draft") ? ["--draft"] : []),
  dmg, update, `${update}.sig`, sources,
]);
console.log(`\nPublished Polarity ${version} for Mac (pre-release).`);
