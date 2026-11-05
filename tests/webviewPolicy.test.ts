import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// docs/ARCHITECTURE.md §1: the web view may only reach the hosts its own code fetches; everything else goes through Rust.
const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
const connect: string[] = conf.app.security.csp["connect-src"].split(/\s+/);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Hosts named on lines that fetch, or in the constants those calls use. */
function fetchedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const f of files(SRC)) {
    if (f.includes(`${join("lib", "platform", "fake")}`)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!/fetch\(|ENDPOINT =|_URL =/i.test(line)) continue;
      for (const m of line.matchAll(/https:\/\/([a-z0-9.-]+)/g)) hosts.add(m[1]);
    }
  }
  return hosts;
}

const allowed = (host: string) =>
  connect.some((src) => {
    const m = /^https:\/\/(\*\.)?([a-z0-9.-]+)$/.exec(src);
    return !!m && (m[1] ? host.endsWith(`.${m[2]}`) : host === m[2]);
  });

test("connect-src names every host the front end fetches", () => {
  const hosts = [...fetchedHosts()];
  expect(hosts.length).toBeGreaterThan(3);
  expect(hosts.filter((h) => !allowed(h))).toEqual([]);
});

test("connect-src has no catch-all schemes or loopback ports", () => {
  expect(connect.filter((s) => /^(https?|wss?):$/.test(s) || /127\.0\.0\.1|localhost:/.test(s))).toEqual([]);
});

test("the web view can't open URLs or reveal files by itself", () => {
  const dir = join(ROOT, "src-tauri", "capabilities");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const cap = JSON.parse(readFileSync(join(dir, file), "utf8"));
    expect(cap.permissions.filter((p: string) => p.startsWith("opener:") || p.startsWith("fs:") || p.startsWith("shell:"))).toEqual([]);
  }
});
