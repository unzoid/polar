import { call, on } from "../../lib/platform";
import { mpvVolume, type StartStage, type StepTone } from "../../lib/playback";
import { listenProbe, nextProbeId, probeStep } from "./useStartLog";
import { errorCode, errorMessage, warnFailed } from "../../lib/errors";

/** The slice of HTMLVideoElement the player, scrubber and track UI rely on. */
export interface MediaLike extends EventTarget {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly buffered: TimeRanges;
  volume: number;
  muted: boolean;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
}

export interface MpvChapter {
  title?: string;
  /** Start, in seconds. */
  time: number;
}

export interface MpvTrack {
  id: number;
  type: "video" | "audio" | "sub";
  title?: string;
  lang?: string;
  codec?: string;
  external?: boolean;
  "external-filename"?: string;
  selected?: boolean;
  "demux-channel-count"?: number;
}

/** Detail of the `step` events MpvMedia fires for the loading screen's log. */
export interface StepDetail {
  text: string;
  tone?: StepTone;
  stage?: StartStage;
  /** Same key as the step before: replaces it. */
  key?: string;
}

/** How long time reports are ignored after a seek is sent, at most, if mpv never says it started. */
const SEEK_STALE_MS = 1000;

/**
 * An mpv-backed stand-in for an HTMLVideoElement.
 *
 * mpv renders into the native window beneath the (transparent) page; this
 * object mirrors its state from `mpv://property` events and turns them into
 * the same DOM events a <video> fires (play, pause, waiting, playing,
 * loadedmetadata, timeupdate, ended, error), so the player logic is shared.
 *
 * It also fires `step` events (a CustomEvent<StepDetail>) while a file starts:
 * the link check, mpv opening the file, buffering. The player's loading screen
 * lists them.
 *
 * Time is reported by mpv ~4×/s; between reports `currentTime` is
 * interpolated from the playback rate, so the scrubber still moves every frame.
 */
export class MpvMedia extends EventTarget implements MediaLike {
  private time = 0;
  private stamp = performance.now();
  private dur = NaN;
  private isPaused = true;
  private buffering = false;
  private isEnded = false;
  private cacheEnd = 0;
  private rate = 1;
  private vol = 1;
  private isMuted = false;
  private loaded = false;
  /** Volume or mute changed while paused: the audio mpv buffered before has the old level. */
  private staleAudio = false;
  /** mpv is running (the first load went through); options set before that wait in `early`. */
  private running = false;
  private early = new Map<string, unknown>();
  /** A seek mpv hasn't started yet: time reports from before it are stale. */
  private seekPending = false;
  private seekStarted = false;

  /**
   * Seek to the exact frame instead of the keyframe before it. Off, seeks are
   * instant but can land seconds early; a watch party turns it on, or every
   * catch-up seek lands short, looks like drift, and seeks again.
   */
  exactSeeks = false;

  tracks: MpvTrack[] = [];
  /** Container chapters, when the file has any. */
  chapters: MpvChapter[] = [];
  aid: number | "no" | null = null;
  sid: number | "no" | null = null;
  /** `playerExited`: mpv itself went away (crashed, or its window was closed), not the source failing. */
  error: { code: number; message: string; playerExited?: boolean } | null = null;

  /** Resolves once this object is listening; loads wait on it. */
  private listening: Promise<void> = Promise.resolve();
  /** mpv calls (stop/load) run strictly in order, so a stale stop can never land after a load. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Start mirroring mpv events. Returns a disposer for *these* listeners only —
   * so a late-resolving attach from an earlier mount (React dev double-mount)
   * can never tear down the current one's.
   */
  attach(): Promise<() => void> {
    const p = Promise.all([
      on<{ name: string; data: unknown }>("mpv://property", (p) => this.onProperty(p.name, p.data)),
      on<{ event: string; reason?: string; file_error?: string }>("mpv://event", (p) => this.onEvent(p)),
    ]);
    this.listening = p.then(() => undefined);
    return p.then((fns) => () => fns.forEach((u) => u()));
  }

  /** Stop playback (mpv stays alive, idle, for the next title). */
  stop() {
    this.enqueue(() => call("mpv_stop"));
  }

  private enqueue<T>(fn: () => Promise<T>) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Load and play. `start` avoids fetching the opening of a stream we'd seek past; `headers` are the add-on's (requestHeaders). */
  load(url: string, start?: number, headers: Record<string, string> | null = null) {
    this.loaded = false;
    this.isEnded = false;
    this.seekPending = this.seekStarted = false;
    this.error = null;
    this.time = start ?? 0;
    this.stamp = performance.now();
    this.dur = NaN;
    this.tracks = [];
    this.chapters = [];
    this.emit("chapters");
    this.reportedTracks = false;
    const probeId = nextProbeId();
    this.enqueue(async () => {
      await this.listening; // never load before we can hear mpv's answers
      const unlisten = await listenProbe(probeId, (e) => this.step(...probeStep(e)));
      try {
        await call("mpv_load", { url, start, probeId, headers });
      } finally {
        unlisten();
      }
      this.running = true;
      // Paused before mpv was up (a watch party that's paused): mpv_load un-pauses, the pause below re-pauses.
      const pausedEarly = this.early.get("pause") === true;
      // What the player set before mpv was up (subtitle style, volume, speed), now that it can take it.
      for (const [name, value] of this.early) void this.set(name, value);
      this.early.clear();
      this.step("Handed to mpv, opening the file", "info", "player");
      // mpv_load un-pauses explicitly; mpv only reports *changes*, so if it was
      // already unpaused no event comes — state it here instead of waiting.
      this.isPaused = pausedEarly;
      this.stamp = performance.now();
      this.emit(pausedEarly ? "pause" : "play");
    }).catch((e) => {
      // The link check's verdict, or mpv not starting.
      const message = errorMessage(e);
      this.step(message, "fail", errorCode(e) === "source" ? "server" : "player");
      this.fail(message);
    });
  }

  command(...args: unknown[]) {
    return call("mpv_command", { args });
  }
  set(name: string, value: unknown) {
    // Before mpv runs there's nothing to set (the console filled with "mpv isn't running"): keep it for then.
    if (!this.running) {
      this.early.set(name, value);
      return Promise.resolve();
    }
    return call("mpv_set", { name, value }).catch(warnFailed(`mpv_set ${name}`));
  }

  // --- HTMLVideoElement surface -------------------------------------------

  get currentTime() {
    if (this.isPaused || this.buffering || this.isEnded) return this.time;
    const t = this.time + ((performance.now() - this.stamp) / 1000) * this.rate;
    return Number.isFinite(this.dur) ? Math.min(t, this.dur) : t;
  }
  set currentTime(t: number) {
    this.time = t;
    this.stamp = performance.now();
    this.seekPending = true;
    this.seekStarted = false;
    void this.command("seek", t, this.exactSeeks ? "absolute+exact" : "absolute+keyframes").catch(() => {
      this.seekPending = false;
    });
    this.emit("seeking"); // as a <video> does when its currentTime is set
  }
  get duration() {
    return this.dur;
  }
  get paused() {
    return this.isPaused;
  }
  get ended() {
    return this.isEnded;
  }
  get readyState() {
    return this.loaded ? 4 : 0;
  }
  get buffered(): TimeRanges {
    const end = Math.max(this.cacheEnd, this.time);
    return { length: this.loaded ? 1 : 0, start: () => 0, end: () => end } as TimeRanges;
  }
  get volume() {
    return this.vol;
  }
  /** Amplitude 0–1, as a <video>'s (lib/playback/volume.ts makes it mpv's own). */
  set volume(v: number) {
    if (v !== this.vol && this.isPaused && this.loaded) this.staleAudio = true;
    this.vol = v;
    void this.set("volume", mpvVolume(v));
  }
  get muted() {
    return this.isMuted;
  }
  set muted(m: boolean) {
    if (m !== this.isMuted && this.isPaused && this.loaded) this.staleAudio = true;
    this.isMuted = m;
    void this.set("mute", m);
  }
  get playbackRate() {
    return this.rate;
  }
  set playbackRate(r: number) {
    this.rate = r;
    void this.set("speed", r);
  }
  play() {
    this.time = this.currentTime;
    this.stamp = performance.now();
    // The level changed while paused: an exact seek to where it is drops the audio buffered at the
    // old level, so the first moment doesn't play too loud or too quiet (test report 1, item 14).
    if (this.staleAudio) {
      this.staleAudio = false;
      void this.command("seek", this.time, "absolute+exact").catch(warnFailed("mpv seek"));
    }
    return this.set("pause", false) as Promise<void>;
  }
  pause() {
    this.time = this.currentTime;
    void this.set("pause", true);
  }

  // --- mpv → DOM events ------------------------------------------------------

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  private reportedTracks = false;

  private step(text: string, tone?: StepTone, stage?: StartStage, key?: string) {
    this.dispatchEvent(new CustomEvent<StepDetail>("step", { detail: { text, tone, stage, key } }));
  }

  private fail(message: string, playerExited = false) {
    this.error = { code: 4, message, playerExited };
    this.emit("error");
  }

  private onProperty(name: string, data: unknown) {
    switch (name) {
      case "time-pos":
        // Still the old position, reported before mpv picked the seek up: keep the target.
        if (this.seekPending && !this.seekStarted && performance.now() - this.stamp < SEEK_STALE_MS) break;
        if (typeof data === "number") {
          this.time = data;
          this.stamp = performance.now();
          this.emit("timeupdate");
        }
        break;
      case "duration":
        if (typeof data === "number" && data > 0) {
          this.dur = data;
          if (!this.loaded) {
            this.loaded = true;
            this.emit("loadedmetadata");
            this.emit("canplay");
          } else this.emit("durationchange");
        }
        break;
      case "pause":
        this.time = this.currentTime;
        this.stamp = performance.now();
        this.isPaused = data === true;
        this.emit(this.isPaused ? "pause" : "play");
        if (!this.isPaused && !this.buffering) this.emit("playing");
        break;
      case "paused-for-cache":
        this.buffering = data === true;
        this.stamp = performance.now();
        this.emit(this.buffering ? "waiting" : "playing");
        break;
      case "seeking":
        if (data === true) {
          if (this.seekPending) this.seekStarted = true;
          this.emit("waiting");
        } else {
          if (this.seekStarted) this.seekPending = this.seekStarted = false;
          if (!this.buffering) this.emit("playing");
        }
        break;
      case "eof-reached":
        if (data === true && this.loaded) {
          this.isEnded = true;
          this.emit("ended");
        }
        break;
      case "demuxer-cache-time":
        if (typeof data === "number") this.cacheEnd = data;
        break;
      case "cache-buffering-state":
        if (typeof data === "number" && (data < 100 || this.buffering)) this.step(`Buffering ${Math.round(data)}%`, "info", "player", "buffer");
        break;
      case "file-format":
        if (typeof data === "string" && data) this.step(`Container: ${data}`, "info", "player");
        break;
      case "track-list":
        this.tracks = Array.isArray(data) ? (data as MpvTrack[]) : [];
        if (this.tracks.length && !this.reportedTracks) {
          this.reportedTracks = true;
          this.step(describeTracks(this.tracks), "info", "player");
        }
        this.emit("tracks");
        break;
      case "chapter-list":
        this.chapters = Array.isArray(data) ? (data as MpvChapter[]) : [];
        this.emit("chapters");
        break;
      case "aid":
      case "sid":
        this[name] = typeof data === "number" ? data : data === false || data === "no" ? "no" : null;
        this.emit("tracks");
        break;
    }
  }

  private onEvent(e: { event: string; reason?: string; file_error?: string }) {
    if (e.event === "file-loaded") this.step("mpv opened the file", "ok", "player");
    if (e.event === "end-file" && e.reason === "error") {
      this.step(`mpv couldn't play it: ${e.file_error ?? "unknown error"}`, "fail", "player");
      this.fail(e.file_error ?? "mpv couldn't open this file");
    }
    if (e.event === "shutdown") {
      this.step("mpv stopped unexpectedly", "fail", "player");
      this.fail("The player stopped unexpectedly.", true);
    }
  }
}

/** "Tracks: video hevc, 2 audio (eac3, aac), 3 subtitles". */
function describeTracks(tracks: MpvTrack[]) {
  const of = (t: MpvTrack["type"]) => tracks.filter((x) => x.type === t);
  const codecs = (ts: MpvTrack[]) => [...new Set(ts.map((t) => t.codec).filter(Boolean))].join(", ");
  const [video, audio, subs] = [of("video"), of("audio"), of("sub")];
  const parts = [];
  if (video.length) parts.push(`video ${codecs(video) || "?"}`);
  else parts.push("no video");
  if (audio.length) parts.push(`${audio.length} audio${codecs(audio) ? ` (${codecs(audio)})` : ""}`);
  if (subs.length) parts.push(`${subs.length} subtitle${subs.length > 1 ? "s" : ""}`);
  return `Tracks: ${parts.join(", ")}`;
}

export function isMpv(media: MediaLike | null): media is MpvMedia {
  return media instanceof MpvMedia;
}
