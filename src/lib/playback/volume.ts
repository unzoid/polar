/**
 * The volume slider's position (0–1, what the player shows and stores) as loudness (test report
 * 1, item 13). Equal steps should sound like equal steps: loudness goes roughly as sound pressure
 * to the power 0.6 (Stevens), so the amplitude for a position is position^(1/0.6). Half way is
 * about −10 dB, a quarter about −20 dB. Both players take that amplitude: a <video>'s `volume` is
 * amplitude as it is; mpv cubes its `volume` (mpvVolume undoes that).
 */
const LOUDNESS_EXPONENT = 0.6;

/** The amplitude (0–1) for a slider position. */
export function sliderAmplitude(position: number): number {
  if (!(position > 0)) return 0;
  return Math.min(1, position) ** (1 / LOUDNESS_EXPONENT);
}

/** mpv's `volume` (0–100) for an amplitude: mpv's own gain is (volume / 100)³. */
export function mpvVolume(amplitude: number): number {
  if (!(amplitude > 0)) return 0;
  return Math.round(Math.cbrt(Math.min(1, amplitude)) * 1000) / 10;
}
