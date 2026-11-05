import { Elysia } from "elysia";

const REPO = "unzoid/polarity";
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const TTL_MS = 10 * 60 * 1000;

export type Platform = "windows" | "macos" | "linux";

export type Installer = { label: string; url: string; size: number };

export type Release = {
  version: string;
  publishedAt: string | null;
  notes: string;
  /** Installers per platform, best choice first. Empty until a build ships. */
  platforms: Record<Platform, Installer[]>;
};

type GitHubRelease = {
  tag_name: string;
  published_at: string | null;
  html_url: string;
  assets: { name: string; browser_download_url: string; size: number }[];
};

/** Tauri's bundle names, in the order each platform should offer them. */
const KINDS: { platform: Platform; test: RegExp; label: string }[] = [
  { platform: "windows", test: /-setup\.exe$/i, label: "Installer (.exe)" },
  { platform: "windows", test: /\.msi$/i, label: "Windows Installer (.msi)" },
  { platform: "macos", test: /_(aarch64|arm64)\.dmg$/i, label: "Apple silicon (.dmg)" },
  { platform: "macos", test: /_(x64|x86_64)\.dmg$/i, label: "Intel (.dmg)" },
  { platform: "macos", test: /_universal\.dmg$/i, label: "Universal (.dmg)" },
  { platform: "linux", test: /\.AppImage$/i, label: "AppImage" },
  { platform: "linux", test: /\.deb$/i, label: "Debian / Ubuntu (.deb)" },
  { platform: "linux", test: /\.rpm$/i, label: "Fedora / openSUSE (.rpm)" },
];

function toRelease(gh: GitHubRelease): Release {
  const platforms: Release["platforms"] = { windows: [], macos: [], linux: [] };
  for (const kind of KINDS) {
    for (const asset of gh.assets) {
      if (kind.test.test(asset.name)) {
        platforms[kind.platform].push({ label: kind.label, url: asset.browser_download_url, size: asset.size });
      }
    }
  }
  return { version: gh.tag_name.replace(/^v/, ""), publishedAt: gh.published_at, notes: gh.html_url, platforms };
}

let cache: { at: number; release: Release } | null = null;

async function latestRelease(): Promise<Release | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.release;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "polarity-web" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const release = toRelease((await res.json()) as GitHubRelease);
    cache = { at: Date.now(), release };
    return release;
  } catch (error) {
    console.warn("[release] lookup failed:", error);
    // Serve a stale answer rather than nothing; GitHub rate limits are common.
    return cache?.release ?? null;
  }
}

export const app = new Elysia({ prefix: "/api" }).get("/release", async ({ set }) => {
  const release = await latestRelease();
  if (!release) {
    set.status = 503;
    return { error: "Release info is unavailable right now.", fallback: RELEASES_PAGE };
  }
  set.headers["cache-control"] = "public, max-age=300";
  return release;
});
