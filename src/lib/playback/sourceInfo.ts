/**
 * Everything a source carries, for the "i" panel on a source row (#229): the
 * add-on's stream object as it came, which add-on and which request brought
 * it, what Polarity made of it (quality, score and why, the filters that would
 * hide it) and, for the playing source, what the player reports.
 *
 * Add-on links and stream URLs often carry keys and tokens, so every value is
 * masked before it's shown or copied: credentials in a link, every query
 * value, path segments that look like a key or a config, header values. Only
 * the scheme, the host and the shape of the path are kept. There's no way to
 * switch it off.
 */
import { formatBytes } from "../format";
import { isKitsuId } from "../anime/kitsu";
import { languageLabel, matches, NO_FILTER, SORTS, TAG_LABELS, tagsOf, type SourceFilter } from "./sources";
import { scoreOne, type Match } from "./bestMatch";
import type { RankedStream, SourceSort } from "../types";

/** What a masked value shows instead. */
export const MASK = "•••";

// --- Masking ---------------------------------------------------------------

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;
const HOME_RE = /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[^\s/\\"']+/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A run of key-ish characters; release names break into short words at dots, dashes and underscores. */
const RUN_RE = /[A-Za-z0-9+/=~%]{16,}/g;
/** Words that name a secret: the value after one is one. */
const SECRET_WORD = /^(?:api[-_]?key|apikey|key|token|access[-_]?token|auth|authorization|secret|password|passwd|pass|pwd|session|sid|sig|signature|credentials?|bearer|cookie)$/i;
const KEY_VALUE_RE = /\b(api[-_]?key|apikey|key|token|access[-_]?token|auth|authorization|secret|password|passwd|pass|pwd|session|sid|sig|signature|credentials?|bearer|cookie)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;"']+)/gi;

/** Whether one run of characters (no dots, dashes or underscores in it) reads like a key rather than a word. */
function keyLike(run: string) {
  if (run.length >= 24) return true;
  if (/^[0-9a-f]{16,}$/i.test(run)) return true;
  return /\d/.test(run) && /[A-Za-z]/.test(run);
}

/** Whether a path segment or bare value looks like a key, a token or an add-on's config. */
export function looksSecret(text: string): boolean {
  let t = text;
  try {
    t = decodeURIComponent(text);
  } catch {
    // Left as it is: a stray % is still looked at.
  }
  if (/[{}]/.test(t) || /%7B/i.test(text)) return true;
  UUID_RE.lastIndex = 0;
  if (UUID_RE.test(t)) return true;
  return (t.match(RUN_RE) ?? []).some(keyLike);
}

/** A kept path segment as it reads ("Película.mkv", not "Pel%C3%ADcula.mkv"). */
function readable(seg: string) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** Hosts on this computer or the user's own network aren't shown either. */
function hostLabel(u: URL) {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "this-computer";
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  const lan = v4
    ? (([a, b]) => a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254))([Number(v4[1]), Number(v4[2])])
    : /^(fc|fd|fe[89ab])[0-9a-f]*:/i.test(host) || /\.(local|lan|home|internal)$/i.test(host);
  if (lan) return "a-device-on-your-network";
  return u.port ? `${u.hostname}:${u.port}` : u.hostname;
}

/**
 * A link as the panel shows it: scheme and host, the path with every segment
 * that looks like a key, a token or a config replaced by •••, query keys with
 * their values masked, no credentials and no fragment.
 */
export function maskUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return MASK;
  }
  if (u.protocol === "file:") return "file://~/" + MASK;
  const segments = u.pathname.split("/");
  const path = segments
    .map((seg, i) => (seg && (looksSecret(seg) || (i > 0 && SECRET_WORD.test(segments[i - 1]))) ? MASK : readable(seg)))
    .join("/");
  const query = [...u.searchParams.keys()].map((k) => `${looksSecret(k) ? MASK : k}=${MASK}`);
  const creds = u.username || u.password ? `${MASK}@` : "";
  // Opaque links (magnet:, data:) have no host: nothing of them is kept.
  if (!u.host) return `${u.protocol}${MASK}`;
  return `${u.protocol}//${creds}${hostLabel(u)}${path}${query.length ? `?${[...new Set(query)].join("&")}` : ""}${u.hash ? `#${MASK}` : ""}`;
}

/** Free text (a name, a description, a hint's value) with links, keys and home folders masked. */
export function maskText(text: string): string {
  return text
    .replace(URL_RE, (u) => maskUrl(u))
    .replace(KEY_VALUE_RE, (_, k: string, sep: string) => `${k}${sep}${MASK}`)
    .replace(HOME_RE, "~")
    .replace(UUID_RE, MASK)
    .replace(RUN_RE, (run) => (keyLike(run) && !run.includes(MASK) ? MASK : run));
}

// --- What the panel shows ----------------------------------------------------

export interface InfoRow {
  label: string;
  value: string;
}

export interface InfoSection {
  title: string;
  rows: InfoRow[];
}

/** What the player reports about the playing file (mpv's properties, or the built-in player's few). */
export interface PlayingReport {
  container?: string;
  videoCodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  /** Bits per second. */
  videoBitrate?: number;
  audioBitrate?: number;
  tracks?: { type: "video" | "audio" | "sub"; lang?: string; title?: string; codec?: string; selected?: boolean; channels?: number }[];
}

export interface SourceInfoContext {
  /** The list's filters, to say which of them would hide this source. */
  filter?: SourceFilter;
  sort?: SourceSort;
  /** Best Match's score and reasons for this source, as the list worked them out (useSourceFilters' `match`). */
  match?: Match;
  /** Only for the playing source. */
  playing?: PlayingReport;
}

const row = (label: string, value: unknown): InfoRow | null =>
  value == null || value === "" || (Array.isArray(value) && !value.length) ? null : { label, value: String(value) };

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(Math.round(n * 10) / 10)}`;

/** "tt0000000:1:5" → "IMDb tt0000000, season 1, episode 5"; "kitsu:12:5" → "Kitsu 12, episode 5". */
export function describeRequest(id: string): string {
  const parts = id.split(":");
  if (isKitsuId(id)) return [`Kitsu ${parts[1]}`, parts[2] && `episode ${parts[2]}`].filter(Boolean).join(", ");
  if (/^tt\d+$/.test(parts[0])) return [`IMDb ${parts[0]}`, parts[1] && `season ${parts[1]}`, parts[2] && `episode ${parts[2]}`].filter(Boolean).join(", ");
  return id;
}

/** The add-on's `behaviorHints`, each as a row: header values masked, everything else as text. */
function hintRows(hints: Record<string, unknown> | undefined): InfoRow[] {
  if (!hints) return [];
  const rows: InfoRow[] = [];
  for (const [key, value] of Object.entries(hints)) {
    if (key === "proxyHeaders" && value && typeof value === "object") {
      for (const [side, headers] of Object.entries(value as Record<string, unknown>)) {
        if (!headers || typeof headers !== "object") continue;
        for (const name of Object.keys(headers)) rows.push({ label: `${side === "response" ? "Response" : "Request"} header ${maskText(name)}`, value: MASK });
      }
      continue;
    }
    if (key === "videoSize" && typeof value === "number") {
      rows.push({ label: "videoSize", value: `${formatBytes(value)} (${value} bytes)` });
      continue;
    }
    // Anything nested (an add-on's own hints) is shown by its keys only: there's no telling what's in it.
    const text = value && typeof value === "object" ? `{ ${Object.keys(value).join(", ")} }` : String(value);
    rows.push({ label: key, value: text });
  }
  return rows;
}

/** Which of the list's filters (each on its own) would leave this source out. */
function hiddenBy(r: RankedStream, f: SourceFilter): string[] {
  const only = (patch: Partial<SourceFilter>) => !matches(r, { ...NO_FILTER, ...patch });
  const out: string[] = [];
  if (f.addon && only({ addon: f.addon })) out.push(`Add-on: ${f.addon}`);
  if (f.res && only({ res: f.res })) out.push("Resolution");
  if (f.lang && only({ lang: f.lang })) out.push(`Audio: ${languageLabel(f.lang)}`);
  if (f.size && only({ size: f.size })) out.push(`Size: ${f.size[0]}–${f.size[1]} GB`);
  if (f.source && only({ source: f.source })) out.push(`Release group: ${f.source}`);
  const has = tagsOf(r);
  for (const t of f.tags) if (!has.includes(t)) out.push(`Tag: ${TAG_LABELS[t] ?? t}`);
  return out;
}

function scoreRows(r: RankedStream, ctx: SourceInfoContext): InfoRow[] {
  // Without the list's (a source made in the app), only what the file says.
  const { score, reasons } = ctx.match ?? scoreOne(r);
  const sorted = ctx.sort && ctx.sort !== "best" ? ` (list sorted by ${SORTS[ctx.sort]})` : "";
  return [{ label: "Score", value: `${Math.round(score * 10) / 10}${sorted}` }, ...reasons.map((x) => ({ label: x.reason, value: signed(x.points) }))];
}

const kbps = (bps?: number) => (bps ? `${Math.round(bps / 1000)} kb/s` : null);

function playingRows(p: PlayingReport): InfoRow[] {
  const rows = [
    row("Container", p.container),
    row("Video codec", p.videoCodec),
    row("Resolution", p.width && p.height ? `${p.width}×${p.height}` : null),
    row("Frame rate", p.fps ? `${Math.round(p.fps * 1000) / 1000} fps` : null),
    row("Video bitrate", kbps(p.videoBitrate)),
    row("Audio bitrate", kbps(p.audioBitrate)),
  ];
  const kind = { video: "Video track", audio: "Audio track", sub: "Subtitle track" } as const;
  for (const t of p.tracks ?? []) {
    const what = [t.lang && languageLabel(t.lang), t.title, t.codec, t.channels && `${t.channels} ch`, t.selected && "playing"].filter(Boolean).join(" · ");
    rows.push(row(kind[t.type], what || "—"));
  }
  return rows.filter((x): x is InfoRow => !!x);
}

/** The panel's sections, every value already masked. */
export function sourceInfo(r: RankedStream, ctx: SourceInfoContext = {}): InfoSection[] {
  const s = r.stream;
  const q = r.quality;
  const sections: InfoSection[] = [
    {
      title: "From the Add-on",
      rows: [
        row("Name", s.name),
        row("Title", s.title),
        row("Description", s.description),
        row("URL", s.url && maskUrl(s.url)),
        row("External URL", s.externalUrl && maskUrl(s.externalUrl)),
        row("YouTube id", s.ytId),
        row("Info hash", s.infoHash),
        row("File index", s.fileIdx),
        ...hintRows(s.behaviorHints),
      ].filter((x): x is InfoRow => !!x),
    },
    {
      title: "Where It Came From",
      rows: [row("Add-on", r.addon), row("Asked by", r.requestId ? `${describeRequest(r.requestId)} (${r.requestId})` : "Not recorded")].filter(
        (x): x is InfoRow => !!x,
      ),
    },
    {
      title: "What Polarity Made of It",
      rows: [
        row("Resolution", q.resolution ? (q.resolution === 2160 ? "4K (2160p)" : `${q.resolution}p`) : "Unknown"),
        row("HDR", q.dolbyVision ? "Dolby Vision" : q.hdr ? "HDR" : null),
        row("Codec", q.codec),
        row("Size", q.sizeBytes ? formatBytes(q.sizeBytes) : null),
        row("Audio languages", q.languages?.length ? q.languages.map(languageLabel).join(", ") : "Not stated"),
        row("Tags", q.tags?.join(", ")),
        row("Release group", q.source),
        row("Link", q.direct ? "Direct, the player opens it as is" : null),
        row("CAM or telesync", q.lowQualitySource ? "Yes, never picked by itself" : null),
        row("File says", r.fileEpisode),
        row("Another episode", r.otherEpisode ? "Yes, listed last and never picked by itself" : null),
        ...scoreRows(r, ctx),
        row("Hidden by", ctx.filter ? hiddenBy(r, ctx.filter).join(", ") || "Nothing, it matches the filters" : null),
      ].filter((x): x is InfoRow => !!x),
    },
  ];
  if (ctx.playing) sections.push({ title: "What the Player Reports", rows: playingRows(ctx.playing) });
  return sections
    .filter((sec) => sec.rows.length)
    .map((sec) => ({
      ...sec,
      // An info hash is a hash, not a key: everything else goes through the mask.
      rows: sec.rows.map((x) => ({ label: maskText(x.label), value: x.label === "Info hash" ? x.value : maskText(x.value) })),
    }));
}

/** What Copy puts on the clipboard: the same masked rows as text. */
export function sourceInfoText(sections: InfoSection[]): string {
  return sections
    .map((sec) => [sec.title, ...sec.rows.map((x) => `  ${x.label}: ${x.label === "Info hash" ? x.value : maskText(x.value)}`)].join("\n"))
    .join("\n\n");
}
