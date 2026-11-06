// Puts the mpv.exe the Windows app bundles into src-tauri/vendor/mpv (player.rs looks there first,
// tauri.windows.conf.json bundles it with its licence texts) and the exact sources it was built
// from into src-tauri/vendor/mpv-sources (release.ts attaches them to the release).
//
// Both come from the workflow windows-mpv.yml (scripts/windows-mpv.sh), which builds them once per
// version of that script and scripts/windows-mpv.lock and keeps them as the artifact
// windows-mpv-<version>, downloaded here with the GitHub CLI (gh, signed in). Or from a build of
// your own: --from <its out folder>. No-op when vendor/mpv already holds this version, and off
// Windows (macOS bundles libmpv with scripts/bundle-libmpv.ts).
//
// --dev (tauri dev): an older build already in vendor/mpv will do, so the dev server isn't held up by
// a half-gigabyte download, as long as it has every file tauri.windows.conf.json bundles (the build
// fails without them); otherwise it's fetched. Builds and releases still pin the version.
//
//   bun scripts/fetch-mpv.ts [--from <dir>] [--dev]
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { mpvVersion, vendoredMpvVersion } from "./windowsMpv";

const REPO = "unzoid/polarity";
const root = join(import.meta.dir, "..");
const vendor = join(root, "src-tauri", "vendor");
const args = process.argv.slice(2);
const fromAt = args.indexOf("--from");
let from = fromAt >= 0 ? args[fromAt + 1] : undefined;
if (fromAt >= 0 && !from) throw new Error("--from needs the out folder of a scripts/windows-mpv.sh build");

if (process.platform !== "win32" && !from) process.exit(0);
if (args.includes("--dev") && !from && bundledFilesPresent()) process.exit(0);

/** Whether everything tauri.windows.conf.json bundles from vendor/ is there. */
function bundledFilesPresent(): boolean {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.windows.conf.json"), "utf8"));
  const resources: string[] = Object.keys(conf.bundle?.resources ?? {}).filter((p) => p.startsWith("vendor/"));
  return resources.length > 0 && resources.every((p) => existsSync(join(root, "src-tauri", p)));
}
const version = mpvVersion(root);
if (vendoredMpvVersion(root) === version) process.exit(0);
// CI's Windows test builds have put this version's build or empty stand-ins there (scripts/vendor-mpv.sh).
if (process.env.CI && existsSync(join(vendor, "mpv", "mpv.exe"))) process.exit(0);

function gh(ghArgs: string[]): string {
  // No shell: gh is an executable, and the --jq filter must reach it whole.
  const r = spawnSync("gh", ghArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.error || r.status !== 0) throw new Error(`gh ${ghArgs.join(" ")} failed: is the GitHub CLI installed and signed in (gh auth login)?`);
  return r.stdout.trim();
}

let download: string | undefined;
if (!from) {
  const name = `windows-mpv-${version}`;
  console.log(`Fetching ${name} from CI…`);
  const run = gh(["api", `repos/${REPO}/actions/artifacts?name=${name}&per_page=20`, "--jq", ".artifacts[] | select(.expired | not) | .workflow_run.id"]).split(
    "\n",
  )[0];
  if (!run) {
    throw new Error(
      `CI hasn't built ${name} (or it expired): wait for the workflow windows-mpv.yml on a commit with this scripts/windows-mpv.lock, ` +
        "or build it with scripts/windows-mpv.sh and pass --from <its out folder>",
    );
  }
  download = mkdtempSync(join(tmpdir(), "polarity-mpv-"));
  gh(["run", "download", run, "-R", REPO, "-n", name, "-D", download]);
  from = download;
}

const built = readFileSync(join(from, "mpv", "VERSION"), "utf8").trim();
if (built !== version) throw new Error(`${from} holds mpv build ${built}, not ${version} (scripts/windows-mpv.sh and its lock)`);
rmSync(join(vendor, "mpv"), { recursive: true, force: true });
rmSync(join(vendor, "mpv-sources"), { recursive: true, force: true });
mkdirSync(join(vendor, "mpv"), { recursive: true });
mkdirSync(join(vendor, "mpv-sources"), { recursive: true });
for (const f of readdirSync(join(from, "mpv"))) copyFileSync(join(from, "mpv", f), join(vendor, "mpv", f));
copyFileSync(join(from, "polarity-windows-mpv-sources.tar"), join(vendor, "mpv-sources", "polarity-windows-mpv-sources.tar"));
if (download) rmSync(download, { recursive: true, force: true });
console.log(`mpv ${version} ready in src-tauri/vendor/mpv`);
