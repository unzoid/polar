import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

/**
 * An mpv-backed stand-in for an HTMLVideoElement.
 *
 * mpv renders into the native window beneath the (transparent) page; this
 * object mirrors its state from `mpv://property` events and turns them into
 * the same DOM events a <video> fires (play, pause, waiting, playing,
 * loadedmetadata, timeupdate, ended, error), so the player logic is shared.
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

  tracks: MpvTrack[] = [];
  aid: number | "no" | null = null;
  sid: number | "no" | null = null;
  error: { code: number; message: string } | null = null;

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
      listen<{ name: string; data: unknown }>("mpv://property", (e) => this.onProperty(e.payload.name, e.payload.data)),
      listen<{ event: string; reason?: string; file_error?: string }>("mpv://event", (e) => this.onEvent(e.payload)),
    ]);
    this.listening = p.then(() => undefined);
    return p.then((fns) => () => fns.forEach((u) => u()));
  }

  /** Stop playback (mpv stays alive, idle, for the next title). */
  stop() {
    this.enqueue(() => invoke("mpv_stop"));
  }

  private enqueue<T>(fn: () => Promise<T>) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Load and play. `start` avoids fetching the opening of a stream we'd seek past. */
  load(url: string, start?: number) {
    this.loaded = false;
    this.isEnded = false;
    this.error = null;
    this.time = start ?? 0;
    this.stamp = performance.now();
    this.dur = NaN;
    this.tracks = [];
    this.enqueue(async () => {
      await this.listening; // never load before we can hear mpv's answers
      await invoke("mpv_load", { url, start });
      // mpv_load un-pauses explicitly; mpv only reports *changes*, so if it was
      // already unpaused no event comes — state it here instead of waiting.
      this.isPaused = false;
      this.stamp = performance.now();
      this.emit("play");
    }).catch((e) => this.fail(String(e)));
  }

  command(...args: unknown[]) {
    return invoke("mpv_command", { args });
  }
  set(name: string, value: unknown) {
    return invoke("mpv_set", { name, value }).catch(() => {});
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
    void this.command("seek", t, "absolute+keyframes").catch(() => {});
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
  set volume(v: number) {
    this.vol = v;
    void this.set("volume", Math.round(v * 100));
  }
  get muted() {
    return this.isMuted;
  }
  set muted(m: boolean) {
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

  private fail(message: string) {
    this.error = { code: 4, message };
    this.emit("error");
  }

  private onProperty(name: string, data: unknown) {
    switch (name) {
      case "time-pos":
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
        if (data === true) this.emit("waiting");
        else if (!this.buffering) this.emit("playing");
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
      case "track-list":
        this.tracks = Array.isArray(data) ? (data as MpvTrack[]) : [];
        this.emit("tracks");
        break;
      case "aid":
      case "sid":
        this[name] = typeof data === "number" ? data : data === false || data === "no" ? "no" : null;
        this.emit("tracks");
        break;
    }
  }

  private onEvent(e: { event: string; reason?: string; file_error?: string }) {
    if (e.event === "end-file" && e.reason === "error") this.fail(e.file_error ?? "mpv couldn't open this file");
    if (e.event === "shutdown") this.fail("The player stopped unexpectedly.");
  }
}

export function isMpv(media: MediaLike | null): media is MpvMedia {
  return media instanceof MpvMedia;
}
