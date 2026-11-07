// Puts the mpv.exe the Windows app bundles into src-tauri/vendor/mpv (player.rs looks there first,
// tauri.windows.conf.json bundles it with its licence texts) and the exact sources it was built
// from into src-tauri/vendor/mpv-sources (release.ts attaches them to the release).
//
// Both come from the workflow windows-mpv.yml (scripts/windows-mpv.sh), which builds them once per
// version of that script and scripts/windows-mpv.lock and keeps them as the artifact
// windows-mpv-<version> (~545 MB: most of it is the source archive), plus windows-mpv-bin-<version>
// with only the player and its licence texts. Downloaded here with the GitHub CLI (gh, signed in),
// with its size and progress shown. Or from a build of your own: --from <its out folder>. No-op when
// vendor/mpv already holds this version, and off Windows (macOS bundles libmpv with
// scripts/bundle-libmpv.ts).
//
// --dev (tauri dev, #186): a build already in vendor/mpv will do, even an older one, as long as it
// has every file tauri.windows.conf.json bundles (the Rust build fails without them). Otherwise only
// the player is fetched, not the source archive. Builds and releases still pin the version and take both.
// Without CI's copy (gh missing or signed out, the artifact expired), a dev run takes the player the
// newest release attaches (Polarity_<version>_x64_mpv.zip, public, no sign-in), even an older build.
//
//   bun scripts/fetch-mpv.ts [--from <dir>] [--dev]
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mpvVersion, vendoredMpvVersion } from "./windowsMpv";

const REPO = "unzoid/polarity";
const root = join(import.meta.dir, "..");
const vendor = join(root, "src-tauri", "vendor");
const args = process.argv.slice(2);
const dev = args.includes("--dev");
const fromAt = args.indexOf("--from");
let from = fromAt >= 0 ? args[fromAt + 1] : undefined;
if (fromAt >= 0 && !from) fail("--from needs the out folder of a scripts/windows-mpv.sh build");

/** A clear message and a non-zero exit, instead of a stack trace. */
function fail(message: string): never {
  console.error(`\nfetch-mpv: ${message}\n`);
  process.exit(1);
}

/** Whether everything tauri.windows.conf.json bundles from vendor/ is there. */
function bundledFilesPresent(): boolean {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.windows.conf.json"), "utf8"));
  const resources: string[] = Object.keys(conf.bundle?.resources ?? {}).filter((p) => p.startsWith("vendor/"));
  return resources.length > 0 && resources.every((p) => existsSync(join(root, "src-tauri", p)));
}

if (process.platform !== "win32" && !from) process.exit(0);
if (dev && !from && bundledFilesPresent()) process.exit(0);
const version = mpvVersion(root);
if (vendoredMpvVersion(root) === version) process.exit(0);
// CI's Windows test builds have put this version's build or empty stand-ins there (scripts/vendor-mpv.sh).
if (process.env.CI && existsSync(join(vendor, "mpv", "mpv.exe"))) process.exit(0);

const SIGN_IN =
  "The Windows player comes from CI and needs the GitHub CLI, installed and signed in: https://cli.github.com, then `gh auth login`. " +
  "Or build it yourself with scripts/windows-mpv.sh and pass --from <its out folder>.";

/** Why CI's copy couldn't be had (gh missing or signed out, the artifact expired): a dev run tries a release's copy then. */
class Unavailable extends Error {}

function gh(ghArgs: string[]): string {
  // No shell: gh is an executable, and the --jq filter must reach it whole.
  const r = spawnSync("gh", ghArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) throw new Unavailable(`the GitHub CLI (gh) isn't installed or isn't on PATH. ${SIGN_IN}`);
  if (r.status !== 0) throw new Unavailable(`gh ${ghArgs[0]} failed: ${r.stderr.trim() || "no output"}\n${SIGN_IN}`);
  return r.stdout.trim();
}

type Artifact = { id: number; size: number };
function newestArtifact(name: string): Artifact | undefined {
  const line = gh(["api", `repos/${REPO}/actions/artifacts?name=${name}&per_page=20`, "--jq", '.artifacts[] | select(.expired | not) | "\\(.id) \\(.size_in_bytes)"'])
    .split("\n")
    .find(Boolean);
  if (!line) return undefined;
  const [id, size] = line.split(" ").map(Number);
  return { id, size };
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** A line every few seconds while a download runs (gh run download prints nothing). */
function progress(size: number, got: () => number) {
  return setInterval(() => {
    const pct = size ? ` (${Math.min(99, Math.floor((got() / size) * 100))}%)` : "";
    console.log(`  ${mb(got())} of ${mb(size)}${pct}…`);
  }, 3000);
}

/** Streams an artifact's zip to `file`, with its progress. */
function downloadZip(artifact: Artifact, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(file);
    const child = spawn("gh", ["api", `repos/${REPO}/actions/artifacts/${artifact.id}/zip`], { stdio: ["ignore", "pipe", "pipe"] });
    let got = 0;
    let err = "";
    const tick = progress(artifact.size, () => got);
    child.stdout.on("data", (chunk: Buffer) => {
      got += chunk.length;
      out.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => (err += chunk));
    child.on("error", () => {
      clearInterval(tick);
      reject(new Unavailable(`the GitHub CLI (gh) isn't installed or isn't on PATH. ${SIGN_IN}`));
    });
    child.on("close", (code) => {
      clearInterval(tick);
      const failed = new Unavailable(`downloading the player failed: ${err.trim() || `gh exited with ${code}`}\n${SIGN_IN}`);
      out.end(() => (code === 0 ? resolve() : reject(failed)));
    });
  });
}

/** The player attached to the newest published release (`Polarity_<version>_x64_mpv.zip`): public, no sign-in. */
async function releasedPlayer(): Promise<{ name: string; url: string; size: number } | undefined> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } }).catch(() => undefined);
  if (!r?.ok) return undefined;
  const release = (await r.json()) as { assets?: { name: string; browser_download_url: string; size: number }[] };
  const asset = release.assets?.find((a) => /_x64_mpv\.zip$/.test(a.name));
  return asset && { name: asset.name, url: asset.browser_download_url, size: asset.size };
}

/** Downloads a public file to `file`, with its progress. */
async function downloadPublic(url: string, size: number, file: string): Promise<void> {
  const r = await fetch(url).catch(() => undefined);
  if (!r?.ok || !r.body) fail(`downloading ${url} failed${r ? ` (HTTP ${r.status})` : ""}`);
  const out = createWriteStream(file);
  let got = 0;
  const tick = progress(size, () => got);
  try {
    for await (const chunk of r.body) {
      got += chunk.length;
      out.write(chunk);
    }
  } finally {
    clearInterval(tick);
  }
  await new Promise<void>((resolve) => out.end(resolve));
}

/** Windows' own tar (bsdtar) reads zips; Git Bash's GNU tar, earlier on PATH there, doesn't. */
function unzip(file: string, into: string) {
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const r = spawnSync(tar, ["-xf", file, "-C", into], { stdio: "inherit" });
  if (r.status !== 0) fail(`couldn't unpack ${file}`);
}

/** This version's player (and, unless `dev`, its sources) from CI, unpacked into `into`. */
async function fromCi(into: string) {
  // A dev build needs only the player: its own artifact skips the ~400 MB source archive.
  // (Builds before that artifact existed only have the full one.)
  const full = `windows-mpv-${version}`;
  const bin = `windows-mpv-bin-${version}`;
  let name = dev ? bin : full;
  let artifact = newestArtifact(name);
  if (!artifact && dev) artifact = newestArtifact((name = full));
  if (!artifact) {
    throw new Unavailable(
      `CI hasn't built ${full} (or it expired): wait for the workflow windows-mpv.yml on a commit with this scripts/windows-mpv.lock, ` +
        "or build it with scripts/windows-mpv.sh and pass --from <its out folder>",
    );
  }
  console.log(`Downloading the Windows player (mpv ${version}, ${mb(artifact.size)}) from CI. This can take a few minutes; it's kept for later runs.`);
  const zip = join(into, `${name}.zip`);
  await downloadZip(artifact, zip);
  unzip(zip, into);
  rmSync(zip, { force: true });
}

/** A dev build without CI's copy: the newest release's player, which may be an older mpv build. */
async function fromRelease(into: string, why: string) {
  const asset = await releasedPlayer();
  if (!asset) fail(`${why}\n\nNo published release has the player (Polarity_<version>_x64_mpv.zip) to fall back on either.`);
  console.log(`CI's copy of the Windows player isn't available here: ${why.split("\n")[0]}`);
  console.log(`Downloading it from the newest release instead (${asset.name}, ${mb(asset.size)}), no sign-in needed. It's kept for later runs.`);
  const zip = join(into, asset.name);
  await downloadPublic(asset.url, asset.size, zip);
  unzip(zip, into);
  rmSync(zip, { force: true });
}

let download: string | undefined;
let released = false;
if (!from) {
  download = mkdtempSync(join(tmpdir(), "polarity-mpv-"));
  try {
    await fromCi(download);
  } catch (e) {
    if (!(e instanceof Unavailable)) throw e;
    // Builds and releases need this exact version and its sources: only CI has them.
    if (!dev) fail(e.message);
    await fromRelease(download, e.message);
    released = true;
  }
  from = download;
}

// The full artifact holds mpv/ and the source archive; the player-only one (and a release's zip) holds mpv/'s files at its top.
const player = existsSync(join(from, "mpv", "VERSION")) ? join(from, "mpv") : from;
const sources = join(from, "polarity-windows-mpv-sources.tar");
if (!existsSync(join(player, "VERSION"))) fail(`${from} doesn't hold an mpv build (no mpv/VERSION)`);
const built = readFileSync(join(player, "VERSION"), "utf8").trim();
// A release's player may be an older build: fine to run the app with, never to build one.
if (built !== version && !released) fail(`${from} holds mpv build ${built}, not ${version} (scripts/windows-mpv.sh and its lock)`);
if (built !== version) console.log(`That release has mpv build ${built}, not ${version}: fine for development; builds and releases fetch ${version}.`);
if (!dev && !existsSync(sources)) fail(`${from} has no polarity-windows-mpv-sources.tar, which builds and releases attach`);

rmSync(join(vendor, "mpv"), { recursive: true, force: true });
mkdirSync(join(vendor, "mpv"), { recursive: true });
for (const f of readdirSync(player)) if (f !== "polarity-windows-mpv-sources.tar") copyFileSync(join(player, f), join(vendor, "mpv", f));
if (existsSync(sources)) {
  rmSync(join(vendor, "mpv-sources"), { recursive: true, force: true });
  mkdirSync(join(vendor, "mpv-sources"), { recursive: true });
  copyFileSync(sources, join(vendor, "mpv-sources", "polarity-windows-mpv-sources.tar"));
}
if (download) rmSync(download, { recursive: true, force: true });
console.log(`mpv ${version} ready in src-tauri/vendor/mpv`);
