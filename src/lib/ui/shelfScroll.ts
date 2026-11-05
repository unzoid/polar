/** A box along the row: where it starts and how wide it is, in the scroller's own coordinates. */
export type Span = { left: number; width: number };

/**
 * How an episode row brings its "up next" card to the front. A list shown for the first time (or
 * a new season, or another layout) jumps there before anyone sees it. Later changes (the episode
 * just watched becomes up next when the player closes) never jump the row under the user's eyes
 * (re-test 6b): nothing moves if the card is already in view, otherwise it glides there.
 */
export function upNextMove({ newList, card, view }: { newList: boolean; card: Span | null; view: Span }): "jump" | "smooth" | "none" {
  if (newList) return "jump";
  if (!card) return "none";
  const inView = card.left >= view.left && card.left + card.width <= view.left + view.width;
  return inView ? "none" : "smooth";
}
