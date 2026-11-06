// The version of the Windows app's mpv.exe: a hash of scripts/windows-mpv.sh and its lock, the
// same as the workflows compute (`cat … | tr -d '\r' | sha256sum | cut -c1-16`), so a Windows checkout's
// line endings don't change it. The build writes it to out/mpv/VERSION.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function mpvVersion(root: string): string {
  const both = Buffer.concat([join(root, "scripts", "windows-mpv.sh"), join(root, "scripts", "windows-mpv.lock")].map((f) => readFileSync(f)));
  return createHash("sha256")
    .update(both.filter((b) => b !== 13))
    .digest("hex")
    .slice(0, 16);
}

/** The version in src-tauri/vendor/mpv, when it holds a whole build with its sources beside it. */
export function vendoredMpvVersion(root: string): string | undefined {
  const vendor = join(root, "src-tauri", "vendor");
  const stamp = join(vendor, "mpv", "VERSION");
  if (!existsSync(stamp) || !existsSync(join(vendor, "mpv", "mpv.exe"))) return undefined;
  if (!existsSync(join(vendor, "mpv-sources", "polarity-windows-mpv-sources.tar"))) return undefined;
  return readFileSync(stamp, "utf8").trim();
}
