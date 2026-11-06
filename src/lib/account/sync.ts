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
import { queryClient } from "../net/queries";
import { onSettingsChange } from "../settings/changes";
import { backend } from ".";
import { noteAccountFull } from "./accountFull";
import { isLimit } from "./backend";
import { applying as applyingSettings, syncSettings } from "./settingsSync";
import {
  applyRemotePlaylists,
  markPlaylistsPushed,
  onPlaylistChange,
  playlistChanges,
  playlistsPulledAt,
  setPlaylistSpace,
  unpushedPlaylists,
} from "../library/playlists";
import { keys } from "../net/queryKeys";
import { pushEach, pushSpace, unpushedCount, type PushDeps } from "./spacePush";
import { fillUntitled, type DisplayDeps } from "./titleDisplay";

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

async function run(): Promise<void> {
  if (!active || !backend) return;
  if (running) {
    again = true;
    return running;
  }
  const space = active;
  const isActive = () => space === active;
  running = (async () => {
    // Each kind on its own (critique H4): playlists the server refuses don't hold back settings.
    const results = await Promise.allSettled([
      step("library and history", () => syncSpace(space, isActive)),
      step("playlists", () => syncPlaylists(space)),
      step("settings", () => syncSettings(space, backend!, isActive)),
    ]);
    void fillNames(space, isActive);
    // Profiles left with changes the last time they were used (switched away offline).
    await pushEach(others.filter((s) => s !== active), pushOne);
    for (const r of results) if (r.status === "rejected" && isLimit(r.reason)) noteAccountFull(r.reason);
    if (results.some((r) => r.status === "rejected")) {
      // Try again soon, then less often; focus and reconnecting also retry.
      if (isActive()) later(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
    } else failures = 0;
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void run();
    }
  });
  return running;
}

/** One part of a round; a failure is logged and makes the round try again later. */
async function step(what: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch (e) {
    console.warn(`sync: ${what} failed`, e);
    throw e;
  }
}

/** Library, progress and anime links: push what changed here, then pull and merge. */
async function syncSpace(space: string, isActive: () => boolean) {
  const local = await pushOne(space);
  const remote = await backend!.sync.pull(space, local.pulledAt);
  if (!isActive()) return; // switched profile mid-flight; its own run follows
  const changed = await api.syncApply(space, { library: remote.library, progress: remote.progress, links: remote.links }, remote.cursor);
  if (changed) refreshLocalViews();
  // A kind the account had no room for (#110): the rest went and came, the round reports it.
  if (local.full) throw local.full;
}

async function syncPlaylists(space: string) {
  const lists = playlistChanges();
  if (lists.space !== space) return;
  let full: unknown;
  try {
    if (lists.rows.length) await backend!.playlists.push(space, lists.rows);
    markPlaylistsPushed(space, lists.receipt);
  } catch (e) {
    // No room for more playlists (#110): what's on the server still comes down.
    if (!isLimit(e)) throw e;
    full = e;
  }
  const pulled = await backend!.playlists.pull(space, playlistsPulledAt(space));
  applyRemotePlaylists(space, pulled.playlists, pulled.cursor);
  if (full) throw full;
}

const displayDeps: DisplayDeps = { untitled: api.untitled, fill: api.fillDisplay, meta: api.meta };
/** Titles whose lookup failed this session: not asked for again every round. */
const lookupFailed = new Set<string>();
let filling = false;

/** Names and pictures for titles pulled without them (titleDisplay.ts), in the background. */
async function fillNames(space: string, isActive: () => boolean) {
  if (filling) return;
  filling = true;
  try {
    await fillUntitled(space, displayDeps, lookupFailed, isActive, refreshLocalViews);
  } catch (e) {
    console.warn("sync: could not look up titles", e);
  } finally {
    filling = false;
  }
}

const deps = (): PushDeps => ({
  changes: api.syncChanges,
  push: (space, changes) => backend!.sync.push(space, changes),
  markPushed: api.syncMarkPushed,
});

/** Push one space (no pull). */
const pushOne = (space: string) => pushSpace(space, deps());

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
      await pushEach(ids.filter((s) => s !== active), pushOne);
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
