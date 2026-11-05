// The account backend is chosen at build time (src/lib/account/index.ts): a
// build without these settings has no sign-in at all. The release scripts
// check them first, so a release can't go out without accounts by accident.
import { loadEnv } from "vite";

const KEYS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

/** Which account settings a production build of `root` would miss, read as Vite reads them (.env files, the environment winning). */
export function missingAccountEnv(root: string, env: Record<string, string | undefined> = process.env): string[] {
  const files = loadEnv("production", root, "VITE_SUPABASE_");
  return KEYS.filter((k) => !(env[k] ?? files[k])?.trim());
}

/** Stops a release build that would have no sign-in, unless `--no-account` asks for one. */
export function requireAccountEnv(root: string, flags: Set<string>) {
  if (flags.has("--no-account")) return;
  const missing = missingAccountEnv(root);
  if (!missing.length) return;
  console.error(
    `${missing.join(" and ")} not set (environment or .env): this build would have no sign-in, and guests couldn't sign in.\n` +
      "Set them, or pass --no-account to build without accounts on purpose.",
  );
  process.exit(1);
}
