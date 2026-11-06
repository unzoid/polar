import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingAccountEnv } from "../scripts/accountEnv";

const dirs: string[] = [];
function project(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "polar-env-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const env = { PATH: "/usr/bin" };

test("#14: a release without the account settings is caught before it's built", () => {
  expect(missingAccountEnv(project({}), env)).toEqual(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  expect(missingAccountEnv(project({ ".env": "VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\n" }), env)).toHaveLength(2);
  expect(missingAccountEnv(project({ ".env.local": "VITE_SUPABASE_URL=https://db.example.com\n" }), env)).toEqual(["VITE_SUPABASE_PUBLISHABLE_KEY"]);
});

test("settings from .env files or the environment are enough, as Vite reads them", () => {
  const files = project({ ".env.production.local": "VITE_SUPABASE_URL=https://db.example.com\nVITE_SUPABASE_PUBLISHABLE_KEY=xxx\n" });
  expect(missingAccountEnv(files, env)).toEqual([]);
  const both = { ...env, VITE_SUPABASE_URL: "https://db.example.com", VITE_SUPABASE_PUBLISHABLE_KEY: "xxx" };
  expect(missingAccountEnv(project({}), both)).toEqual([]);
});
