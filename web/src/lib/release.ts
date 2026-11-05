import { createResource, createRoot } from "solid-js";
import type { Platform, Release } from "../../server/app";

export type { Platform, Installer } from "../../server/app";

export const RELEASES_PAGE = "https://github.com/unzoid/polarity/releases/latest";
export const DOWNLOAD_PAGE = "/download/";

export const PLATFORM_NAMES: Record<Platform, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

async function fetchRelease(): Promise<Release | null> {
  try {
    const res = await fetch("/api/release");
    return res.ok ? ((await res.json()) as Release) : null;
  } catch {
    return null;
  }
}

// One shared request for every download button on the page.
export const release = createRoot(() => createResource(fetchRelease)[0]);

function detectPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return "macos";
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}

/** The visitor's desktop platform, or null on phones and unknown systems. */
export const platform = detectPlatform();

/** Best installer for the visitor's platform, if one has shipped. */
export const primaryInstaller = () => (platform ? release()?.platforms[platform][0] : undefined);

export function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
