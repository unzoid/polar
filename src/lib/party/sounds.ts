/**
 * The watch party's two sounds: someone joining (two notes rising) or leaving
 * (the same two, falling). Soft bell-like sines, synthesized, quiet enough to
 * sit under whatever's playing. Not tied to TV mode's interface sounds: they
 * say something happened in the room, wherever you are in the app.
 */
let ctx: AudioContext | null = null;

/** E5 and B5: a fifth, bright without being shrill. */
const NOTES = [659.25, 987.77];
const GAP = 0.11;
const RING = 0.5;
const LEVEL = 0.12;

export function partyChime(kind: "join" | "leave") {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  const ac = ctx;
  const notes = kind === "join" ? NOTES : [...NOTES].reverse();
  const t0 = ac.currentTime + 0.02;
  notes.forEach((f, i) => {
    const at = t0 + i * GAP;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(LEVEL, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + RING);
    gain.connect(ac.destination);
    // A sine with a quiet octave above it: a bell, not a beep.
    for (const [mult, amp] of [
      [1, 1],
      [2, 0.18],
    ]) {
      const osc = ac.createOscillator();
      osc.frequency.value = f * mult;
      const g = ac.createGain();
      g.gain.value = amp;
      osc.connect(g).connect(gain);
      osc.start(at);
      osc.stop(at + RING + 0.05);
    }
  });
}
