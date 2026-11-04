/** A score's colour band (docs/ui-components.md U26), the `data-tone` the rating styles read. */
export type ScoreTone = "good" | "mid" | "low";

/** Out of 10 (IMDb): green from 7, amber from 5, red below. */
export const scoreTone = (score: number): ScoreTone => (score >= 7 ? "good" : score >= 5 ? "mid" : "low");

/** Metacritic's own bands, out of 100: favourable from 61, mixed from 40. */
export const metacriticTone = (score: number): ScoreTone => (score >= 61 ? "good" : score >= 40 ? "mid" : "low");

/** Rotten Tomatoes counts 60% and up as fresh. */
export const isFresh = (percent: number) => percent >= 60;
