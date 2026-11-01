/**
 * Moves library and watch-progress changes between the active profile's
 * local space (Rust store) and the account backend. Local-first: the app
 * never waits on this; it reads and writes the local copy, and sync catches
 * up in the background.
 *
 * Runs when a profile is chosen, shortly after local changes, when the
 * window regains focus, and every few minutes.
 */
import { useSyncExternalStore } from "react";
import { api } from "../api";
import { queryClient } from "../queries";
import { backend } from "./index";

const PERIOD_MS = 5 * 60_000;
const AFTER_CHANGE_MS = 8_000;

export type SyncState = "off" | "idle" | "syncing" | "error";
interface Status {
  state: SyncState;
  lastSyncedAt: number | null;
  error: string | null;
}

let status: Status = { state: "off", lastSyncedAt: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Status>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};

let active: string | null = null;
let running: Promise<void> | null = null;
let again = false;
let pending: number | undefined;
let interval: number | undefined;

const onFocus = () => void run();

async function run(): Promise<void> {
  if (!active || !backend) return;
  if (running) {
    again = true;
    return running;
  }
  const space = active;
  set({ state: "syncing" });
  running = (async () => {
    try {
      const local = await api.syncChanges(space);
      if (local.library.length || local.progress.length) {
        await backend.sync.push(space, local);
      }
      await api.syncMarkPushed(space, local.cursor);

      const remote = await backend.sync.pull(space, local.pulledAt);
      if (space !== active) return; // switched profile mid-flight; its own run follows
      const changed = await api.syncApply(space, remote.library, remote.progress, remote.cursor);
      if (changed) refreshLocalViews();
      set({ state: "idle", lastSyncedAt: Date.now(), error: null });
    } catch (e) {
      set({ state: "error", error: e instanceof Error ? e.message : String(e) });
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

export function refreshLocalViews() {
  queryClient.invalidateQueries({ queryKey: ["library"] });
  queryClient.invalidateQueries({ queryKey: ["continue"] });
  queryClient.invalidateQueries({ queryKey: ["progress"] });
}

export const sync = {
  start(profileId: string) {
    sync.stop();
    active = profileId;
    set({ state: "idle", error: null });
    interval = window.setInterval(run, PERIOD_MS);
    window.addEventListener("focus", onFocus);
    return run();
  },
  stop() {
    active = null;
    window.clearInterval(interval);
    window.clearTimeout(pending);
    pending = undefined;
    window.removeEventListener("focus", onFocus);
    set({ state: "off", error: null });
  },
  /** Push soon. Repeated calls (e.g. progress saves while playing) coalesce. */
  schedule() {
    if (!active || pending !== undefined) return;
    pending = window.setTimeout(() => {
      pending = undefined;
      void run();
    }, AFTER_CHANGE_MS);
  },
  now: () => run(),
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

export function useSyncStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}
