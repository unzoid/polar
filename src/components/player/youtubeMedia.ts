import type { MediaLike } from "./mpvMedia";

/** Where YouTube's embedded player answers from. */
export const YOUTUBE_ORIGINS = ["https://www.youtube-nocookie.com", "https://www.youtube.com"];
/** How often to say we're listening until the player answers, as YouTube's own API script does. */
const LISTEN_MS = 250;

/** The player's states (YouTube IFrame Player API): unstarted, ended, playing, paused, buffering, cued. */
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;

/** What YouTube's player error codes mean for the viewer. */
export function youtubeError(code: number): string {
  if (code === 2) return "YouTube says this link's video id isn't valid.";
  if (code === 5) return "YouTube's player couldn't play this video here.";
  if (code === 100) return "This video isn't on YouTube any more, or it's private.";
  if (code === 101 || code === 150) return "The video's owner doesn't allow it to be played outside YouTube.";
  if (code === 153) return "YouTube's player wouldn't start here (error 153).";
  return `YouTube's player stopped (error ${code}).`;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * A YouTube video in YouTube's own embedded player (#201), as a stand-in for an HTMLVideoElement.
 *
 * It talks to the embed (youtube-nocookie.com, `enablejsapi=1`) with the IFrame Player API's messages,
 * without loading YouTube's script into the app: commands go in as `{event: "command", func, args}`,
 * and the player's `infoDelivery`, `onStateChange` and `onError` come back as the DOM events a <video>
 * fires (play, pause, waiting, playing, loadedmetadata, timeupdate, ended, error). So the controls and
 * the watch party's sync drive it like any other player.
 *
 * Time comes from the player a few times a second; between reports `currentTime` runs on from the rate.
 */
export class YouTubeMedia extends EventTarget implements MediaLike {
  private time = 0;
  private stamp = performance.now();
  private dur = NaN;
  private state = -1;
  private loadedFraction = 0;
  private rate = 1;
  private vol = 1;
  private isMuted = false;
  private ready = false;
  private loaded = false;
  /** Where to start once the player is ready. */
  private startAt: number | null = null;
  /** Play or pause asked for before the player was ready. */
  private wantPaused: boolean | null = null;
  /** A seek not reported yet: time reports from before it are stale. */
  private seekTarget: number | null = null;
  private seekAt = 0;

  /** The video's title, once the player says it. */
  title: string | null = null;
  error: { code: number; message: string } | null = null;

  /** `post` sends one message to the embed. */
  constructor(private post: (message: string) => void = () => {}) {
    super();
  }

  /**
   * Listen to `frame`'s player: messages from anything else are ignored. Returns a disposer.
   * `win` is the window the messages arrive on (the app's own).
   */
  attach(frame: HTMLIFrameElement, win: Window = window): () => void {
    this.post = (message) => frame.contentWindow?.postMessage(message, new URL(frame.src).origin);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !YOUTUBE_ORIGINS.includes(e.origin)) return;
      this.receive(e.data);
    };
    win.addEventListener("message", onMessage);
    const listen = () => !this.ready && this.send({ event: "listening", id: 1, channel: "widget" });
    frame.addEventListener("load", listen);
    const timer = win.setInterval(listen, LISTEN_MS);
    listen();
    return () => {
      win.removeEventListener("message", onMessage);
      frame.removeEventListener("load", listen);
      win.clearInterval(timer);
      this.post = () => {};
    };
  }

  /** Start at `start` seconds (the watch party's place), once the player is ready. */
  load(start: number | null) {
    this.startAt = start;
    if (this.ready) this.begin();
  }

  /** One message from the embed: a JSON string; anything else is dropped. */
  receive(data: unknown) {
    let msg: unknown;
    try {
      msg = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      return;
    }
    if (!isRecord(msg) || typeof msg.event !== "string") return;
    switch (msg.event) {
      case "onReady":
        if (this.ready) return;
        this.ready = true;
        for (const name of ["onStateChange", "onError"]) this.command("addEventListener", name);
        this.begin();
        break;
      case "initialDelivery":
      case "infoDelivery":
        if (isRecord(msg.info)) this.info(msg.info);
        break;
      case "onStateChange":
        if (finite(msg.info)) this.setState(msg.info);
        break;
      case "onError":
        if (finite(msg.info)) {
          this.error = { code: msg.info, message: youtubeError(msg.info) };
          this.emit("error");
        }
        break;
    }
  }

  private begin() {
    this.command("setVolume", Math.round(this.vol * 100));
    this.command(this.isMuted ? "mute" : "unMute");
    if (this.rate !== 1) this.command("setPlaybackRate", this.rate);
    if (this.startAt != null && this.startAt > 0) this.command("seekTo", this.startAt, true);
    if (this.wantPaused === true) this.command("pauseVideo");
    else this.command("playVideo");
  }

  private info(info: Record<string, unknown>) {
    if (finite(info.duration) && info.duration > 0 && info.duration !== this.dur) {
      this.dur = info.duration;
      if (!this.loaded) {
        this.loaded = true;
        this.emit("loadedmetadata");
      } else this.emit("durationchange");
    }
    if (finite(info.videoLoadedFraction)) this.loadedFraction = info.videoLoadedFraction;
    if (finite(info.playbackRate) && info.playbackRate > 0) this.rate = info.playbackRate;
    if (isRecord(info.videoData) && typeof info.videoData.title === "string" && info.videoData.title && info.videoData.title !== this.title) {
      this.title = info.videoData.title.slice(0, 200);
      this.emit("titlechange");
    }
    if (finite(info.playerState)) this.setState(info.playerState);
    if (finite(info.currentTime)) {
      const t = info.currentTime;
      // A report from before the latest seek landed is the old place.
      if (this.seekTarget != null) {
        const landed = Math.abs(t - this.seekTarget) < 1.5;
        if (!landed && performance.now() - this.seekAt < 1500) return;
        this.seekTarget = null;
        this.emit("seeked");
      }
      this.time = t;
      this.stamp = performance.now();
      this.emit("timeupdate");
    }
  }

  private setState(s: number) {
    if (s === this.state) return;
    const was = this.state;
    // Interpolation restarts from the last report at the new state.
    this.time = this.currentTime;
    this.stamp = performance.now();
    this.state = s;
    if (s === PLAYING) {
      if (was !== BUFFERING) this.emit("play");
      this.emit("playing");
    } else if (s === PAUSED) this.emit("pause");
    else if (s === BUFFERING) this.emit("waiting");
    else if (s === ENDED) {
      if (was === PLAYING || was === BUFFERING) this.emit("pause");
      this.emit("ended");
    }
  }

  get currentTime() {
    if (this.state !== PLAYING) return this.time;
    const t = this.time + ((performance.now() - this.stamp) / 1000) * this.rate;
    return Number.isFinite(this.dur) ? Math.min(t, this.dur) : t;
  }
  set currentTime(t: number) {
    this.time = t;
    this.stamp = performance.now();
    this.seekTarget = t;
    this.seekAt = this.stamp;
    if (this.ready) this.command("seekTo", t, true);
    else this.startAt = t;
    this.emit("seeking");
  }
  get duration() {
    return this.dur;
  }
  get paused() {
    return this.state !== PLAYING && this.state !== BUFFERING;
  }
  get ended() {
    return this.state === ENDED;
  }
  get readyState() {
    return this.loaded ? 4 : 0;
  }
  get buffered(): TimeRanges {
    const end = Number.isFinite(this.dur) ? Math.max(this.loadedFraction * this.dur, this.time) : this.time;
    return { length: this.loaded ? 1 : 0, start: () => 0, end: () => end } as TimeRanges;
  }
  get volume() {
    return this.vol;
  }
  set volume(v: number) {
    const next = Math.min(1, Math.max(0, v));
    if (next === this.vol) return;
    this.vol = next;
    if (this.ready) this.command("setVolume", Math.round(next * 100));
    this.emit("volumechange");
  }
  get muted() {
    return this.isMuted;
  }
  set muted(m: boolean) {
    if (m === this.isMuted) return;
    this.isMuted = m;
    if (this.ready) this.command(m ? "mute" : "unMute");
    this.emit("volumechange");
  }
  get playbackRate() {
    return this.rate;
  }
  set playbackRate(r: number) {
    if (!(r > 0) || r === this.rate) return;
    this.time = this.currentTime;
    this.stamp = performance.now();
    this.rate = r;
    if (this.ready) this.command("setPlaybackRate", r);
    this.emit("ratechange");
  }
  play(): Promise<void> {
    this.wantPaused = false;
    if (this.ready) this.command("playVideo");
    return Promise.resolve();
  }
  pause() {
    this.wantPaused = true;
    if (this.ready) this.command("pauseVideo");
  }

  private command(func: string, ...args: unknown[]) {
    this.send({ event: "command", func, args, id: 1, channel: "widget" });
  }
  private send(message: object) {
    this.post(JSON.stringify(message));
  }
  private emit(name: string) {
    this.dispatchEvent(new Event(name));
  }
}

export const isYouTube = (media: MediaLike | null): media is YouTubeMedia => media instanceof YouTubeMedia;
