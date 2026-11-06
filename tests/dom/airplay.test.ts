import { expect, test } from "bun:test";
import { AirPlayCast, airPlaySupported } from "../../src/components/player/airplay";
import type { MediaLike } from "../../src/components/player/mpvMedia";

/** What the app plays (mpv's stand-in): a position, playing or paused. */
class FakePlayer extends EventTarget {
  currentTime = 0;
  paused = true;
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

/** A <video> with WebKit's AirPlay additions, driven by the test as WebKit would. */
function airPlayVideo() {
  const el = document.createElement("video");
  const s = { wireless: false, picker: 0, time: 0, paused: true };
  Object.defineProperties(el, {
    webkitCurrentPlaybackTargetIsWireless: { get: () => s.wireless },
    webkitShowPlaybackTargetPicker: { value: () => s.picker++ },
    currentTime: { get: () => s.time, set: (t: number) => (s.time = t) },
    paused: { get: () => s.paused },
    play: { value: () => ((s.paused = false), Promise.resolve()) },
    pause: { value: () => void (s.paused = true) },
    load: { value: () => {} },
  });
  const fire = (type: string, extra: object = {}) => el.dispatchEvent(Object.assign(new Event(type), extra));
  return { el, s, fire, available: () => fire("webkitplaybacktargetavailabilitychanged", { availability: "available" }) };
}

test("#19: no AirPlay where the webview has none", () => {
  expect(airPlaySupported()).toBe(false);
});

test("#19: with mpv, the button shows once a receiver is there and the file opens in the hidden element", () => {
  const mpv = new FakePlayer();
  const v = airPlayVideo();
  const cast = new AirPlayCast(mpv as unknown as MediaLike, v.el, "https://media.example.com/film.mp4");
  expect(v.el.getAttribute("x-webkit-airplay")).toBe("allow");
  expect(v.el.getAttribute("src")).toBe("https://media.example.com/film.mp4");
  v.available();
  expect(cast.current.available).toBe(false);
  v.fire("loadedmetadata");
  expect(cast.current.available).toBe(true);
  cast.pick();
  expect(v.s.picker).toBe(1);
  cast.dispose();
});

test("#19: a format the receiver can't open never shows the button", () => {
  const v = airPlayVideo();
  const cast = new AirPlayCast(new FakePlayer() as unknown as MediaLike, v.el, "https://media.example.com/film.mkv");
  v.available();
  v.fire("error");
  expect(cast.current.available).toBe(false);
  cast.dispose();
});

test("#19: picking a receiver hands playback over at mpv's position, and coming back resumes mpv at the receiver's", () => {
  const mpv = new FakePlayer();
  mpv.currentTime = 754;
  mpv.paused = false;
  const v = airPlayVideo();
  const cast = new AirPlayCast(mpv as unknown as MediaLike, v.el, "https://media.example.com/film.mp4");
  let changes = 0;
  cast.addEventListener("change", () => changes++);
  v.available();
  v.fire("loadedmetadata");

  v.s.wireless = true;
  v.fire("webkitcurrentplaybacktargetiswirelesschanged");
  expect(cast.current.casting).toBe(true);
  expect(cast.media).toBe(v.el as unknown as MediaLike);
  expect(mpv.paused).toBe(true);
  expect(v.s.time).toBe(754);
  expect(v.s.paused).toBe(false);

  // Watched on the TV for a while, then this computer picked again.
  v.s.time = 1500;
  v.s.wireless = false;
  v.fire("webkitcurrentplaybacktargetiswirelesschanged");
  expect(cast.current.casting).toBe(false);
  expect(cast.media).toBe(null);
  expect(mpv.currentTime).toBe(1500);
  expect(mpv.paused).toBe(false);
  expect(v.s.paused).toBe(true);
  expect(changes).toBeGreaterThanOrEqual(3);
  cast.dispose();
  expect(v.el.getAttribute("src")).toBe(null);
});

test("#19: paused when sent, it stays paused on the receiver", () => {
  const mpv = new FakePlayer();
  mpv.currentTime = 30;
  const v = airPlayVideo();
  const cast = new AirPlayCast(mpv as unknown as MediaLike, v.el, "https://media.example.com/film.mp4");
  v.s.wireless = true;
  v.fire("webkitcurrentplaybacktargetiswirelesschanged");
  expect(v.s.time).toBe(30);
  expect(v.s.paused).toBe(true);
  cast.dispose();
});

test("#19: the built-in player's own element is sent as it is, nothing handed over", () => {
  const v = airPlayVideo();
  v.s.time = 99;
  const cast = new AirPlayCast(v.el as unknown as MediaLike, v.el);
  expect(v.el.getAttribute("src")).toBe(null); // the player sets its own source
  v.available();
  expect(cast.current.available).toBe(true);
  v.s.wireless = true;
  v.fire("webkitcurrentplaybacktargetiswirelesschanged");
  expect(cast.current.casting).toBe(true);
  expect(cast.media).toBe(null);
  expect(v.s.time).toBe(99);
  cast.dispose();
});
