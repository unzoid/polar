// Publishes what the Release workflow built (.github/workflows/release.yml):
// every installer in one GitHub release, plus the `latest.json` feed the
// in-app updater reads, covering each platform that was built.
//
//   bun scripts/release-publish.ts <x.y.z> <dir with the built files> [notes.md]
//
// The release is created as a draft: installed apps only see it once you
// press Publish on GitHub, so you can check the files and notes first.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = "unzoid/polarity";
const [version, dir, notesFile] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !dir) {
  console.error("Usage: bun scripts/release-publish.ts <x.y.z> <dir> [notes.md]");
  process.exit(1);
}
const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "";
const files = readdirSync(dir);
const find = (re: RegExp) => files.find((f) => re.test(f));

const download = (file: string) => `https://github.com/${REPO}/releases/download/v${version}/${file}`;
const entry = (file: string | undefined) => {
  if (!file || !files.includes(`${file}.sig`)) return undefined;
  return { signature: readFileSync(join(dir, `${file}.sig`), "utf8").trim(), url: download(file) };
};

// Updater entries: `{os}-{arch}` is the default, `{os}-{arch}-{installer}`
// lets a copy installed one way update the same way.
const nsis = entry(find(/_x64-setup\.exe$/));
const msi = entry(find(/_x64_en-US\.msi$/));
const mac = entry(find(/_aarch64\.app\.tar\.gz$/));
const appimage = entry(find(/_amd64\.AppImage$/));
const platforms: Record<string, { signature: string; url: string }> = {};
const add = (key: string, value: typeof nsis) => value && (platforms[key] = value);
add("windows-x86_64", nsis ?? msi);
add("windows-x86_64-nsis", nsis);
add("windows-x86_64-msi", msi);
add("darwin-aarch64", mac);
add("darwin-aarch64-app", mac);
add("linux-x86_64", appimage);
add("linux-x86_64-appimage", appimage);
if (!Object.keys(platforms).length) {
  console.error(`No signed installers in ${dir}: was TAURI_SIGNING_PRIVATE_KEY set for the build?`);
  process.exit(1);
}
const feedPath = join(dir, "latest.json");
writeFileSync(feedPath, JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2));

const line = (re: RegExp, text: (f: string) => string) => {
  const f = find(re);
  return f ? `- ${text(f)}` : null;
};
const install = [
  line(/_x64-setup\.exe$/, (f) => `**Windows:** \`${f}\` (recommended) or the \`.msi\`.`),
  line(/_aarch64\.dmg$/, (f) => `**macOS (Apple Silicon):** \`${f}\`. Not notarized yet: the first time, right-click Polarity in Applications and choose **Open**. If macOS says it's damaged, run \`xattr -cr /Applications/Polarity.app\`.`),
  line(/_amd64\.AppImage$/, (f) => `**Linux:** \`${f}\`, the \`.deb\` or the \`.rpm\`. Playback uses your system's mpv: the \`.deb\` and \`.rpm\` install it, for the AppImage install \`mpv\` with your package manager.`),
].filter(Boolean);

const body = `### Install
${install.join("\n")}

Already installed? Polarity updates itself and asks you to restart when it's ready.

### What's new
${notes || "_Add the notes before publishing._"}

mpv is bundled on Windows and macOS (GPLv2+). Its licences and source links are installed with the app under \`licenses/mpv\`.
`;
const bodyPath = join(dir, "release-body.md");
writeFileSync(bodyPath, body);

// Everything built, the .sig files and latest.json; not the body we just wrote.
const assets = readdirSync(dir).filter((f) => f !== "release-body.md");
const r = spawnSync(
  "gh",
  [
    "release", "create", `v${version}`,
    "-R", REPO,
    "--verify-tag",
    "--draft",
    "--title", `Polarity ${version}`,
    "--notes-file", bodyPath,
    ...assets.map((f) => join(dir, f)),
  ],
  { stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`Drafted Polarity ${version} with ${Object.keys(platforms).length} updater entries.`);
