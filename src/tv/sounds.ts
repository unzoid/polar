import { getPrefs } from "../lib/prefs";
import { isTvMode } from "./tvMode";

/**
 * TV mode's interface sounds: confirm a move, a selection, going back, or
 * hitting the edge. Quiet and short enough to fire on every step of a held
 * D-pad. Only in TV mode, only while enabled (Settings → Controls), never
 * while something is playing.
 *
 * No audio files: each pack is rendered once into buffers from small physical
 * models (a filtered noise strike for the contact, decaying inharmonic modes
 * for the body, or a plucked string). That's what makes them sound like a
 * tap on something rather than a pure sine beep. The ambient pack is the
 * exception: soft swelling tones in a small room, plus a startup chime.
 */
export type Sound = "move" | "select" | "back" | "edge" | "startup";
export type SoundPack = "ambient" | "soft" | "wood" | "glass" | "pluck" | "classic";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.connect(ctx.destination);
  }
  // Created before any user gesture, a context starts suspended.
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, out: out! };
}

// --- Synthesis ----------------------------------------------------------------

/** Deterministic noise, so a pack sounds the same every time it's rendered. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

type FilterType = "lowpass" | "bandpass" | "highpass";

/** An RBJ biquad, applied in place. */
function biquad(buf: Float32Array, sr: number, type: FilterType, freq: number, q: number) {
  const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === "lowpass") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
}

/** [frequency ratio, amplitude, decay time constant in seconds]. */
type Mode = [ratio: number, amp: number, decay: number];

/** A struck body: a sum of exponentially decaying partials. */
function modes(buf: Float32Array, sr: number, f: number, partials: Mode[], { at = 0, amp = 1, attack = 0.0015 } = {}) {
  const start = Math.floor(at * sr);
  for (const [ratio, a, decay] of partials) {
    const hz = f * ratio;
    if (hz >= sr / 2) continue;
    for (let i = start; i < buf.length; i++) {
      const t = (i - start) / sr;
      const env = Math.exp(-t / decay) * Math.min(1, t / attack);
      if (env < 1e-4 && t > attack) break;
      buf[i] += amp * a * env * Math.sin(2 * Math.PI * hz * t);
    }
  }
}

/** The contact: a short burst of filtered noise. */
function strike(
  buf: Float32Array,
  sr: number,
  { at = 0, amp = 1, decay = 0.004, type = "bandpass" as FilterType, freq = 3000, q = 0.8, seed = 1 } = {},
) {
  const len = Math.min(buf.length, Math.ceil(decay * 8 * sr));
  const n = new Float32Array(len);
  const r = rng(seed);
  for (let i = 0; i < len; i++) n[i] = r() * Math.exp(-i / sr / decay) * Math.min(1, i / (0.0005 * sr));
  biquad(n, sr, type, freq, q);
  const start = Math.floor(at * sr);
  for (let i = 0; i < len && start + i < buf.length; i++) buf[start + i] += amp * n[i];
}

/** Karplus–Strong: a plucked string, softened by starting from filtered noise. */
function pluck(buf: Float32Array, sr: number, f: number, { at = 0, amp = 1, decay = 0.2, tone = 0.5, seed = 7 } = {}) {
  const period = Math.max(2, Math.round(sr / f));
  const ring = new Float32Array(period);
  const r = rng(seed);
  let prev = 0;
  // One-pole lowpass on the excitation: lower `tone` = a softer, fingered pluck.
  for (let i = 0; i < period; i++) ring[i] = prev = prev + tone * (r() - prev);
  const start = Math.floor(at * sr);
  let idx = 0;
  for (let i = start; i < buf.length; i++) {
    const t = (i - start) / sr;
    const next = (idx + 1) % period;
    const y = ring[idx];
    ring[idx] = 0.5 * (y + ring[next]) * 0.996;
    idx = next;
    buf[i] += amp * y * Math.exp(-t / decay) * Math.min(1, t / 0.001);
  }
}

/** A sine glide with a fast attack and exponential fall: the original beeps. */
function glide(buf: Float32Array, sr: number, from: number, to: number, dur: number, { at = 0, amp = 1 } = {}) {
  const start = Math.floor(at * sr);
  const end = Math.min(buf.length, start + Math.floor(dur * sr));
  let phase = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / sr;
    phase += (2 * Math.PI * from * Math.pow(to / from, t / dur)) / sr;
    const env = t < 0.004 ? t / 0.004 : Math.pow(1e-4, (t - 0.004) / (dur - 0.004));
    buf[i] += amp * env * Math.sin(phase);
  }
}

/** Rises along sine² (no click, no edge), then falls exponentially. */
const swellEnv = (t: number, attack: number, decay: number) =>
  t < attack ? Math.sin((Math.PI / 2) * (t / attack)) ** 2 : Math.exp(-(t - attack) / decay);

/**
 * A soft, rounded tone: a sine and a quiet octave that swell in and fade.
 * `glide` starts the pitch that fraction flat (or sharp, if negative) and
 * lets it settle, which gives a gentle "bloop" rather than a beep.
 */
function swell(
  buf: Float32Array,
  sr: number,
  f: number,
  { at = 0, amp = 1, attack = 0.01, decay = 0.1, octave = 0.15, octaveDecay = 1, glide = 0 } = {},
) {
  const start = Math.floor(at * sr);
  for (const [ratio, a, d] of [[1, 1, decay], [2, octave, decay * octaveDecay]]) {
    if (!a) continue;
    let phase = 0;
    for (let i = start; i < buf.length; i++) {
      const t = (i - start) / sr;
      const env = swellEnv(t, attack, d);
      if (t > attack && env < 1e-4) break;
      phase += (2 * Math.PI * f * ratio * (1 - glide * Math.exp(-t / 0.012))) / sr;
      buf[i] += amp * a * env * Math.sin(phase);
    }
  }
}

/**
 * A slow pad note: two slightly detuned voices (so it breathes) with a few
 * soft harmonics, faded in, held and faded out. Sines by recurrence, since
 * the startup chime runs hundreds of thousands of samples per partial.
 */
function pad(
  buf: Float32Array,
  sr: number,
  f: number,
  { at = 0, amp = 1, attack = 1, hold = 0, release = 1.5, detune = 5, partials = [[1, 1], [2, 0.16], [3, 0.04]] } = {},
) {
  const start = Math.floor(at * sr);
  const end = Math.min(buf.length, start + Math.floor((attack + hold + release) * sr));
  // One envelope, shared by every voice and partial.
  const env = new Float32Array(Math.max(0, end - start));
  for (let i = 0; i < env.length; i++) {
    const t = i / sr;
    env[i] =
      0.5 *
      amp *
      (t < attack
        ? Math.sin((Math.PI / 2) * (t / attack)) ** 2
        : t < attack + hold
          ? 1
          : Math.cos((Math.PI / 2) * Math.min(1, (t - attack - hold) / release)) ** 2);
  }
  for (const cents of [-detune, detune]) {
    for (const [ratio, a] of partials) {
      const w = (2 * Math.PI * f * ratio * 2 ** (cents / 1200)) / sr;
      if (w >= Math.PI * 0.9) continue;
      const k = 2 * Math.cos(w);
      let y1 = Math.sin(-w);
      let y2 = Math.sin(-2 * w);
      for (let i = start; i < end; i++) {
        const y = k * y1 - y2;
        y2 = y1;
        y1 = y;
        buf[i] += a * env[i - start] * y;
      }
    }
  }
}

/** A small Schroeder room (four damped combs into two allpasses), mixed in place. */
function space(buf: Float32Array, sr: number, { mix = 0.3, t60 = 1, damp = 0.35 } = {}) {
  const wet = new Float32Array(buf.length);
  for (const d of [0.0297, 0.0371, 0.0411, 0.0437]) {
    const line = new Float32Array(Math.round(d * sr));
    const g = 10 ** ((-3 * d) / t60);
    let j = 0, lp = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = line[j];
      lp = (1 - damp) * y + damp * lp;
      line[j] = buf[i] + g * lp;
      wet[i] += y / 4;
      j = (j + 1) % line.length;
    }
  }
  for (const d of [0.005, 0.0017]) {
    const line = new Float32Array(Math.round(d * sr));
    let j = 0;
    for (let i = 0; i < wet.length; i++) {
      const x = wet[i];
      const y = line[j] - 0.7 * x;
      line[j] = x + 0.7 * y;
      wet[i] = y;
      j = (j + 1) % line.length;
    }
  }
  for (let i = 0; i < buf.length; i++) buf[i] += mix * wet[i];
}

type Voice = { dur: number; peak: number; draw: (buf: Float32Array, sr: number) => void };
/** Every pack has the four navigation sounds; a startup chime is optional. */
type Pack = Record<Exclude<Sound, "startup">, Voice> & { startup?: Voice };

/** Note frequencies the ambient pack is written in (a dreamy A♭ / D♭ colour). */
const N = {
  Ab1: 51.91, Db2: 69.3, Eb2: 77.78, F2: 87.31, Ab2: 103.83,
  Db3: 138.59, Eb3: 155.56, F3: 174.61, Gb3: 185.0, Ab3: 207.65, Bb3: 233.08,
  C4: 261.63, Db4: 277.18, Eb4: 311.13, F4: 349.23, Gb4: 369.99, Ab4: 415.3,
  Db5: 554.37, Eb5: 622.25, Ab5: 830.61,
};

// Ratios for a free wooden bar / marimba bar / small glass bar.
const WOOD_BLOCK: Mode[] = [[1, 1, 0.014], [2.57, 0.35, 0.007], [4.07, 0.12, 0.004]];
const marimba = (d: number): Mode[] => [[1, 1, d], [3.93, 0.22, d * 0.25], [9.2, 0.06, d * 0.08]];
const glass = (d: number): Mode[] => [[1, 1, d], [2.756, 0.28, d * 0.4], [5.404, 0.1, d * 0.18], [8.933, 0.04, d * 0.1]];

const PACKS: Record<SoundPack, Pack> = {
  // Console-style: round tones that swell rather than strike, in a little
  // room. Select and back are two-part (a high swell handing over to a lower
  // chord), so select reads as "settling in" and back as "stepping down".
  ambient: {
    move: {
      dur: 0.32,
      peak: 0.08,
      draw: (b, sr) => {
        swell(b, sr, N.F4, { attack: 0.009, decay: 0.035, octave: 0.45, octaveDecay: 1.5, glide: 0.02 });
        space(b, sr, { mix: 0.22, t60: 0.3 });
      },
    },
    select: {
      dur: 1.3,
      peak: 0.12,
      draw: (b, sr) => {
        for (const [f, a] of [[N.Ab4, 1], [N.Db5, 0.55], [N.Eb5, 0.4]])
          swell(b, sr, f, { amp: a, attack: 0.05, decay: 0.12, octave: 0.06 });
        for (const [f, a] of [[N.Ab3, 1], [N.Db4, 0.7], [N.Eb4, 0.45]])
          swell(b, sr, f, { at: 0.07, amp: a, attack: 0.04, decay: 0.3, octave: 0.1 });
        space(b, sr, { mix: 0.3, t60: 0.9 });
      },
    },
    back: {
      dur: 1.1,
      peak: 0.1,
      draw: (b, sr) => {
        for (const [f, a] of [[N.Db5, 0.55], [N.Gb4, 1]])
          swell(b, sr, f, { amp: a, attack: 0.04, decay: 0.09, octave: 0.06 });
        for (const [f, a] of [[N.Gb3, 1], [N.Ab3, 0.35], [N.Db4, 0.6]])
          swell(b, sr, f, { at: 0.06, amp: a, attack: 0.035, decay: 0.24, octave: 0.1 });
        space(b, sr, { mix: 0.3, t60: 0.8 });
      },
    },
    edge: {
      dur: 0.3,
      peak: 0.11,
      draw: (b, sr) => {
        // Starts a touch sharp and sags: a soft "nope".
        swell(b, sr, N.Db3, { attack: 0.006, decay: 0.05, octave: 0.3, glide: -0.04 });
        swell(b, sr, N.Ab3, { amp: 0.2, attack: 0.006, decay: 0.035, octave: 0 });
        space(b, sr, { mix: 0.15, t60: 0.25 });
      },
    },
    // A slow bloom through F → D♭maj7 → A♭add9 over a soft bass, ~8 seconds.
    startup: {
      dur: 9,
      peak: 0.14,
      draw: (b, sr) => {
        const chord = (at: number, notes: [number, number][], env: { attack: number; hold: number; release: number }) => {
          for (const [f, a] of notes) pad(b, sr, f, { at, amp: a, ...env });
        };
        chord(0, [[N.F2, 0.7], [N.F3, 1], [N.C4, 0.6], [N.F4, 0.45]], { attack: 1.4, hold: 0.5, release: 1.8 });
        chord(0.5, [[N.Bb3, 0.35]], { attack: 1.2, hold: 0.3, release: 1.6 });
        chord(1.9, [[N.Db2, 0.7], [N.Db3, 0.8], [N.F3, 0.7], [N.Ab3, 0.6], [N.C4, 0.45]], {
          attack: 1.2,
          hold: 0.5,
          release: 1.8,
        });
        chord(3.6, [[N.Ab1, 0.5], [N.Ab2, 0.6], [N.Eb3, 0.8], [N.Ab3, 0.75], [N.Bb3, 0.45], [N.Eb4, 0.5]], {
          attack: 1.3,
          hold: 0.9,
          release: 2.6,
        });
        // A faint shimmer on top of the last chord.
        chord(4.2, [[N.Ab4, 0.18], [N.Eb5, 0.1], [N.Ab5, 0.05]], { attack: 1.2, hold: 0.6, release: 2.2 });
        space(b, sr, { mix: 0.45, t60: 2.4, damp: 0.5 });
      },
    },
  },

  // Felt on a hard surface: mostly contact, a short muted body.
  soft: {
    move: {
      dur: 0.05,
      peak: 0.11,
      draw: (b, sr) => {
        strike(b, sr, { freq: 2600, q: 0.9, decay: 0.003, seed: 3 });
        modes(b, sr, 1450, [[1, 0.35, 0.01]]);
      },
    },
    select: {
      dur: 0.12,
      peak: 0.17,
      draw: (b, sr) => {
        strike(b, sr, { type: "lowpass", freq: 2200, q: 0.7, decay: 0.005, amp: 0.8, seed: 5 });
        modes(b, sr, 520, [[1, 1, 0.03], [2.9, 0.25, 0.01]]);
      },
    },
    back: {
      dur: 0.1,
      peak: 0.14,
      draw: (b, sr) => {
        strike(b, sr, { type: "lowpass", freq: 1500, q: 0.7, decay: 0.005, amp: 0.8, seed: 9 });
        modes(b, sr, 360, [[1, 1, 0.026], [2.9, 0.2, 0.008]]);
      },
    },
    edge: {
      dur: 0.1,
      peak: 0.15,
      draw: (b, sr) => {
        strike(b, sr, { type: "lowpass", freq: 700, q: 0.7, decay: 0.008, seed: 11 });
        modes(b, sr, 130, [[1, 1, 0.03], [2.3, 0.3, 0.012]]);
      },
    },
  },

  // A small wood block to move, marimba bars to confirm.
  wood: {
    move: {
      dur: 0.06,
      peak: 0.11,
      draw: (b, sr) => {
        strike(b, sr, { freq: 4200, q: 1.5, decay: 0.0015, amp: 0.5, seed: 13 });
        modes(b, sr, 1900, WOOD_BLOCK);
      },
    },
    select: {
      dur: 0.45,
      peak: 0.16,
      draw: (b, sr) => {
        strike(b, sr, { freq: 3000, q: 1, decay: 0.0015, amp: 0.25, seed: 17 });
        modes(b, sr, 784, marimba(0.09));
        modes(b, sr, 1175, marimba(0.11), { at: 0.06, amp: 0.8 });
      },
    },
    back: {
      dur: 0.35,
      peak: 0.14,
      draw: (b, sr) => {
        strike(b, sr, { freq: 2500, q: 1, decay: 0.0015, amp: 0.25, seed: 19 });
        modes(b, sr, 523, marimba(0.08));
      },
    },
    edge: {
      dur: 0.1,
      peak: 0.15,
      draw: (b, sr) => {
        strike(b, sr, { type: "lowpass", freq: 900, q: 0.7, decay: 0.004, amp: 0.6, seed: 23 });
        modes(b, sr, 190, WOOD_BLOCK.map(([r, a, d]): Mode => [r, a, d * 1.8]));
      },
    },
  },

  // Gentle glass chimes with a soft attack; longer tails, kept very quiet.
  glass: {
    move: {
      dur: 0.12,
      peak: 0.07,
      draw: (b, sr) => modes(b, sr, 2640, glass(0.025), { attack: 0.002 }),
    },
    select: {
      dur: 0.9,
      peak: 0.12,
      draw: (b, sr) => {
        modes(b, sr, 1319, glass(0.22), { attack: 0.003 });
        modes(b, sr, 1976, glass(0.26), { at: 0.07, amp: 0.7, attack: 0.003 });
      },
    },
    back: {
      dur: 0.7,
      peak: 0.1,
      draw: (b, sr) => modes(b, sr, 988, glass(0.18), { attack: 0.003 }),
    },
    edge: {
      dur: 0.2,
      peak: 0.12,
      draw: (b, sr) => modes(b, sr, 330, glass(0.04), { attack: 0.002 }),
    },
  },

  // A muted nylon-ish string.
  pluck: {
    move: {
      dur: 0.07,
      peak: 0.1,
      draw: (b, sr) => pluck(b, sr, 1568, { decay: 0.018, tone: 0.35, seed: 29 }),
    },
    select: {
      dur: 0.45,
      peak: 0.16,
      draw: (b, sr) => {
        pluck(b, sr, 659, { decay: 0.12, tone: 0.4, seed: 31 });
        pluck(b, sr, 988, { at: 0.06, decay: 0.14, tone: 0.4, amp: 0.8, seed: 37 });
      },
    },
    back: {
      dur: 0.35,
      peak: 0.14,
      draw: (b, sr) => pluck(b, sr, 494, { decay: 0.1, tone: 0.35, seed: 41 }),
    },
    edge: {
      dur: 0.12,
      peak: 0.15,
      draw: (b, sr) => pluck(b, sr, 147, { decay: 0.035, tone: 0.25, seed: 43 }),
    },
  },

  // The original synth beeps.
  classic: {
    move: { dur: 0.05, peak: 0.12, draw: (b, sr) => glide(b, sr, 2200, 1800, 0.035) },
    select: {
      dur: 0.16,
      peak: 0.18,
      draw: (b, sr) => {
        glide(b, sr, 660, 660, 0.06);
        glide(b, sr, 990, 990, 0.09, { at: 0.05, amp: 0.9 });
      },
    },
    back: { dur: 0.11, peak: 0.16, draw: (b, sr) => glide(b, sr, 720, 430, 0.09) },
    edge: {
      dur: 0.08,
      peak: 0.2,
      draw: (b, sr) => glide(b, sr, 190, 150, 0.06),
    },
  },
};

/** Renders a voice, normalised so every pack lands at the same, quiet level. */
export function renderVoice(pack: SoundPack, sound: Sound, sr: number): Float32Array<ArrayBuffer> | null {
  const voice = (PACKS[pack] ?? PACKS.soft)[sound];
  if (!voice) return null;
  const data = new Float32Array(Math.ceil(voice.dur * sr));
  voice.draw(data, sr);
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? voice.peak / max : 0;
  // Fade the tail so a cut-off reverb never clicks.
  const fade = Math.floor(0.008 * sr);
  for (let i = 0; i < data.length; i++) {
    const left = data.length - i;
    data[i] *= scale * (left < fade ? left / fade : 1);
  }
  return data;
}

const rendered = new Map<string, AudioBuffer | null>();

function bufferFor(ac: AudioContext, pack: SoundPack, sound: Sound) {
  const key = `${pack}:${sound}`;
  if (rendered.has(key)) return rendered.get(key)!;
  const data = renderVoice(pack, sound, ac.sampleRate);
  let buf: AudioBuffer | null = null;
  if (data) {
    buf = ac.createBuffer(1, data.length, ac.sampleRate);
    buf.copyToChannel(data, 0);
  }
  rendered.set(key, buf);
  return buf;
}

// --- Playback -----------------------------------------------------------------

const playerUp = () => !!document.querySelector('.player-layer:not([data-leaving="true"])');

let lastMove = 0;

export function playSound(sound: Sound, { force = false } = {}) {
  const { uiSounds, uiSoundVolume, uiSoundPack } = getPrefs();
  if (!force && (!uiSounds || !isTvMode() || playerUp())) return;
  if (uiSoundVolume <= 0) return;
  if (sound === "move") {
    // A held D-pad repeats fast; don't stack clicks on top of each other.
    const now = performance.now();
    if (now - lastMove < 45) return;
    lastMove = now;
  }
  const { ctx, out } = audio();
  const buf = bufferFor(ctx, uiSoundPack, sound);
  if (!buf) return; // this pack has no such sound (most have no startup chime)
  const start = () => {
    out.gain.value = uiSoundVolume * 0.6;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    src.start();
  };
  if (ctx.state === "running") return start();
  // Not unlocked yet (no user gesture so far): a startup chime that turned up
  // whenever the first key is pressed would be odd, so it only plays if the
  // context comes up straight away.
  if (sound === "startup") {
    const asked = performance.now();
    void ctx.resume().then(() => performance.now() - asked < 1000 && start());
  } else start();
}
