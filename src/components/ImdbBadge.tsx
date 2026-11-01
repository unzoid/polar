/** The IMDb mark with the score beside it, the score tinted by band (green ≥ 7, amber ≥ 5, red below). */
export function ImdbBadge({ value }: { value: number }) {
  const tone = value >= 7 ? "good" : value >= 5 ? "mid" : "low";
  return (
    <span className="imdb-badge" data-tone={tone} role="img" aria-label={`IMDb rating ${value.toFixed(1)} out of 10`}>
      <span className="imdb-badge-logo">IMDb</span>
      <span className="imdb-badge-score tabular">{value.toFixed(1)}</span>
    </span>
  );
}

/**
 * The badge under a poster, for Settings → Browsing → "Show IMDb ratings".
 * Always rendered (CSS shows it when the setting is on); a title without a
 * score keeps the row's height so posters in a grid stay level.
 */
export function CardRating({ rating }: { rating?: string }) {
  const score = Number(rating);
  return <span className="card-rating">{score > 0 && <ImdbBadge value={score} />}</span>;
}
