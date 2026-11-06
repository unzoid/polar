/**
 * Torrent sources (#47): the user's limits as the backend takes them, and
 * the engine's steps (`polar_torrent::Step`) as lines for the loading screen.
 * The lines say nothing about what the torrent is: no names, no hash.
 */
import type { Prefs } from "../settings/prefs";
import type { StartStep } from "./startLog";
import { formatBytes, formatMs } from "./startLog";

/** Settings → Sources → Torrent Sources, as `torrent_open` and `torrent_close` take them. */
export interface TorrentLimits {
  cacheGb: number;
  downloadMbps: number;
  uploadMbps: number;
  keepSharing: boolean;
}

export const torrentLimits = (
  p: Pick<Prefs, "torrentCacheGb" | "torrentSpeedMbps" | "torrentUploadMbps" | "torrentKeepSharing">,
): TorrentLimits => ({
  cacheGb: p.torrentCacheGb,
  downloadMbps: p.torrentSpeedMbps,
  uploadMbps: p.torrentUploadMbps,
  keepSharing: p.torrentKeepSharing,
});

export type TorrentStep =
  | { kind: "searching"; trackers: number; dht: boolean }
  | { kind: "metadata"; files: number; chosen: number; ext?: string | null; size: number; ms: number }
  | { kind: "peers"; connected: number; connecting: number; downBps: number; have: number; size: number };

/** Peer lines replace each other while nothing else is logged in between. */
export const PEERS_KEY = "torrent-peers";

/** A line for one step; peer lines carry `key` so the next one replaces it. */
export function describeTorrent(step: TorrentStep): Omit<StartStep, "at"> & { key?: string } {
  switch (step.kind) {
    case "searching": {
      const where = [step.dht && "the DHT", step.trackers > 0 && `${step.trackers} tracker${step.trackers === 1 ? "" : "s"}`].filter(Boolean);
      return { text: `Looking for peers${where.length ? ` (${where.join(" and ")})` : ""}`, tone: "info", stage: "peers" };
    }
    case "metadata": {
      const file = [step.ext ? `.${step.ext}` : null, formatBytes(step.size)].filter(Boolean).join(", ");
      const which = step.files > 1 ? `file ${step.chosen} of ${step.files} (${file})` : file;
      return { text: `File list from peers${step.ms > 0 ? ` in ${formatMs(step.ms)}` : ""}: ${which}`, tone: "ok", stage: "peers" };
    }
    case "peers": {
      const parts = [`${step.connected} peer${step.connected === 1 ? "" : "s"} connected`];
      if (step.connecting > 0) parts.push(`${step.connecting} connecting`);
      parts.push(`${formatBytes(step.downBps)}/s`, `${formatBytes(step.have)} of ${formatBytes(step.size)}`);
      return { text: parts.join(" · "), tone: step.connected > 0 ? "info" : "warn", stage: "peers", key: PEERS_KEY };
    }
  }
}
