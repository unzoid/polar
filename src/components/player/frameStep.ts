import { isMpv, type MediaLike } from "./mpvMedia";
import { FRAME_STEP_EVENT } from "./partyFollower";

export { FRAME_STEP_EVENT };

/**
 * Frame-by-frame stepping (#243, #273): the `,` and `.` shortcuts, on desktop only. Plain code, so tests/frameStep.test.ts drives it.
 */

export type StepDirection = 1 | -1;

/** When the engine doesn't say (the built-in player never does, until it has measured a few frames): film's rate. */
export const DEFAULT_FPS = 24;
/** A step that never reports where it landed is given up on after this. */
export const STEP_TIMEOUT_MS = 1500;
/** How long the clock shows the frame number after a step. */
export const FRAME_SHOWN_MS = 3000;

/**
 * Runs one step at a time. A step back makes mpv decode from the previous keyframe, which can take a
 * moment, so presses that come in meanwhile (a held key repeats ~30 times a second) are coalesced into
 * at most one more step, in the latest direction, instead of queued: letting go of the key stops it.
 */
export function createFrameStepper(run: (direction: StepDirection) => Promise<void>) {
  let busy = false;
  let pending: StepDirection | null = null;
  const go = async (direction: StepDirection) => {
    busy = true;
    try {
      await run(direction);
    } catch {
      // A step that failed (mpv gone, nothing loaded) is just not taken.
    }
    busy = false;
    const next = pending;
    pending = null;
    if (next) await go(next);
  };
  return {
    step(direction: StepDirection) {
      if (busy) pending = direction;
      else void go(direction);
    },
    get busy() {
      return busy;
    },
  };
}

/** Steps `media` one frame, pausing it first; resolves once the engine has landed (or given up). */
export async function stepFrame(media: MediaLike, direction: StepDirection, fps: number) {
  if (!media.paused) media.pause();
  if (isMpv(media)) await media.frameStep(direction);
  else await seekFrame(media, direction, fps);
  media.dispatchEvent(new Event(FRAME_STEP_EVENT));
}

/** The frame `t` falls in, counted from 0 (mpv lands on a frame's start, the built-in player mid-frame). */
export const frameAt = (t: number, fps: number) => Math.max(0, Math.floor(t * fps + 0.05));

/** Players without mpv seek by one frame's duration: to the middle of the next frame, so rounding never keeps it on this one. */
function seekFrame(media: MediaLike, direction: StepDirection, fps: number) {
  const target = (frameAt(media.currentTime, fps) + direction + 0.5) / fps;
  const end = Number.isFinite(media.duration) ? media.duration : Infinity;
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      media.removeEventListener("seeked", done);
      resolve();
    };
    const timer = setTimeout(done, STEP_TIMEOUT_MS);
    media.addEventListener("seeked", done);
    media.currentTime = Math.min(end, Math.max(0, target));
  });
}

const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 119.88, 120];

/**
 * A frame rate from the gaps between presented frames: the lower quartile, as a dropped frame only ever
 * makes a gap longer, snapped to the usual rate it's within 1% of.
 */
export function fpsFromIntervals(gaps: number[]): number | null {
  const sorted = gaps.filter((g) => g > 0.002 && g < 0.5).sort((a, b) => a - b);
  if (sorted.length < 4) return null;
  const fps = 1 / sorted[Math.floor(sorted.length / 4)];
  return COMMON_RATES.find((r) => Math.abs(r - fps) / r < 0.01) ?? Math.round(fps * 1000) / 1000;
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback(id: number): void;
};

/** The built-in player's frame rate, measured from a dozen frames as it plays; nothing where the browser can't tell. */
export function measureFps(video: HTMLVideoElement, found: (fps: number) => void): () => void {
  if (!("requestVideoFrameCallback" in video)) return () => {};
  const v = video as FrameCallbackVideo;
  const gaps: number[] = [];
  let last = NaN;
  let id = 0;
  const onFrame = (_now: number, meta: { mediaTime: number }) => {
    if (Number.isFinite(last) && meta.mediaTime > last) gaps.push(meta.mediaTime - last);
    last = meta.mediaTime;
    const fps = gaps.length >= 12 ? fpsFromIntervals(gaps) : null;
    if (fps) found(fps);
    else if (gaps.length < 120) id = v.requestVideoFrameCallback(onFrame);
  };
  id = v.requestVideoFrameCallback(onFrame);
  return () => v.cancelVideoFrameCallback(id);
}
