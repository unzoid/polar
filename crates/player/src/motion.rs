//! How the autocrop zoom gets from one value to the next when no cut hides
//! the change (docs/autocrop.md §6): along an eased curve, never linearly.

/// The curve a crop move follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Easing {
    /// Fast at first, settling slowly: cubic, [`EASE_OUT_SECS`].
    #[default]
    EaseOut,
    /// A critically damped spring: fast, then settling without overshoot.
    /// Keeps its speed when the target changes mid-move.
    Spring,
    /// Slow, fast, slow: cubic, [`EASE_IN_OUT_SECS`].
    EaseInOut,
}

impl Easing {
    pub const ALL: [Easing; 3] = [Easing::EaseOut, Easing::Spring, Easing::EaseInOut];

    pub fn name(self) -> &'static str {
        match self {
            Easing::EaseOut => "ease-out",
            Easing::Spring => "spring",
            Easing::EaseInOut => "ease-in-out",
        }
    }
}

pub const EASE_OUT_SECS: f64 = 0.4;
pub const EASE_IN_OUT_SECS: f64 = 0.5;
/// The spring's angular frequency (1/s): within 1% of the target after
/// about 6.6 / [`SPRING_OMEGA`] = 550 ms.
pub const SPRING_OMEGA: f64 = 12.0;
/// Closer than this to the target, a move is over.
const SETTLED: f64 = 1e-4;

/// The share of a curve's way covered at `t` (0 to 1) of its duration.
fn curve(easing: Easing, t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    match easing {
        Easing::EaseOut | Easing::Spring => 1.0 - (1.0 - t).powi(3),
        Easing::EaseInOut => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                1.0 - (2.0 - 2.0 * t).powi(3) / 2.0
            }
        }
    }
}

/// One value (the zoom) moving towards its target. Times are seconds on
/// any steady clock; feed them in order.
#[derive(Debug, Clone)]
pub struct Glide {
    easing: Easing,
    value: f64,
    target: f64,
    /// Curves: where and when the current move started.
    from: f64,
    started: f64,
    /// Spring: speed (units per second) at `last`.
    velocity: f64,
    last: f64,
}

impl Glide {
    pub fn new(easing: Easing, value: f64) -> Self {
        Glide { easing, value, target: value, from: value, started: 0.0, velocity: 0.0, last: 0.0 }
    }

    pub fn target(&self) -> f64 {
        self.target
    }

    /// Whether a move is under way.
    pub fn moving(&self) -> bool {
        (self.value - self.target).abs() > SETTLED
    }

    /// Be at `to` at once: a change that lands on a cut, or bars the film
    /// animates itself, which the crop follows frame by frame.
    pub fn jump(&mut self, to: f64, now: f64) {
        *self = Glide { last: now, started: now, ..Glide::new(self.easing, to) };
    }

    /// Start moving to `to` from wherever the value is at `now`.
    pub fn go(&mut self, to: f64, now: f64) {
        if (to - self.target).abs() <= SETTLED {
            return;
        }
        self.at(now);
        self.target = to;
        self.from = self.value;
        self.started = now;
    }

    /// The value at `now`.
    pub fn at(&mut self, now: f64) -> f64 {
        let dt = (now - self.last).max(0.0);
        self.last = now;
        if !self.moving() {
            self.value = self.target;
            self.velocity = 0.0;
            return self.value;
        }
        self.value = match self.easing {
            Easing::Spring => {
                // Exact step of x'' = -w^2 e - 2w x' for the offset e = x - target.
                let (w, e, v) = (SPRING_OMEGA, self.value - self.target, self.velocity);
                let decay = (-w * dt).exp();
                let e_next = (e + (v + w * e) * dt) * decay;
                self.velocity = (v - w * (v + w * e) * dt) * decay;
                self.target + e_next
            }
            curve_kind => {
                let secs = if curve_kind == Easing::EaseOut { EASE_OUT_SECS } else { EASE_IN_OUT_SECS };
                let t = (now - self.started) / secs;
                self.from + (self.target - self.from) * curve(curve_kind, t)
            }
        };
        if !self.moving() {
            self.value = self.target;
            self.velocity = 0.0;
        }
        self.value
    }
}

/// A move from 0 to 1 sampled once per frame at `fps`, until it settles
/// (at most `max_frames`): the crop path drawn in docs/autocrop-easing.svg.
pub fn path(easing: Easing, fps: f64, max_frames: usize) -> Vec<f64> {
    let mut g = Glide::new(easing, 0.0);
    g.go(1.0, 0.0);
    let mut out = Vec::new();
    for n in 0..max_frames {
        out.push(g.at(n as f64 / fps));
        if !g.moving() {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_curve_starts_and_ends_where_it_should() {
        for e in Easing::ALL {
            let p = path(e, 24.0, 100);
            assert_eq!(p[0], 0.0, "{}", e.name());
            assert_eq!(*p.last().unwrap(), 1.0, "{}", e.name());
            assert!(p.windows(2).all(|w| w[1] >= w[0]), "{}: never goes back or past: {p:?}", e.name());
        }
        assert_eq!(path(Easing::EaseOut, 24.0, 100).len(), 11, "400 ms at 24 fps, then settled");
        assert_eq!(path(Easing::EaseInOut, 24.0, 100).len(), 13, "500 ms");
        let spring = path(Easing::Spring, 24.0, 100);
        assert!(spring[14] > 0.99 && spring[12] < 0.99, "99% after about 550 ms: {spring:?}");
    }

    #[test]
    fn ease_out_is_fast_first_and_ease_in_out_slow_first() {
        let out = path(Easing::EaseOut, 24.0, 100);
        let in_out = path(Easing::EaseInOut, 24.0, 100);
        let spring = path(Easing::Spring, 24.0, 100);
        // After 2 frames (83 ms):
        assert!(out[2] > 0.45 && spring[2] > 0.25 && in_out[2] < 0.05, "{} {} {}", out[2], spring[2], in_out[2]);
        // ease-in-out is fastest mid-way, ease-out at the start.
        let steps = |p: &[f64]| p.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>();
        let (so, sio) = (steps(&out), steps(&in_out));
        assert!(so[0] > so[so.len() - 1]);
        assert!(sio[sio.len() / 2] > sio[0] && sio[sio.len() / 2] > sio[sio.len() - 1]);
    }

    #[test]
    fn a_new_target_mid_move_starts_from_where_it_is() {
        for e in Easing::ALL {
            let mut g = Glide::new(e, 0.0);
            g.go(1.0, 0.0);
            let mid = g.at(0.1);
            g.go(0.5, 0.1);
            let next = g.at(0.1 + 1.0 / 24.0);
            assert!((next - mid).abs() < 0.2, "{}: no jump: {mid} -> {next}", e.name());
            assert_eq!(g.at(2.0), 0.5);
            assert!(!g.moving());
        }
        // The spring carries its speed on: still rising just after the new, higher target.
        let mut g = Glide::new(Easing::Spring, 0.0);
        g.go(1.0, 0.0);
        let a = g.at(0.1);
        g.go(2.0, 0.1);
        assert!(g.at(0.1 + 1.0 / 24.0) - a > 0.1);
    }

    #[test]
    fn jump_is_at_once() {
        let mut g = Glide::new(Easing::Spring, 0.0);
        g.go(1.0, 0.0);
        g.at(0.05);
        g.jump(0.3, 0.05);
        assert_eq!(g.at(0.05), 0.3);
        assert!(!g.moving());
        assert_eq!(g.target(), 0.3);
    }
}
