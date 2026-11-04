import { scoreTone } from "../lib/score";
import { Star } from "./icons";

/** The IMDb mark with the score beside it, the score tinted by band (green ≥ 7, amber ≥ 5, red below). */
export function ImdbBadge({ value }: { value: number }) {
  return (
    <span className="imdb-badge" data-tone={scoreTone(value)} role="img" aria-label={`IMDb rating ${value.toFixed(1)} out of 10`}>
      <span className="imdb-badge-logo">IMDb</span>
      <span className="imdb-badge-score tabular">{value.toFixed(1)}</span>
    </span>
  );
}

/**
 * A card's IMDb rating, for Settings → Browsing → "Show IMDb ratings": a star
 * and the score, the same as an anime's AniList score. Cards render one on the
 * poster and one under it; CSS shows the one in the spot chosen under "Rating
 * position" (`data-rating-position` on `.app`), and neither when the setting
 * is off. Under the poster, a title without a score keeps the row's height so
 * posters in a grid stay level.
 */
export function CardRating({ rating, placement = "below" }: { rating?: string; placement?: "poster" | "below" }) {
  const score = Number(rating);
  if (placement === "poster" && !(score > 0)) return null;
  return (
    <span className="card-rating" data-placement={placement}>
      {score > 0 && (
        <span
          className={placement === "poster" ? "card-score card-score-art tabular" : "card-score tabular"}
          data-tone={scoreTone(score)}
          role="img"
          aria-label={`IMDb rating ${score.toFixed(1)} out of 10`}
          title="IMDb rating"
        >
          <Star size={11} />
          {score.toFixed(1)}
        </span>
      )}
    </span>
  );
}
