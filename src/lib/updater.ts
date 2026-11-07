import { useSyncExternalStore } from "react";
import { appUpdates, type FoundUpdate } from "./platform/updates";
import { inShell } from "./platform/bridge";
import { isRecord, str, storedJson } from "./parse";
import { errorMessage } from "./errors";
import { getPrefs } from "./settings/prefs";

/**
 * App updates, from the signed `latest.json` on the newest GitHub release.
 *
 * Checked a few seconds after launch and then every few hours. With
 * "Download updates automatically" on (the default) a new build downloads in
 * the background and the user only has to restart; otherwise they're told
 * it exists and choose when to download it. Installing never happens on its own.
 */
export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current"; checkedAt: number }
  | { phase: "available"; version: string; notes: string }
  | { phase: "downloading"; version: string; notes: string; progress: number | null }
  | { phase: "ready"; version: string; notes: string }
  | { phase: "installing"; version: string }
  | { phase: "error"; message: string };

const RELEASES = "https://github.com/unzoid/polarity/releases";
export const releaseUrl = (version?: string) => (version ? `${RELEASES}/tag/v${version}` : RELEASES);

let state: UpdateState = { phase: "idle" };
let update: FoundUpdate | null = null;
/** The toast was closed for this version; the navbar pill stays. */
let dismissed: string | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useUpdate = () => useSyncExternalStore(subscribe, () => state);
export const useUpdateDismissed = () => useSyncExternalStore(subscribe, () => dismissed);
export function dismissUpdate() {
  dismissed = "version" in state ? state.version : null;
  listeners.forEach((l) => l());
}

export async function checkForUpdates({ quiet = false } = {}) {
  if (!inShell || !appUpdates.canUpdate) return;
  // Already found one: nothing newer is worth interrupting a download for.
  if (state.phase === "checking" || state.phase === "downloading" || state.phase === "ready" || state.phase === "installing") return;
  if (!quiet) set({ phase: "checking" });
  try {
    const found = await appUpdates.check();
    if (!found) {
      update = null;
      set({ phase: "current", checkedAt: Date.now() });
      return;
    }
    update = found;
    const info = { version: found.version, notes: found.notes };
    set({ phase: "available", ...info });
    if (getPrefs().autoDownloadUpdates) void downloadUpdate();
  } catch (e) {
    // Offline, or no release feed yet: a background check stays silent.
    if (!quiet) set({ phase: "error", message: describe(e) });
  }
}

export async function downloadUpdate() {
  if (!update || state.phase !== "available") return;
  const { version, notes } = state;
  set({ phase: "downloading", version, notes, progress: null });
  try {
    await update.download((got, total) => {
      if (total) set({ phase: "downloading", version, notes, progress: Math.min(1, got / total) });
    });
    set({ phase: "ready", version, notes });
  } catch (e) {
    set({ phase: "error", message: describe(e) });
  }
}

/** Installs the downloaded build and starts it again. On Windows the installer closes the app itself. */
export async function installUpdate() {
  if (!update || state.phase !== "ready") return;
  const { version, notes } = state;
  rememberNotes(version, notes);
  set({ phase: "installing", version });
  try {
    await update.install();
    await appUpdates.relaunch();
  } catch (e) {
    set({ phase: "error", message: describe(e) });
  }
}

function describe(e: unknown) {
  const s = errorMessage(e);
  if (/network|dns|connect|timed out|offline/i.test(s)) return "Couldn't reach the update server. Check your connection.";
  return s;
}

let started = false;
/** Called once from the app root. */
export function startUpdateChecks() {
  if (started || !inShell || !appUpdates.canUpdate) return;
  started = true;
  window.setTimeout(() => void checkForUpdates({ quiet: true }), 5_000);
  window.setInterval(() => void checkForUpdates({ quiet: true }), 6 * 60 * 60 * 1000);
}

// --- What's new ----------------------------------------------------------------

const LAST_VERSION = "polar.lastVersion";
const PENDING_NOTES = "polar.updateNotes";

function rememberNotes(version: string, notes: string) {
  try {
    localStorage.setItem(PENDING_NOTES, JSON.stringify({ version, notes }));
  } catch {}
}

export type WhatsNew = { version: string; previous: string; notes: string };

/**
 * After an update (from the app or a fresh installer over an old build), the
 * notes for the version now running, once. A first install shows nothing:
 * there's nothing "new" to someone who has never seen the app.
 */
export async function takeWhatsNew(): Promise<WhatsNew | null> {
  if (!inShell) return null;
  const version = await appUpdates.version();
  const previous = localStorage.getItem(LAST_VERSION);
  localStorage.setItem(LAST_VERSION, version);
  if (!previous || compareVersions(version, previous) <= 0) return null;

  let notes = "";
  const saved = storedJson(localStorage, PENDING_NOTES);
  if (isRecord(saved) && saved.version === version) notes = str(saved.notes) ?? "";
  localStorage.removeItem(PENDING_NOTES);
  // Installed by hand: ask GitHub for the release's notes.
  if (!notes) {
    try {
      const res = await fetch(`https://api.github.com/repos/unzoid/polarity/releases/tags/v${version}`);
      if (res.ok) {
        const release: unknown = await res.json();
        notes = releaseNotesSection((isRecord(release) && str(release.body)) || "");
      }
    } catch {}
  }
  return { version, previous, notes };
}

/** A release body has install instructions on top; keep the "What's new" part if it's marked. */
function releaseNotesSection(body: string) {
  const m = body.match(/#+\s*What's new\s*\n([\s\S]*?)(?=\n#+\s|\n\s*mpv is still bundled|$)/i);
  return (m ? m[1] : body).trim();
}

export function compareVersions(a: string, b: string) {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export const appVersion = () => (inShell ? appUpdates.version() : Promise.resolve("dev"));
