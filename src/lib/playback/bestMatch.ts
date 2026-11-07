import { langMatches, languageName } from "./languages";
import type { RankedStream, ScoreReason } from "../types";

/**
 * "Best Match" (#230): one score per source, relative to the other sources for the
 * title, this device, this connection and what played before, with every point
 * explained ("+35 1080p on a 1080p screen", "−10 2.1 Mbps is low for 1080p").
 * The add-on side only says what a file is (crates/addon's rank.rs); every weight
 * is here, in WEIGHTS.
 */

/** Every point the score gives or takes. */
export const WEIGHTS = {
  /** The picture's height. */
  resolution: { 2160: 40, 1440: 37, 1080: 35, 720: 22, below: 10, unknown: 15 },
  /** Taller than this screen shows (with Settings → Sources' "prefer this screen"). */
  overScreen: -8,
  /** A link the player opens as is. */
  direct: 10,
  cam: -100,
  /** The file's name says it's another episode: never at the top. */
  otherEpisode: -200,

  // Bitrate: size ÷ runtime. Size alone never costs points.
  /** Below the least a file of its height needs to look right (BITRATE_FLOOR). */
  bitrateLow: -10,
  /** Under half the middle bitrate of the other files of its height. */
  bitrateBelowOthers: -4,
  /** At least 1.3× that middle bitrate, and the connection carries it: a better picture. */
  bitrateAboveOthers: 3,
  /** More than the connection has carried (≥ 90 % of it): it would stall. */
  connectionTooSlow: -15,
  /** Over 60 % of the connection: a slow start, stalls on a bad evening. */
  connectionTight: -5,

  // The device.
  hdr: 2,
  dolbyVision: 3,
  /** Dolby Vision without an HDR10 layer, on a device that can't show Dolby Vision: wrong colours. */
  dolbyVisionUnsupported: -10,
  /** HEVC or AV1 decoded by the hardware: smaller for the same picture. */
  efficientCodec: 1,
  /** HEVC or AV1 this device decodes in software: hot, and it may drop frames. 4K doubles it. */
  softwareDecode: -6,

  // The user's preferences (Settings → Subtitles & Audio, Sources, Anime).
  audioLanguage: 8,
  /** Multi-audio: usually has it, but doesn't say. */
  audioMulti: 5,
  /** Each preferred tag (Remux, Atmos, 10-bit…) it has. */
  preferredTag: 3,
  /** The first preferred release group, then each next one less, never below the last. */
  preferredGroup: [12, 9, 6, 3],

  // What happened before on this device (sourceHistory.ts), per add-on and per release group.
  /** Times the share of tries that failed, once it was tried MIN_TRIES times. */
  failRate: -12,
  /** Times the share of starts that played through. */
  playedThrough: 4,
  /** Failed just now, fading out over RECENT_FAIL_HOURS. */
  recentFail: -15,
  /** Took longer than SLOW_START_MS to start, on average. */
  slowStart: -3,
} as const;

export type Factor = keyof typeof WEIGHTS;

/**
 * Each factor's row in a source's info (#274), in WEIGHTS' order: every source gets every row,
 * "n/a" and 0 where the factor doesn't apply. The row's input is what scoreOne says about the
 * source ("1080p on a 1080p screen"), its points what it gave. tests/bestMatch.test.ts fails when
 * a factor here has no row.
 */
export const FACTOR_LABELS: Record<Factor, string> = {
  resolution: "Resolution",
  overScreen: "Bigger than the screen",
  direct: "Direct link",
  cam: "CAM or telesync",
  otherEpisode: "Another episode",
  bitrateLow: "Bitrate for its resolution",
  bitrateBelowOthers: "Bitrate under the others",
  bitrateAboveOthers: "Bitrate above the others",
  connectionTooSlow: "More than the connection carries",
  connectionTight: "Close to the connection's limit",
  hdr: "HDR",
  dolbyVision: "Dolby Vision",
  dolbyVisionUnsupported: "Dolby Vision this device can't show",
  efficientCodec: "Hardware decoding",
  softwareDecode: "Software decoding",
  audioLanguage: "Audio language",
  audioMulti: "Multi-audio",
  preferredTag: "Preferred tags",
  preferredGroup: "Preferred release group",
  failRate: "Failed here before",
  playedThrough: "Played through here before",
  recentFail: "Failed recently",
  slowStart: "Slow to start here",
};

/** Mbps below which a file of each height is a re-encode squeezed too small. */
export const BITRATE_FLOOR: Record<number, number> = { 2160: 8, 1440: 4, 1080: 2.5, 720: 1.2, 0: 0.6 };
export const MIN_TRIES = 2;
export const RECENT_FAIL_HOURS = 24;
export const SLOW_START_MS = 10_000;

/** What this device can show and decode; `null` = couldn't tell (no points either way). */
export interface Device {
  /** The display's height as a video resolution (sources.ts' screenResolution). */
  screen: number;
  /** Settings → Sources: no bigger picture than the screen first. */
  preferScreen: boolean;
  hdr: boolean | null;
  dolbyVision: boolean | null;
  hevc: boolean | null;
  av1: boolean | null;
}

/** How a kind of source has done on this device (sourceHistory.ts). */
export interface SourceRecord {
  tries: number;
  starts: number;
  fails: number;
  /** Starts that played to the end (or near it). */
  through: number;
  /** Sum over `starts` of how long each took to show a picture. */
  startMs: number;
  /** When it last failed (ms since the epoch). */
  lastFail?: number;
}

export interface MatchContext {
  device: Device;
  /** What this connection has carried while playing, in Mbps. */
  connectionMbps: number | null;
  /** The title's (or episode's) length: bitrate = size ÷ runtime. */
  runtimeSec: number | null;
  /** Settings → Subtitles & Audio's audio language ("" = the file's own). */
  audioLanguage: string;
  /** Settings → Sources' tags (sources.ts' TAG_LABELS keys). */
  preferredTags: string[];
  /** Settings → Anime's release groups, most preferred first. */
  preferredGroups: string[];
  history: (kind: "addon" | "group", name: string) => SourceRecord | undefined;
  now: number;
}

/** One row of a source's score table: `input` null where the factor doesn't apply. */
export interface FactorRow {
  factor: Factor;
  label: string;
  input: string | null;
  points: number;
}

export interface Match {
  score: number;
  reasons: ScoreReason[];
  /** Every factor in WEIGHTS, in order; their points add up to `score`. */
  factors: FactorRow[];
  /** Where the score puts it in the list it was scored with (ties share a place); only from scoreSources. */
  rank?: { position: number; of: number };
}

/** No device, connection, preferences or history known: only what the files say. */
export const NEUTRAL: MatchContext = {
  device: { screen: 2160, preferScreen: false, hdr: null, dolbyVision: null, hevc: null, av1: null },
  connectionMbps: null,
  runtimeSec: null,
  audioLanguage: "",
  preferredTags: [],
  preferredGroups: [],
  history: () => undefined,
  now: 0,
};

const resName = (r: number) => (r >= 2160 ? "4K" : `${r}p`);
const mbps = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10} Mbps`;
/** The bucket a file's bitrate is compared in. */
const bucket = (r: RankedStream) => {
  const h = r.quality.resolution ?? 0;
  return h >= 2160 ? 2160 : h >= 1440 ? 1440 : h >= 1080 ? 1080 : h >= 720 ? 720 : 0;
};
/** Megabits per second, from the size and the runtime; null when either is unknown. */
export function bitrateMbps(r: RankedStream, runtimeSec: number | null): number | null {
  const size = r.quality.sizeBytes;
  if (!size || !runtimeSec || runtimeSec < 60) return null;
  return (size * 8) / runtimeSec / 1e6;
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const groupKey = (g: string) => g.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const groupTags = (r: RankedStream) => {
  const q = r.quality;
  const t = (q.tags ?? []).map((x) => x.toLowerCase());
  if (q.dolbyVision) t.push("dv");
  if (q.hdr) t.push("hdr");
  if (q.codec) t.push(q.codec.toLowerCase());
  return t;
};
const TAG_NAMES: Record<string, string> = { dv: "Dolby Vision", hdr: "HDR", "hdr10+": "HDR10+", remux: "Remux", atmos: "Atmos", hevc: "HEVC", "10-bit": "10-bit" };

/** Each source's score and its reasons, the list taken together (bitrates compare within it). */
export function scoreSources(streams: RankedStream[], ctx: MatchContext = NEUTRAL): Map<RankedStream, Match> {
  const rates = new Map<number, number[]>();
  for (const r of streams) {
    const b = bitrateMbps(r, ctx.runtimeSec);
    if (b != null && !r.quality.lowQualitySource) rates.set(bucket(r), [...(rates.get(bucket(r)) ?? []), b]);
  }
  // Fewer than three files of a height with a known size aren't much to compare with.
  const middle = new Map([...rates].filter(([, xs]) => xs.length >= 3).map(([k, xs]) => [k, median(xs)]));
  const scored = streams.map((r) => [r, scoreOne(r, ctx, middle.get(bucket(r)) ?? null)] as const);
  const of = scored.length;
  return new Map(scored.map(([r, m]) => [r, { ...m, rank: { position: 1 + scored.filter(([, o]) => o.score > m.score).length, of } }]));
}

/** One source's score; `middle` is the middle bitrate of the other files of its height, when there are enough. */
export function scoreOne(r: RankedStream, ctx: MatchContext = NEUTRAL, middle: number | null = null): Match {
  const W = WEIGHTS;
  const q = r.quality;
  const d = ctx.device;
  const reasons: ScoreReason[] = [];
  const by = new Map<Factor, ScoreReason[]>();
  const add = (factor: Factor, reason: string, points: number) => {
    if (!points) return;
    const x = { reason, points: Math.round(points * 10) / 10 };
    reasons.push(x);
    by.set(factor, [...(by.get(factor) ?? []), x]);
  };

  // The picture.
  const h = q.resolution;
  const onScreen = d.preferScreen ? ` on a ${resName(d.screen)} screen` : "";
  if (h == null) add("resolution", "Unknown resolution", W.resolution.unknown);
  else if (h >= 2160) add("resolution", `4K${onScreen}`, W.resolution[2160]);
  else if (h >= 1440) add("resolution", `1440p${onScreen}`, W.resolution[1440]);
  else if (h >= 1080) add("resolution", `1080p${onScreen}`, W.resolution[1080]);
  else if (h >= 720) add("resolution", `720p${onScreen}`, W.resolution[720]);
  else add("resolution", "Below 720p", W.resolution.below);
  if (d.preferScreen && d.screen < 1300 && (h ?? 0) > Math.max(d.screen, 1080)) add("overScreen", "Bigger than this screen shows", W.overScreen);
  if (q.direct) add("direct", "Direct link", W.direct);
  if (q.lowQualitySource) add("cam", "CAM or telesync", W.cam);
  if (r.otherEpisode) add("otherEpisode", `The file says ${r.fileEpisode ?? "another episode"}`, W.otherEpisode);

  // Bitrate, against the others of its height and the connection.
  const rate = bitrateMbps(r, ctx.runtimeSec);
  if (rate != null && !q.lowQualitySource) {
    const b = bucket(r);
    const fits = ctx.connectionMbps == null || rate < ctx.connectionMbps * 0.6;
    if (rate < BITRATE_FLOOR[b]) add("bitrateLow", `${mbps(rate)} is low for ${b ? resName(b) : "its size"}`, W.bitrateLow);
    else if (middle != null && rate < middle * 0.5) add("bitrateBelowOthers", `${mbps(rate)}, under half the other ${b ? resName(b) : "small"} files' ${mbps(middle)}`, W.bitrateBelowOthers);
    else if (middle != null && rate >= middle * 1.3 && fits) add("bitrateAboveOthers", `${mbps(rate)}, more detail than the other ${b ? resName(b) : "small"} files' ${mbps(middle)}`, W.bitrateAboveOthers);
    if (ctx.connectionMbps != null) {
      if (rate >= ctx.connectionMbps * 0.9) add("connectionTooSlow", `${mbps(rate)} is more than this connection carries (${mbps(ctx.connectionMbps)})`, W.connectionTooSlow);
      else if (rate >= ctx.connectionMbps * 0.6) add("connectionTight", `${mbps(rate)} is close to this connection's ${mbps(ctx.connectionMbps)}`, W.connectionTight);
    }
  }

  // The device.
  if (q.dolbyVision && !q.hdr && d.dolbyVision === false) add("dolbyVisionUnsupported", "Dolby Vision only, which this device can't show", W.dolbyVisionUnsupported);
  else if (q.dolbyVision && d.hdr && d.dolbyVision) add("dolbyVision", "Dolby Vision on an HDR screen", W.dolbyVision);
  else if ((q.hdr || q.dolbyVision) && d.hdr) add("hdr", "HDR on an HDR screen", W.hdr);
  const codec = q.codec === "HEVC" ? d.hevc : q.codec === "AV1" ? d.av1 : undefined;
  if (codec === true) add("efficientCodec", `${q.codec}, decoded by this device's hardware`, W.efficientCodec);
  else if (codec === false) add("softwareDecode", `${q.codec} without hardware decoding here`, W.softwareDecode * ((h ?? 0) >= 2160 ? 2 : 1));

  // Preferences.
  const pref = ctx.audioLanguage;
  if (pref) {
    const langs = q.languages ?? [];
    if (langs.some((l) => langMatches(l, pref))) add("audioLanguage", `Audio in ${languageName(pref) ?? pref}, your language`, W.audioLanguage);
    else if (langs.includes("multi")) add("audioMulti", "Multi-audio, may have your language", W.audioMulti);
  }
  const tags = groupTags(r);
  for (const t of ctx.preferredTags) if (tags.includes(t)) add("preferredTag", `${TAG_NAMES[t] ?? t}, which you prefer`, W.preferredTag);
  const group = q.source ? ctx.preferredGroups.findIndex((g) => groupKey(g) === groupKey(q.source!)) : -1;
  if (group >= 0) add("preferredGroup", `${q.source}, a release group you prefer`, W.preferredGroup[Math.min(group, W.preferredGroup.length - 1)]);

  // What happened before.
  const seen: [string, SourceRecord | undefined][] = [
    ["Add-on", ctx.history("addon", r.addon)],
    ["Release group", q.source ? ctx.history("group", q.source) : undefined],
  ];
  let lastFail = 0;
  for (const [who, rec] of seen) {
    if (!rec) continue;
    if (rec.tries >= MIN_TRIES && rec.fails) add("failRate", `${who} failed ${rec.fails} of ${rec.tries} times here`, W.failRate * (rec.fails / rec.tries));
    if (rec.starts >= MIN_TRIES && rec.through) add("playedThrough", `${who} played through ${rec.through} of ${rec.starts} times here`, W.playedThrough * (rec.through / rec.starts));
    if (rec.starts >= MIN_TRIES && rec.startMs / rec.starts > SLOW_START_MS)
      add("slowStart", `${who} takes ${Math.round(rec.startMs / rec.starts / 1000)} s to start here`, W.slowStart);
    lastFail = Math.max(lastFail, rec.lastFail ?? 0);
  }
  const hours = (ctx.now - lastFail) / 3_600_000;
  if (lastFail && hours >= 0 && hours < RECENT_FAIL_HOURS)
    add("recentFail", `Failed here ${hours < 1 ? "within the hour" : `${Math.floor(hours)} h ago`}`, W.recentFail * (1 - hours / RECENT_FAIL_HOURS));

  const total = (xs: ScoreReason[]) => Math.round(xs.reduce((n, x) => n + x.points, 0) * 10) / 10;
  const factors = (Object.keys(W) as Factor[]).map((factor) => {
    const xs = by.get(factor) ?? [];
    return { factor, label: FACTOR_LABELS[factor], input: xs.length ? xs.map((x) => x.reason).join("; ") : null, points: total(xs) };
  });
  return { score: total(reasons), reasons, factors };
}
