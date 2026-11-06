/**
 * AirPlay from the player (#19), through the webview's own <video>.
 *
 * WebKit (WKWebView on macOS) can send a <video> to an AirPlay receiver: the
 * receiver fetches the link itself and the element becomes a remote for it.
 * mpv draws inside the app, where AirPlay can't reach, so with mpv a hidden
 * <video> holds the same link; picking a receiver hands playback to it at
 * mpv's position, and picking this Mac again hands it back at the receiver's.
 * With the built-in player the element on screen is sent as it is.
 *
 * Elsewhere (Chromium, WebView2, WebKitGTK) the availability event doesn't
 * exist, so the button never shows.
 */
import type { MediaLike } from "./mpvMedia";

/** WebKit's AirPlay additions to a media element. */
interface AirPlayElement extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  readonly webkitCurrentPlaybackTargetIsWireless?: boolean;
}

const AVAILABILITY = "webkitplaybacktargetavailabilitychanged";
const WIRELESS = "webkitcurrentplaybacktargetiswirelesschanged";

/** Whether this webview can send video to AirPlay receivers at all. */
export function airPlaySupported(): boolean {
  return typeof window !== "undefined" && "WebKitPlaybackTargetAvailabilityEvent" in window;
}

/**
 * Whether an AirPlay receiver could play this link by fetching it itself: a
 * plain http(s) link that needs no request headers and isn't on this computer.
 */
export function castableUrl(url: string, headers?: Record<string, string> | null): boolean {
  if (headers && Object.keys(headers).length) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return !(host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host) || host === "0.0.0.0");
}

export interface CastState {
  /** A receiver is on the network and the link can go to it. */
  available: boolean;
  /** Playing on a receiver. */
  casting: boolean;
}

/**
 * One AirPlay session for one link.
 *
 * `base` is what plays in the app; `el` is the element WebKit sends. With the
 * built-in player they're the same element and nothing is handed over.
 */
export class AirPlayCast extends EventTarget {
  private state: CastState = { available: false, casting: false };
  private receiver = false;
  private playable: boolean;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly base: MediaLike,
    readonly el: HTMLVideoElement,
    url?: string,
  ) {
    super();
    el.setAttribute("x-webkit-airplay", "allow");
    const own = (el as MediaLike) !== base;
    // The built-in player's element already plays; a hidden one only has to know the file opens.
    this.playable = !own;
    this.listen(AVAILABILITY, (e) => {
      this.receiver = (e as Event & { availability?: string }).availability === "available";
      this.update();
    });
    this.listen(WIRELESS, () => this.onWireless());
    if (own) {
      this.listen("loadedmetadata", () => {
        this.playable = true;
        this.update();
      });
      // A format the receiver can't play (MKV, for one) never gets the button.
      this.listen("error", () => {
        this.playable = false;
        this.update();
      });
      el.preload = "metadata";
      if (url) el.src = url;
    }
  }

  get current(): CastState {
    return this.state;
  }

  /** The element playing when casting with a hidden element, else null (the player keeps its own). */
  get media(): MediaLike | null {
    return this.state.casting && (this.el as MediaLike) !== this.base ? this.el : null;
  }

  /** Open the system's list of receivers (and this Mac, to come back). Call from a click. */
  pick() {
    (this.el as AirPlayElement).webkitShowPlaybackTargetPicker?.();
  }

  /** Stop listening; a hidden element lets go of its link, which ends a cast still running. */
  dispose() {
    this.off.splice(0).forEach((f) => f());
    if ((this.el as MediaLike) !== this.base) {
      this.el.pause();
      this.el.removeAttribute("src");
      this.el.load();
    }
  }

  private listen(type: string, fn: (e: Event) => void) {
    this.el.addEventListener(type, fn);
    this.off.push(() => this.el.removeEventListener(type, fn));
  }

  private onWireless() {
    const wireless = !!(this.el as AirPlayElement).webkitCurrentPlaybackTargetIsWireless;
    if (wireless === this.state.casting) return;
    if ((this.el as MediaLike) !== this.base) {
      // Hand over at the same moment, playing or paused as it was.
      const [from, to] = wireless ? [this.base, this.el as MediaLike] : [this.el as MediaLike, this.base];
      const at = from.currentTime;
      const playing = !from.paused;
      from.pause();
      to.currentTime = at;
      if (playing) to.play().catch(() => {});
    }
    this.state = { ...this.state, casting: wireless };
    this.update(true);
  }

  private update(force = false) {
    // While casting the button stays: it's how to come back.
    const available = this.state.casting || (this.receiver && this.playable);
    if (!force && available === this.state.available) return;
    this.state = { ...this.state, available };
    this.dispatchEvent(new Event("change"));
  }
}
