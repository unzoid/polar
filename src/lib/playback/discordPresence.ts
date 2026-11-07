/**
 * What Discord shows while something plays (#31), as Settings → Playback → Show on Discord has it:
 * nothing ("off"), only that Polarity is in use ("app", the default since #150), or the title with the season
 * and episode, the poster and the time left ("title"). The shell sends it to the Discord app on
 * this machine (src-tauri/src/discord.rs); without Discord, nothing happens.
 *
 * Others see up to two buttons on it (#153): "Watch in Polarity" (the same title, in their own
 * Polarity; "title" only, since "app" doesn't say what plays) and "Join watch party" (in a party
 * that can be joined from Discord, #154). Both link to the website's hand-over pages. Discord
 * builds the heading itself from the activity type and the application's name ("Watching
 * Polarity"); the closest an activity gets to "Watching on Polarity" is its first line.
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
  buttons?: { label: string; url: string }[];
}

/** The website pages behind the buttons; see lib/deepLink. */
export interface PresenceLinks {
  watch?: string;
  party?: string;
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

export function discordActivity(mode: DiscordPresence, p: Playing | null, now = Date.now(), links: PresenceLinks = {}): DiscordActivity | null {
  if (mode === "off" || !p || p.ended) return null;
  // While it plays: when it began (at this speed) and when it ends, so Discord counts down the time left.
  const rate = p.rate > 0 ? p.rate : 1;
  const times =
    !p.paused && p.duration > 0 && Number.isFinite(p.duration)
      ? { start: Math.round(now - (p.current * 1000) / rate), end: Math.round(now + ((p.duration - p.current) * 1000) / rate) }
      : {};
  const party = links.party ? [{ label: "Join watch party", url: links.party }] : [];
  if (mode === "app") return { details: "Watching on Polarity", state: p.paused ? "Paused" : undefined, ...times, ...withButtons(party) };
  const watch = links.watch ? [{ label: "Watch in Polarity", url: links.watch }] : [];
  const lines = [p.episode && episodeLine(p.episode), p.paused && "Paused"].filter(Boolean);
  return {
    details: p.name,
    state: lines.length ? lines.join(" · ") : undefined,
    ...times,
    ...(sharedPoster(p.poster) ? { image: p.poster, imageText: p.name } : {}),
    ...withButtons([...watch, ...party]),
  };
}

/**
 * Where a poster may come from to be shown on Discord: the art services Polarity itself reads.
 * Anyone viewing the profile can open the picture's link, and an add-on's own picture links may
 * carry its configuration (keys included) in the path, so those stay on this device.
 */
const POSTER_HOSTS = new Set(["image.tmdb.org", "images.metahub.space", "media.kitsu.app", "s4.anilist.co", "cdn.myanimelist.net", "artworks.thetvdb.com"]);

function sharedPoster(poster: string | undefined): poster is string {
  if (!poster) return false;
  try {
    const u = new URL(poster);
    return u.protocol === "https:" && POSTER_HOSTS.has(u.hostname) && !u.port && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

const withButtons = (buttons: NonNullable<DiscordActivity["buttons"]>) => (buttons.length ? { buttons } : {});

/** How far the end time may drift (buffering, a speed mpv changed itself) before Discord is told again. */
const DRIFT_MS = 3000;

/** The same thing to Discord: the same lines and picture, and times within a few seconds. */
export function sameActivity(a: DiscordActivity | null, b: DiscordActivity | null) {
  if (!a || !b) return a === b;
  const near = (x?: number, y?: number) => (x === undefined || y === undefined ? x === y : Math.abs(x - y) < DRIFT_MS);
  const urls = (x: DiscordActivity) => (x.buttons ?? []).map((b) => b.url).join(" ");
  return a.details === b.details && a.state === b.state && a.image === b.image && urls(a) === urls(b) && near(a.start, b.start) && near(a.end, b.end);
}
