import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mpvVersion, vendoredMpvVersion } from "../scripts/windowsMpv";

const repo = join(import.meta.dir, "..");

function checkout(crlf: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "windows-mpv-"));
  mkdirSync(join(root, "scripts"));
  for (const f of ["windows-mpv.sh", "windows-mpv.lock"]) {
    const text = readFileSync(join(repo, "scripts", f), "utf8");
    writeFileSync(join(root, "scripts", f), crlf ? text.replaceAll("\n", "\r\n") : text);
  }
  return root;
}

describe("Windows mpv version", () => {
  test("is what CI computes, whatever the line endings", () => {
    const lf = checkout(false);
    const crlf = checkout(true);
    // The workflows' step, on the repository's own files.
    const ci = spawnSync("bash", ["-c", "cat scripts/windows-mpv.sh scripts/windows-mpv.lock | tr -d '\\r' | sha256sum | cut -c1-16"], {
      cwd: repo,
      encoding: "utf8",
    }).stdout.trim();
    expect(ci).toMatch(/^[0-9a-f]{16}$/);
    expect(mpvVersion(lf)).toBe(ci);
    expect(mpvVersion(crlf)).toBe(ci);
    rmSync(lf, { recursive: true });
    rmSync(crlf, { recursive: true });
  });

  test("of the vendored build only when mpv.exe and its sources are both there", () => {
    const root = checkout(false);
    const vendor = join(root, "src-tauri", "vendor");
    expect(vendoredMpvVersion(root)).toBeUndefined();
    mkdirSync(join(vendor, "mpv"), { recursive: true });
    writeFileSync(join(vendor, "mpv", "mpv.exe"), ""); // a stand-in has no VERSION
    expect(vendoredMpvVersion(root)).toBeUndefined();
    writeFileSync(join(vendor, "mpv", "VERSION"), "0123456789abcdef\n");
    expect(vendoredMpvVersion(root)).toBeUndefined();
    mkdirSync(join(vendor, "mpv-sources"));
    writeFileSync(join(vendor, "mpv-sources", "polarity-windows-mpv-sources.tar"), "");
    expect(vendoredMpvVersion(root)).toBe("0123456789abcdef");
    rmSync(root, { recursive: true });
  });
});
