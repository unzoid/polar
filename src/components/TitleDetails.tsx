import { api } from "../lib/api";
import { formatDate, formatRuntime } from "../lib/format";
import { usePersonPhoto } from "../lib/personPhoto";
import { useRatings } from "../lib/queries";
import type { ContentType, ExternalRatings, Meta } from "../lib/types";
import { letterboxdUrl } from "./CardMenu";
import { BrandIcon } from "./BrandIcon";
import { ArrowUpRight } from "./icons";
import { Img } from "./Img";
import { imdbUrl } from "./RatingRing";

/**
 * Everything about a title below the fold: what critics and audiences
 * thought, who's in it (with faces where the source has them), the facts,
 * and links out to IMDb, Letterboxd, TMDB and Rotten Tomatoes. A movie's
 * "About", a show's "Details" tab.
 */
export function TitleDetails({ meta, links: showLinks = true }: { meta: Meta; links?: boolean }) {
  const { data: ratings } = useRatings(meta.type, meta.id);
  const d = meta.details ?? {};
  const isSeries = meta.type === "series";
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

  const info: [string, string | undefined][] = [
    ["Genres", meta.genres?.join(", ")],
    [isSeries ? "First aired" : "Released", d.released ? formatDate(d.released) : meta.releaseInfo],
    ["Runtime", formatRuntime(meta.runtime)],
    ["Status", isSeries ? d.status : undefined],
    ["Seasons", d.seasons ? `${d.seasons} ${d.seasons === 1 ? "season" : "seasons"}${d.episodes ? ` · ${d.episodes} episodes` : ""}` : undefined],
    ["Rated", ratings?.rated ?? undefined],
    [isSeries ? "Created by" : "Director", meta.director?.join(", ")],
    ["Writers", d.writers?.join(", ")],
    [isSeries ? "Network" : "Studio", d.studios?.join(", ")],
    ["Country", d.countries?.join(", ")],
    ["Language", d.languages?.join(", ")],
    ["Budget", d.budget ? money.format(d.budget) : undefined],
    ["Box office", d.revenue ? money.format(d.revenue) : undefined],
  ];
  const awards = d.awards ?? ratings?.awards ?? undefined;
  const people = meta.people?.length ? meta.people : (meta.cast ?? []).map((name) => ({ name, character: undefined, photo: undefined }));
  const links = titleLinks(meta);

  return (
    <div className="details">
      {d.tagline && <p className="details-tagline">“{d.tagline}”</p>}
      <ScoreCards ratings={ratings} />

      {people.length > 0 && (
        <section className="details-section">
          <h3 className="details-label">Cast</h3>
          <ul className="people">
            {people.slice(0, 18).map((p) => (
              <Cast key={`${p.name}/${p.character ?? ""}`} person={p} />
            ))}
          </ul>
        </section>
      )}

      <section className="details-section details-columns">
        {(meta.description || awards) && (
          <div className="details-main">
            {meta.description && (
              <div>
                <h3 className="details-label">Story</h3>
                <p className="details-story">{meta.description}</p>
              </div>
            )}
            {/* Under the story rather than below the facts, which leaves a hole beside a short synopsis. */}
            {awards && (
              <div>
                <h3 className="details-label">Awards</h3>
                <p className="details-awards">{awards}</p>
              </div>
            )}
          </div>
        )}
        <dl className="details-facts">
          {info
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="details-label">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      </section>

      {/* Links open a browser: no use on a TV. */}
      {showLinks && links.length > 0 && (
        <section className="details-section">
          <h3 className="details-label">Elsewhere</h3>
          <div className="details-links">
            {links.map((l) => (
              <button key={l.label} className="details-link pressable" data-site={l.site} onClick={() => void api.openExternal(l.url)}>
                <BrandIcon site={l.site} size={15} />
                {l.label}
                <ArrowUpRight className="details-link-out" size={13} aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Cast({ person: p }: { person: { name: string; character?: string; photo?: string } }) {
  // No photo from the metadata source: look the name up on IMDb. Initials until it answers (or if it can't).
  const { data: found } = usePersonPhoto(p.name, !p.photo);
  const photo = p.photo ?? found ?? undefined;
  return (
    <li className="person">
      <span className="person-photo">{photo ? <Img src={photo} alt="" /> : <span aria-hidden>{initials(p.name)}</span>}</span>
      <span className="person-name">{p.name}</span>
      {p.character && <span className="person-role">{p.character}</span>}
    </li>
  );
}

function titleLinks(meta: Meta) {
  const links: { site: string; label: string; url: string }[] = [];
  const imdb = imdbUrl(meta.id);
  if (imdb) links.push({ site: "imdb", label: "IMDb", url: imdb });
  if (imdb && meta.type === "movie") links.push({ site: "letterboxd", label: "Letterboxd", url: letterboxdUrl(meta.id) });
  if (meta.id.startsWith("tt")) links.push({ site: "trakt", label: "Trakt", url: `https://app.trakt.tv/${meta.type === "series" ? "shows" : "movies"}/${meta.id}` });
  const tmdb = meta.details?.tmdbId;
  if (tmdb) links.push({ site: "tmdb", label: "TMDB", url: `https://www.themoviedb.org/${meta.type === "series" ? "tv" : "movie"}/${tmdb}` });
  links.push({ site: "rt", label: "Rotten Tomatoes", url: `https://www.rottentomatoes.com/search?search=${encodeURIComponent(meta.name)}` });
  return links;
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

/** Rotten Tomatoes counts 60% and up as fresh. */
const fresh = (n: number) => n >= 60;

/** Big scores for the details: one tile per service that has one. IMDb's is the badge up top. */
function ScoreCards({ ratings }: { ratings?: ExternalRatings }) {
  const tiles: { key: string; label: string; value: string; note?: string; tone?: string }[] = [];
  if (ratings?.rottenTomatoes != null)
    tiles.push({
      key: "rt",
      label: "Tomatometer",
      value: `${ratings.rottenTomatoes}%`,
      note: fresh(ratings.rottenTomatoes) ? "Fresh" : "Rotten",
      tone: fresh(ratings.rottenTomatoes) ? "fresh" : "rotten",
    });
  if (ratings?.audience != null)
    tiles.push({ key: "audience", label: "Audience", value: `${ratings.audience}%`, note: "Rotten Tomatoes", tone: fresh(ratings.audience) ? "fresh" : "rotten" });
  if (ratings?.metacritic != null)
    tiles.push({
      key: "mc",
      label: "Metacritic",
      value: String(ratings.metacritic),
      tone: ratings.metacritic >= 61 ? "good" : ratings.metacritic >= 40 ? "mid" : "low",
    });
  if (ratings?.letterboxd != null) tiles.push({ key: "lb", label: "Letterboxd", value: `${ratings.letterboxd.toFixed(1)} ★`, note: "out of 5" });
  if (ratings?.trakt != null) tiles.push({ key: "trakt", label: "Trakt", value: `${ratings.trakt}%` });
  if (!tiles.length) return null;
  return (
    <div className="score-cards">
      {tiles.map((t) => (
        <div key={t.key} className="score-card" data-kind={t.key} data-tone={t.tone}>
          <span className="score-card-label">{t.label}</span>
          <span className="score-card-value tabular">{t.value}</span>
          {t.note && <span className="score-card-note">{t.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** Small scores beside the rating in a title's hero (Rotten Tomatoes, Metacritic, Letterboxd). */
export function ScoreChips({ type, id }: { type: ContentType; id: string }) {
  const { data: r } = useRatings(type, id);
  if (!r) return null;
  return (
    <>
      {r.rottenTomatoes != null && (
        <span className="score-chip" data-tone={fresh(r.rottenTomatoes) ? "fresh" : "rotten"} title="Rotten Tomatoes Tomatometer">
          <span className="score-chip-mark" aria-hidden>
            {fresh(r.rottenTomatoes) ? "🍅" : "🟢"}
          </span>
          <span className="tabular">{r.rottenTomatoes}%</span>
        </span>
      )}
      {r.audience != null && (
        <span className="score-chip" title="Rotten Tomatoes audience score">
          <span className="score-chip-mark" aria-hidden>
            🍿
          </span>
          <span className="tabular">{r.audience}%</span>
        </span>
      )}
      {r.metacritic != null && (
        <span className="score-chip" data-kind="mc" title="Metacritic">
          <span className="score-chip-box tabular" data-tone={r.metacritic >= 61 ? "good" : r.metacritic >= 40 ? "mid" : "low"}>
            {r.metacritic}
          </span>
        </span>
      )}
      {r.letterboxd != null && (
        <span className="score-chip" title="Letterboxd average">
          <span className="score-chip-lb" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="tabular">{r.letterboxd.toFixed(1)}</span>
        </span>
      )}
    </>
  );
}
