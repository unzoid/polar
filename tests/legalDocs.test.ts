import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PRIVACY_URL, TERMS_URL } from "../src/lib/settings/legal";
import { SETTINGS } from "../src/lib/settings/schema";

// #157: PRIVACY.md and TERMS.md describe what the app does, and the app links to them.
const ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
// Line breaks as spaces: a phrase may wrap anywhere.
const flat = (path: string) => read(path).replace(/\s+/g, " ");
const privacy = flat("PRIVACY.md");
const terms = flat("TERMS.md");
const migrations = readdirSync(join(ROOT, "supabase/migrations"))
  .map((f) => read(`supabase/migrations/${f}`))
  .join("\n");

test("the app's links lead to the two files at the top of the repository", () => {
  for (const [url, file] of [
    [PRIVACY_URL, "PRIVACY.md"],
    [TERMS_URL, "TERMS.md"],
  ]) {
    expect(url).toBe(`https://github.com/unzoid/polarity/blob/master/${file}`);
    expect(existsSync(join(ROOT, file))).toBe(true);
  }
});

test("Settings → About and the sign-in screen show both links", () => {
  for (const screen of ["src/screens/settings/AboutPage.tsx", "src/screens/account/AuthScreen.tsx"]) {
    const source = read(screen);
    expect(source, screen).toContain("openExternal(PRIVACY_URL)");
    expect(source, screen).toContain("openExternal(TERMS_URL)");
  }
  const about = SETTINGS.filter((s) => s.page === "about").map((s) => s.title);
  expect(about).toContain("Privacy Policy");
  expect(about).toContain("Terms of Use");
});

test("both files give a contact address, and only the project's own on getpolar.app", () => {
  for (const text of [privacy, terms]) {
    const addresses = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(address.toLowerCase()).toMatch(/@getpolar\.app$/);
    expect(text).not.toContain("[contact email, to be added]");
  }
});

test("the settings the files send people to exist under those names", () => {
  const titles = SETTINGS.map((s) => `${s.page}:${s.title}`);
  for (const t of [
    "account:Delete account",
    "account:API keys and addons",
    "sources:Torrent upload limit",
    "sources:Keep sharing after playback",
    "playback:Show on Discord",
    "browsing:Remember recent searches",
  ]) {
    expect(titles).toContain(t);
  }
  expect(privacy).toContain("Settings → Account → Delete account");
  expect(terms).toContain("Keep sharing after playback");
});

test("the account limits in TERMS.md are the server's", () => {
  expect(migrations).toContain("An account can have up to 5 profiles.");
  expect(migrations).toContain("A profile can have up to 100 playlists.");
  expect(migrations).toMatch(/library\s+5,000 rows a profile, 10,000 an account/);
  expect(migrations).toMatch(/progress\s+5,000 rows a profile, 10,000 an account/);
  expect(migrations).toMatch(/anime_links\s+5,000 rows a profile/);
  expect(terms).toContain(
    "up to 5 profiles; each profile up to 5,000 library titles, 5,000 titles with watch progress, 5,000 anime links and 100 playlists; " +
      "an account up to 10,000 library titles and 10,000 titles with watch progress.",
  );
});

test("90-day clearing of removals, as PRIVACY.md says", () => {
  expect(migrations).toContain("Removals older than 90 days are purged to make room when a profile reaches");
  expect(privacy).toContain("markers older than 90 days are cleared when a profile reaches its size limit");
});

test("#245: no placeholder is left, and the filled-in values are there", () => {
  for (const text of [privacy, terms]) {
    expect(text).not.toMatch(/to fill in|to be added/i);
    expect(text).toContain("Last updated: 07/11/2026");
  }
  expect(privacy).toContain("Hosted in the EU: Supabase's eu-west-3 region (Paris, France).");
  expect(privacy).toContain("are kept for 1 day");
  expect(privacy).toContain("Backups of the account server are kept for 1 day");
});

test("#245: PRIVACY.md says what Android's system backup copies, and the keychain stays out of it", () => {
  expect(privacy).toContain("**Android's system backup:**");
  expect(privacy).toContain("It never copies your keys, add-on links or sign-ins");
  // What it promises: PolarKeys.kt writes the keychain to the no-backup folder.
  expect(read("src-tauri/gen/android/app/src/main/java/app/getpolar/desktop/PolarKeys.kt")).toContain("context.noBackupFilesDir");
});
