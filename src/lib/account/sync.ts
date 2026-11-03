/**
 * Moves the active profile's library, watch progress, playlists and settings
 * between this device (Rust store / localStorage) and the account backend.
 * Local-first: the app never waits on this; it reads and writes the local
 * copy, and sync catches up in the background. There's nothing to press:
 *
 * runs when a profile is chosen, a few seconds after local changes, when the
 * window regains focus or the network comes back, every few minutes, and
 * again shortly after a failure.
 */
import { api } from "../api";
import { queryClient } from "../queries";
import { onSettingsChange } from "../settingsChanges";
import { backend } from "./index";
import { applying as applyingSettings, syncSettings } from "./settingsSync";
import {
  applyRemotePlaylists,
  markPlaylistsPushed,
  onPlaylistChange,
  playlistChanges,
  playlistsPulledAt,
  setPlaylistSpace,
} from "../playlists";

const PERIOD_MS = 3 * 60_000;
const AFTER_CHANGE_MS = 5_000;
const RETRY_MS = [15_000, 60_000, 5 * 60_000];

let active: string | null = null;
let running: Promise<void> | null = null;
let again = false;
let pending: number | undefined;
let interval: number | undefined;
let failures = 0;

const onWake = () => void run();

async function run(): Promise<void> {
  if (!active || !backend) return;
  if (running) {
    again = true;
    return running;
  }
  const space = active;
  const isActive = () => space === active;
  running = (async () => {
    try {
      const local = await api.syncChanges(space);
      if (local.library.length || local.progress.length) {
        await backend.sync.push(space, local);
      }
      await api.syncMarkPushed(space, local.cursor);

      const remote = await backend.sync.pull(space, local.pulledAt);
      if (!isActive()) return; // switched profile mid-flight; its own run follows
      const changed = await api.syncApply(space, remote.library, remote.progress, remote.cursor);
      if (changed) refreshLocalViews();

      const lists = playlistChanges();
      if (lists.space === space) {
        if (lists.rows.length) await backend.playlists.push(space, lists.rows);
        markPlaylistsPushed(space, lists.receipt);
        const pulled = await backend.playlists.pull(space, playlistsPulledAt(space));
        applyRemotePlaylists(space, pulled.playlists, pulled.cursor);
      }

      if (isActive()) await syncSettings(space, backend, isActive);
      failures = 0;
    } catch (e) {
      console.warn("sync failed", e);
      // Try again soon, then less often; focus and reconnecting also retry.
      if (isActive()) later(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void run();
    }
  });
  return running;
}

/** Run once after `ms`. Repeated calls (e.g. progress saves while playing) coalesce. */
function later(ms: number) {
  if (!active || pending !== undefined) return;
  pending = window.setTimeout(() => {
    pending = undefined;
    void run();
  }, ms);
}

export function refreshLocalViews() {
  queryClient.invalidateQueries({ queryKey: ["library"] });
  queryClient.invalidateQueries({ queryKey: ["continue"] });
  queryClient.invalidateQueries({ queryKey: ["history"] });
  queryClient.invalidateQueries({ queryKey: ["progress"] });
}

export const sync = {
  start(profileId: string) {
    sync.stop();
    active = profileId;
    failures = 0;
    setPlaylistSpace(profileId);
    interval = window.setInterval(run, PERIOD_MS);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    return run();
  },
  stop() {
    active = null;
    setPlaylistSpace(null);
    window.clearInterval(interval);
    window.clearTimeout(pending);
    pending = undefined;
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
  },
  /** Push soon after a local change. */
  schedule: () => later(AFTER_CHANGE_MS),
  /** Wait for in-flight work, then push whatever is left (before sign-out). */
  async flush() {
    window.clearTimeout(pending);
    pending = undefined;
    await run();
  },
  /** Flush, then stop, unless another profile started meanwhile. */
  async finish() {
    const was = active;
    await sync.flush();
    if (active === was) sync.stop();
  },
};

onPlaylistChange(() => sync.schedule());
onSettingsChange(() => {
  if (!applyingSettings) sync.schedule();
});
