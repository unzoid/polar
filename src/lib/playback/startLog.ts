/**
 * What the player's loading screen says while a video starts: one line per
 * step (finding sources, the link, the server's answer, the player opening
 * and buffering the file), each with its time since the player opened, and on
 * failure, which step failed and why.
 *
 * Everything here may be shown and copied into a bug report, so every line is
 * passed through `redact`: links keep only their host (add-on and CDN links
 * carry tokens and the add-on's config in their path), addresses on the
 * user's own network and home folders are hidden.
 */
import type { Stream } from "../types";

/** Where a step happens, for "Failed at …". */
export type StartStage = "sources" | "link" | "server" | "peers" | "player";

export type StepTone = "info" | "ok" | "warn" | "fail";

export interface StartStep {
  /** Milliseconds since the player opened. */
  at: number;
  text: string;
  tone: StepTone;
  stage?: StartStage;
}

/** One step of the backend's link check (`polar_addon::probe::ProbeEvent`). */
export type ProbeEvent =
  | { kind: "request"; host: string; attempt: number }
  | { kind: "redirect"; from: string; to: string; status: number; ms: number }
  | { kind: "response"; host: string; status: number; reason?: string | null; contentType?: string | null; size?: number | null; ms: number }
  | { kind: "retry"; afterMs: number }
  | { kind: "unreachable"; host: string; error: string; ms: number }
  | { kind: "skipped"; reason: string };

export const STAGE_LABEL: Record<StartStage, string> = {
  sources: "finding sources (your add-ons)",
  link: "preparing the link",
  server: "the source's server",
  peers: "the torrent's peers",
  player: "the player",
};

// --- Redaction -----------------------------------------------------------

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;
const HOME_RE = /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[^\s/\\"']+/g;

/** A link as the log may show it: its host only, never what's in the path. */
export function hostOf(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "a link";
  }
  if (u.protocol === "file:") return "a file on this computer";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "this computer";
  if (isPrivateAddress(host)) return "a device on your network";
  return u.port ? `${host}:${u.port}` : host;
}

function isPrivateAddress(host: string) {
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^(fc|fd|fe[89ab])[0-9a-f]*:/i.test(host);
}

/** Text safe to show and copy: links cut to their host, home folders to `~`. */
export function redact(text: string): string {
  return text.replace(URL_RE, (u) => `<${hostOf(u)}>`).replace(HOME_RE, "~");
}

// --- Describing steps ------------------------------------------------------

/** "1.5 s", "120 ms". */
export function formatMs(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** "3.7 GB", "136 KB". */
export function formatBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

const ORDINAL = ["", "1st", "2nd", "3rd"];

/** A line for one step of the link check. */
export function describeProbe(e: ProbeEvent): Omit<StartStep, "at"> {
  switch (e.kind) {
    case "request":
      return {
        text: e.attempt > 1 ? `Asking ${e.host} again (${ORDINAL[e.attempt] ?? `${e.attempt}th`} try)` : `Contacting ${e.host}`,
        tone: "info",
        stage: "server",
      };
    case "redirect":
      return { text: `${e.status}: sent on from ${e.from} to ${e.to} (${formatMs(e.ms)})`, tone: "info", stage: "server" };
    case "response": {
      const parts = [`${e.status}${e.reason ? ` ${e.reason}` : ""} from ${e.host}`];
      if (e.contentType) parts.push(e.contentType);
      if (e.size != null) parts.push(formatBytes(e.size));
      parts.push(formatMs(e.ms));
      const ok = e.status >= 200 && e.status < 300;
      return { text: parts.join(" · "), tone: ok ? "ok" : "warn", stage: "server" };
    }
    case "retry":
      return { text: `Link not ready yet, waiting ${formatMs(e.afterMs)}`, tone: "warn", stage: "server" };
    case "unreachable":
      return { text: `No answer from ${e.host} (${e.error}, ${formatMs(e.ms)}); the player tries it anyway`, tone: "warn", stage: "server" };
    case "skipped":
      return { text: `Not checked: ${e.reason}`, tone: "info", stage: "server" };
  }
}

/** What kind of stream a source is, and where it comes from: "direct file (.mkv) on cdn.example.com". */
export function describeStream(stream: Stream, url?: string): string {
  const link = url ?? stream.url;
  if (!link) {
    if (stream.infoHash) return "a torrent from your add-on (played by the built-in engine)";
    if (stream.ytId) return "a YouTube video (opens outside the player)";
    if (stream.externalUrl) return `a page on ${hostOf(stream.externalUrl)} (opens outside the player)`;
    return "no playable link";
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(link)) return "a downloaded file";
  let path = "";
  try {
    path = new URL(link).pathname.toLowerCase();
  } catch {
    /* hostOf says "a link" */
  }
  const ext = path.match(/\.([a-z0-9]{2,4})$/)?.[1];
  const kind = ext === "m3u8" || path.includes("m3u8") ? "HLS stream" : ext === "mpd" ? "DASH stream" : ext ? `direct file (.${ext})` : "direct link";
  return `${kind} on ${hostOf(link)}`;
}

// --- The whole log -----------------------------------------------------------

/** The step a failure happened at: the last failed line's stage, else the last line's. */
export function failedStage(steps: StartStep[]): StartStage | undefined {
  const failed = [...steps].reverse().find((s) => s.tone === "fail");
  return (failed ?? steps[steps.length - 1])?.stage;
}

/** The text "Copy details" puts on the clipboard. Already redacted. */
export function formatReport(steps: StartStep[], info: { app: string; platform: string; backend: string; outcome: string; stage?: StartStage }): string {
  const lines = [
    `Polarity ${info.app} · ${info.platform} · player: ${info.backend}`,
    `Result: ${info.outcome}${info.stage ? ` (at ${STAGE_LABEL[info.stage]})` : ""}`,
    "",
    ...steps.map(
      (s) => `${`+${(s.at / 1000).toFixed(2)}s`.padStart(8)}  ${s.tone === "info" ? "  " : s.tone === "ok" ? "✓ " : s.tone === "warn" ? "! " : "✗ "}${s.text}`,
    ),
  ];
  return redact(lines.join("\n"));
}
