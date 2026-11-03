// Downloads a pinned mpv build into src-tauri/vendor/mpv so the Windows
// installer can ship it next to polar.exe (player.rs looks there first).
// No-op when the files are already present. Run: bun scripts/fetch-mpv.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const TAG = "20261101";
const ARCHIVE = "mpv-x86_64-20261101-git-48fca90e8c.7z";
const SHA256 = "7a887a10b74c1a4a7e8c29ead8300cfc610c466c4686bf9dcb92ca2f224ba110";
const URL = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/${TAG}/${ARCHIVE}`;
const LICENSE_URL = "https://raw.githubusercontent.com/mpv-player/mpv/master/LICENSE.GPL";
const COPYRIGHT_URL = "https://raw.githubusercontent.com/mpv-player/mpv/master/Copyright";
const FILES = ["mpv.exe", "d3dcompiler_43.dll"];

const out = join(import.meta.dir, "..", "src-tauri", "vendor", "mpv");
const wanted = [...FILES, "LICENSE.GPL.txt", "COPYRIGHT.txt"];
if (wanted.every((f) => existsSync(join(out, f)))) process.exit(0);
// Only the Windows build ships mpv; on macOS the app uses an installed one (brew install mpv).
if (process.platform !== "win32") process.exit(0);

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

console.log(`Fetching mpv ${TAG}…`);
const archive = await get(URL);
const hash = createHash("sha256").update(archive).digest("hex");
if (hash !== SHA256) throw new Error(`mpv archive hash mismatch: ${hash}`);

mkdirSync(out, { recursive: true });
const tmp = join(tmpdir(), ARCHIVE);
writeFileSync(tmp, archive);
// Windows' built-in tar (bsdtar) reads .7z.
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "bsdtar";
const r = spawnSync(tar, ["-xf", tmp, "-C", out, ...FILES], { stdio: "inherit" });
rmSync(tmp, { force: true });
if (r.status !== 0) throw new Error("extracting mpv failed");

writeFileSync(join(out, "LICENSE.GPL.txt"), await get(LICENSE_URL));
writeFileSync(
  join(out, "COPYRIGHT.txt"),
  Buffer.concat([
    Buffer.from(`Bundled mpv build: ${URL}\nSource: https://github.com/mpv-player/mpv\nBuild scripts: https://github.com/shinchiro/mpv-winbuild-cmake\n\n`),
    await get(COPYRIGHT_URL),
  ]),
);
console.log("mpv ready in src-tauri/vendor/mpv");
