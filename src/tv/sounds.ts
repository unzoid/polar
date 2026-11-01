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
 * tap on something rather than a pure sine beep.
 */
export type Sound = "move" | "select" | "back" | "edge";
export type SoundPack = "soft" | "wood" | "glass" | "pluck" | "classic";

export const SOUND_PACKS: { value: SoundPack; label: string }[] = [
  { value: "soft", label: "Soft tap" },
  { value: "wood", label: "Wood" },
  { value: "glass", label: "Glass" },
  { value: "pluck", label: "Pluck" },
  { value: "classic", label: "Classic" },
];

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

type Voice = { dur: number; peak: number; draw: (buf: Float32Array, sr: number) => void };

// Ratios for a free wooden bar / marimba bar / small glass bar.
const WOOD_BLOCK: Mode[] = [[1, 1, 0.014], [2.57, 0.35, 0.007], [4.07, 0.12, 0.004]];
const marimba = (d: number): Mode[] => [[1, 1, d], [3.93, 0.22, d * 0.25], [9.2, 0.06, d * 0.08]];
const glass = (d: number): Mode[] => [[1, 1, d], [2.756, 0.28, d * 0.4], [5.404, 0.1, d * 0.18], [8.933, 0.04, d * 0.1]];

const PACKS: Record<SoundPack, Record<Sound, Voice>> = {
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

const rendered = new Map<string, AudioBuffer>();

function bufferFor(ac: AudioContext, pack: SoundPack, sound: Sound) {
  const key = `${pack}:${sound}`;
  let buf = rendered.get(key);
  if (buf) return buf;
  const voice = (PACKS[pack] ?? PACKS.soft)[sound];
  const sr = ac.sampleRate;
  const data = new Float32Array(Math.ceil(voice.dur * sr));
  voice.draw(data, sr);
  // Normalise so every pack lands at the same, quiet level; fade the tail.
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? voice.peak / max : 0;
  const fade = Math.floor(0.008 * sr);
  for (let i = 0; i < data.length; i++) {
    const left = data.length - i;
    data[i] *= scale * (left < fade ? left / fade : 1);
  }
  buf = ac.createBuffer(1, data.length, sr);
  buf.copyToChannel(data, 0);
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
  out.gain.value = uiSoundVolume * 0.6;
  const src = ctx.createBufferSource();
  src.buffer = bufferFor(ctx, uiSoundPack, sound);
  src.connect(out);
  src.start();
}
