/**
 * Moves the active profile's library, watch progress, anime links, playlists and settings
 * between this device (Rust store / localStorage) and the account backend.
 * Local-first: the app never waits on this; it reads and writes the local
 * copy, and sync catches up in the background. There's nothing to press:
 *
 * runs when a profile is chosen, a few seconds after local changes, when the
 * window regains focus or the network comes back, every few minutes, and
 * again shortly after a failure.
 */
import { api } from "../api";
import type { AnimeLink } from "../identity";
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
  unpushedPlaylists,
} from "../playlists";
import { keys } from "../queryKeys";
import { pushEach, pushSpace, unpushedCount, type PushDeps } from "./spacePush";

const PERIOD_MS = 3 * 60_000;
const AFTER_CHANGE_MS = 5_000;
const RETRY_MS = [15_000, 60_000, 5 * 60_000];

let active: string | null = null;
let running: Promise<void> | null = null;
let again = false;
let pending: number | undefined;
let interval: number | undefined;
let failures = 0;
/** The signed-in account's other profiles: their leftover changes go up in the background. */
let others: string[] = [];

const onWake = () => void run();

/**
 * Profiles whose anime links are waiting for a server that has the
 * anime_links table (a schema older than this app): kept across restarts,
 * since a link already pushed locally is never offered again.
 */
const UNSENT_KEY = "polar.animeLinksUnsent.v1";
const linksUnsent = new Set<string>(readUnsent());

function readUnsent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(UNSENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function setLinksUnsent(space: string, unsent: boolean) {
  if (linksUnsent.has(space) === unsent) return;
  if (unsent) linksUnsent.add(space);
  else linksUnsent.delete(space);
  localStorage.setItem(UNSENT_KEY, JSON.stringify([...linksUnsent]));
}

/** A profile's copy is gone from this device: its links no longer wait for anything. */
export const forgetLinksUnsent = (space: string) => setLinksUnsent(space, false);

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
      // Links the server couldn't take before go again in full once it can.
      const allLinks = linksUnsent.has(space) ? await api.animeLinks() : undefined;
      const { local } = await pushOne(space, allLinks);

      const remote = await backend.sync.pull(space, local.pulledAt);
      if (!isActive()) return; // switched profile mid-flight; its own run follows
      const changed = await api.syncApply(space, { library: remote.library, progress: remote.progress, links: remote.links }, remote.cursor);
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
      // Profiles left with changes the last time they were used (switched away offline).
      await pushEach(others.filter((s) => s !== active), (s) => pushOne(s));
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

const deps = (): PushDeps => ({
  changes: api.syncChanges,
  push: (space, changes) => backend!.sync.push(space, changes),
  markPushed: api.syncMarkPushed,
});

/** Push one space (no pull) and remember whether its links still wait for the server. */
async function pushOne(space: string, allLinks?: AnimeLink[]) {
  const result = await pushSpace(space, deps(), { allLinks, wasUnsent: linksUnsent.has(space) });
  setLinksUnsent(space, result.linksUnsent);
  return result;
}

/** Push one profile's changed playlists (no pull), shown or not. */
async function pushPlaylists(space: string) {
  const lists = playlistChanges(space);
  if (!lists.rows.length) return;
  await backend!.playlists.push(space, lists.rows);
  markPlaylistsPushed(space, lists.receipt);
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
  queryClient.invalidateQueries({ queryKey: keys.library });
  queryClient.invalidateQueries({ queryKey: keys.continue });
  queryClient.invalidateQueries({ queryKey: keys.history });
  queryClient.invalidateQueries({ queryKey: keys.progressAll });
  queryClient.invalidateQueries({ queryKey: keys.animeLinks });
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
  /** The account's profiles (all of them; the active one is skipped), for background pushes. */
  setProfiles(ids: string[]) {
    others = ids;
  },
  /**
   * Before every profile's copy is dropped (sign-out): flush the active profile, push each other
   * one and every profile's playlists, for at most `ms`, then count what still hasn't reached
   * the server.
   */
  async pushEverything(ids: string[], ms: number): Promise<number> {
    if (!backend) return 0;
    const all = (async () => {
      await sync.flush();
      await pushEach(ids.filter((s) => s !== active), (s) => pushOne(s));
      await pushEach(ids, pushPlaylists);
    })();
    await Promise.race([all, new Promise((r) => setTimeout(r, ms))]);
    const lists = ids.reduce((n, s) => n + unpushedPlaylists(s), 0);
    return lists + (await unpushedCount(ids, api.syncChanges));
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
