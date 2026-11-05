import { prefersReducedMotion } from "../lib/ui/reducedMotion";

/** How quickly the view catches up with focus: the time to close about two thirds of the gap. */
const TAU_MS = 85;

/**
 * One frame of the view following focus: closes part of the gap (more the longer the frame), lands
 * exactly once within half a pixel. A new target while gliding (a held direction reaching the next
 * row) just changes where it heads, so held movement is one continuous glide instead of a jump or a
 * restarted smooth scroll per row (re-test 20).
 */
export function followStep(pos: number, target: number, dtMs: number): number {
  const next = pos + (target - pos) * (1 - Math.exp(-dtMs / TAU_MS));
  return Math.abs(target - next) < 0.5 ? target : next;
}

type Glide = { target: number; frame: number; last: number };
const glides = new WeakMap<HTMLElement, { x?: Glide; y?: Glide }>();

/** Glides `el`'s scroll position on one axis to `target` (instant with reduced motion). */
export function glideScroll(el: HTMLElement, axis: "x" | "y", target: number) {
  const prop = axis === "x" ? "scrollLeft" : "scrollTop";
  const max = axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
  const to = Math.max(0, Math.min(target, max));
  const state = glides.get(el) ?? {};
  glides.set(el, state);
  if (prefersReducedMotion()) {
    if (state[axis]) cancelAnimationFrame(state[axis]!.frame);
    state[axis] = undefined;
    el[prop] = to;
    return;
  }
  const running = state[axis];
  if (running) {
    running.target = to;
    return;
  }
  const g: Glide = { target: to, frame: 0, last: performance.now() };
  state[axis] = g;
  // Our own glide: the browser's smooth scroll would fight it.
  el.style.scrollBehavior = "auto";
  const step = (now: number) => {
    const dt = Math.min(64, now - g.last);
    g.last = now;
    const pos = followStep(el[prop], g.target, dt);
    el[prop] = pos;
    if (pos === g.target || Math.abs(el[prop] - g.target) < 1) {
      el[prop] = g.target;
      state[axis] = undefined;
      return;
    }
    g.frame = requestAnimationFrame(step);
  };
  g.frame = requestAnimationFrame(step);
}
