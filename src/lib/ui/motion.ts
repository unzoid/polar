import type { Transition } from "motion/react";

/** The CSS easing tokens (tokens.css), for Motion's tweens. */
export const ease = {
  out: [0.23, 1, 0.32, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const;

/**
 * Springs, in Apple's two designer-facing parameters (bounce ≈ 1 − damping,
 * duration ≈ response). Critically damped by default; bounce only when the
 * user's gesture carried momentum into the motion.
 */
export const springs = {
  /** Default UI — no overshoot. */
  ui: { type: "spring", bounce: 0, duration: 0.4 },
  /** Sheets opened by a button press — no momentum, so no bounce. */
  sheet: { type: "spring", bounce: 0, duration: 0.35 },
  /** A step settling into place (sign-in): a hint of overshoot, nothing more. */
  settle: { type: "spring", bounce: 0.15, duration: 0.45 },
} satisfies Record<string, Transition>;

/**
 * Where a flick would come to rest. Apple's projection from Designing Fluid
 * Interfaces (exponential decay, not v²/2a). Velocity in px/s.
 */
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary instead of a hard stop. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
