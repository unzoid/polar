/**
 * What Discord shows while something plays (#31), as Settings → Playback → Show on Discord has it:
 * nothing ("off", the default), only that Polarity is in use ("app"), or the title with the season
 * and episode, the poster and the time left ("title"). The shell sends it to the Discord app on
 * this machine (src-tauri/src/discord.rs); without Discord, nothing happens.
 */

export type DiscordPresence = "off" | "app" | "title";

/** What the shell's `discord_presence` takes; null clears it. */
export interface DiscordActivity {
  details: string;
  state?: string;
  /** Unix ms. */
  start?: number;
  end?: number;
  image?: string;
  imageText?: string;
}

export interface Playing {
  name: string;
  poster?: string;
  /** A show's episode. */
  episode?: { season: number; episode: number; title?: string };
  paused: boolean;
  ended: boolean;
  /** Seconds. */
  current: number;
  duration: number;
  rate: number;
}

/** "S1 E5 · The Long Night"; specials (season 0) as "Special 3". */
const episodeLine = (e: NonNullable<Playing["episode"]>) => {
  const code = e.season === 0 ? `Special ${e.episode}` : `S${e.season} E${e.episode}`;
  const title = e.title?.trim();
  return title && !/^episode \d+$/i.test(title) ? `${code} · ${title}` : code;
};

export function discordActivity(mode: DiscordPresence, p: Playing | null, now = Date.now()): DiscordActivity | null {
  if (mode === "off" || !p || p.ended) return null;
  // While it plays: when it began (at this speed) and when it ends, so Discord counts down the time left.
  const rate = p.rate > 0 ? p.rate : 1;
  const times =
    !p.paused && p.duration > 0 && Number.isFinite(p.duration)
      ? { start: Math.round(now - (p.current * 1000) / rate), end: Math.round(now + ((p.duration - p.current) * 1000) / rate) }
      : {};
  if (mode === "app") return { details: "Watching", state: p.paused ? "Paused" : undefined, ...times };
  const lines = [p.episode && episodeLine(p.episode), p.paused && "Paused"].filter(Boolean);
  return {
    details: p.name,
    state: lines.length ? lines.join(" · ") : undefined,
    ...times,
    image: p.poster?.startsWith("https://") ? p.poster : undefined,
    imageText: p.poster ? p.name : undefined,
  };
}

/** How far the end time may drift (buffering, a speed mpv changed itself) before Discord is told again. */
const DRIFT_MS = 3000;

/** The same thing to Discord: the same lines and picture, and times within a few seconds. */
export function sameActivity(a: DiscordActivity | null, b: DiscordActivity | null) {
  if (!a || !b) return a === b;
  const near = (x?: number, y?: number) => (x === undefined || y === undefined ? x === y : Math.abs(x - y) < DRIFT_MS);
  return a.details === b.details && a.state === b.state && a.image === b.image && near(a.start, b.start) && near(a.end, b.end);
}
