import { api } from "../../lib/api";
import { formatDate, formatRuntime } from "../../lib/format";
import { usePersonPhoto } from "../../lib/catalog";
import { useQuery } from "@tanstack/react-query";
import { keys, useRatings, useStreams } from "../../lib/net";
import { isFresh, metacriticTone } from "../../lib/ui";
import type { ReactNode } from "react";
import type { ContentType, ExternalRatings, Meta } from "../../lib/types";
import { letterboxdUrl } from "../CardMenu";
import { BrandIcon } from "../BrandIcon";
import { ArrowUpRight } from "../icons";
import { Img } from "../Img";
import { imdbUrl } from "../RatingRing";
import { Chip } from "../ui/Chip";

/**
 * Everything about a title below the fold: who's in it (with faces where the source has them), the facts,
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

      {people.length > 0 && (
        <DetailsSection label="Cast">
          <ul className="people">
            {people.slice(0, 18).map((p, i) => (
              // The index too: the same person can be listed twice in one role.
              <Cast key={`${p.name}/${p.character ?? ""}/${i}`} person={p} />
            ))}
          </ul>
        </DetailsSection>
      )}

      <DetailsColumns facts={info}>
        {(meta.description || awards) && (
          <div className="details-main">
            {meta.description && (
              <DetailsSection as="div" label="Story">
                <p className="details-story">{meta.description}</p>
              </DetailsSection>
            )}
            {/* Under the story rather than below the facts, which leaves a hole beside a short synopsis. */}
            {awards && (
              <DetailsSection as="div" label="Awards">
                <p className="details-awards">{awards}</p>
              </DetailsSection>
            )}
          </div>
        )}
      </DetailsColumns>

      {/* Links open a browser: no use on a TV. */}
      {showLinks && links.length > 0 && (
        <DetailsLinks label="Elsewhere">
          {links.map((l) => (
            <Chip key={l.label} variant="link" data-site={l.site} onClick={() => void api.openExternal(l.url)}>
              <BrandIcon site={l.site} size={15} />
              {l.label}
              <ArrowUpRight className="details-link-out" size={13} aria-hidden />
            </Chip>
          ))}
        </DetailsLinks>
      )}
    </div>
  );
}

/**
 * The parts every details section is made of, shared with the anime page's
 * (components/anime/AnimeDetails.tsx): a small label over its content, the
 * story-and-facts columns, and a row of link chips.
 */
export function DetailsSection({
  label,
  as: Tag = "section",
  className,
  children,
}: {
  label: string;
  /** "div" for a part inside a column, which isn't a section of its own (and takes no class). */
  as?: "section" | "div";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={Tag === "section" ? ["details-section", className].filter(Boolean).join(" ") : className}>
      <h3 className="details-label">{label}</h3>
      {children}
    </Tag>
  );
}

/** Whatever goes down the left (the story, mostly), with the facts beside it. */
export function DetailsColumns({ facts, children }: { facts: [string, string | undefined][]; children?: ReactNode }) {
  return (
    <section className="details-section details-columns">
      {children}
      <FactList facts={facts} />
    </section>
  );
}

/** Label over value, the ones without a value left out. */
export function FactList({ facts }: { facts: [string, string | undefined][] }) {
  return (
    <dl className="details-facts">
      {facts
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k}>
            <dt className="details-label">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** A labelled row of link chips. */
export function DetailsLinks({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DetailsSection label={label}>
      <div className="details-links">{children}</div>
    </DetailsSection>
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



/**
 * Every score the user's MDBList/OMDb key found, in one row under a title's
 * facts: each site's mark and its number. A score whose page on that site is
 * known opens it (the marks are only ever shown as links out). Nothing when
 * no key is set or nothing is known.
 */
export function ScoreRow({ ratings: r }: { ratings?: ExternalRatings }) {
  if (!r) return null;
  const links = r.links ?? {};
  const scores: { key: keyof typeof links; site: string; icon: ReactNode; value: string; tone?: string }[] = [];
  if (r.imdb != null) scores.push({ key: "imdb", site: "IMDb", icon: <BrandIcon site="imdb" />, value: r.imdb.toFixed(1) });
  if (r.tmdb != null) scores.push({ key: "tmdb", site: "TMDB", icon: <BrandIcon site="tmdb" />, value: String(r.tmdb) });
  if (r.trakt != null) scores.push({ key: "trakt", site: "Trakt", icon: <BrandIcon site="trakt" />, value: String(r.trakt) });
  if (r.letterboxd != null) scores.push({ key: "letterboxd", site: "Letterboxd", icon: <LetterboxdDots />, value: r.letterboxd.toFixed(1) });
  if (r.rottenTomatoes != null) {
    const fresh = isFresh(r.rottenTomatoes);
    scores.push({ key: "rottenTomatoes", site: `Rotten Tomatoes (${fresh ? "Fresh" : "Rotten"})`, icon: fresh ? <Tomato /> : <Splat />, value: `${r.rottenTomatoes}%`, tone: fresh ? "fresh" : "rotten" });
  }
  if (r.audience != null) {
    const fresh = isFresh(r.audience);
    scores.push({ key: "audience", site: "Rotten Tomatoes audience", icon: <Popcorn spilled={!fresh} />, value: `${r.audience}%`, tone: fresh ? "fresh" : "rotten" });
  }
  if (r.metacritic != null) scores.push({ key: "metacritic", site: "Metacritic", icon: <BrandIcon site="metacritic" />, value: String(r.metacritic), tone: metacriticTone(r.metacritic) });
  if (!scores.length) return null;
  return (
    <ul className="score-row t-callout tabular" aria-label="Scores">
      {scores.map((s) => {
        const href = links[s.key];
        const body = (
          <>
            <span className="score-row-icon">{s.icon}</span>
            <span className="score-row-value">{s.value}</span>
          </>
        );
        return (
          <li key={s.key} className="score-row-item" data-site={s.key} data-tone={s.tone} title={href ? `${s.site}: open the page` : s.site}>
            {href ? (
              <button className="score-row-link" onClick={() => void api.openExternal(href)} aria-label={`${s.site} ${s.value}, open on the site`}>
                {body}
              </button>
            ) : (
              <span aria-label={`${s.site} ${s.value}`}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Letterboxd's three dots, in their colours. */
const LetterboxdDots = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle cx="4.5" cy="12" r="4.4" fill="#ff8000" />
    <circle cx="12" cy="12" r="4.4" fill="#00e054" />
    <circle cx="19.5" cy="12" r="4.4" fill="#40bcf4" />
  </svg>
);

/** The audience score: a popcorn bucket, tipped over when under 60%. */
const Popcorn = ({ spilled }: { spilled: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <g transform={spilled ? "rotate(-35 8 9)" : undefined}>
      <circle cx="4.6" cy="5.6" r="2.1" fill={spilled ? "#0ac855" : "#ffd65c"} />
      <circle cx="8" cy="4.3" r="2.5" fill={spilled ? "#0ac855" : "#ffe9a3"} />
      <circle cx="11.4" cy="5.6" r="2.1" fill={spilled ? "#0ac855" : "#ffd65c"} />
      <path d="M2.8 6.6h10.4l-1.4 8.4H4.2z" fill="#fff" />
      <path d="M5 6.6h1.7l.4 8.4H5.6zM9.3 6.6H11l-.6 8.4H8.9z" fill={spilled ? "#0ac855" : "#fa320a"} />
    </g>
  </svg>
);

const Tomato = () => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <circle cx="8" cy="9" r="6.25" fill="#fa320a" />
    <path d="M8 3.6c-.9-1.3-2.4-1.6-3.4-1.1 1 .3 1.6.9 1.9 1.6-1.2-.2-2.2.2-2.8 1 1.3-.2 2.4.1 3.1.8.3-.6.7-.9 1.2-1 .5.1.9.4 1.2 1 .7-.7 1.8-1 3.1-.8-.6-.8-1.6-1.2-2.8-1 .4-.8 1-1.3 1.9-1.6-1-.5-2.5-.2-3.4 1.1Z" fill="#00912d" />
  </svg>
);

const Splat = () => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <path
      d="M8.2 1.5c.7 1.6.4 2.6 1.3 2.8 1 .2 1.6-1.4 3-1.2-.5 1.4-1.6 2-1 2.8.7.8 2.2-.2 3.1.6-1.3.8-2.4.6-2.3 1.6 0 1 1.7 1.3 1.7 2.6-1.4-.3-2-1.4-2.9-.8-.8.6.2 2.2-.6 3.2-.9-1.2-.6-2.5-1.6-2.6-1 0-1.2 1.6-2.6 2 .2-1.5 1.3-2.1.7-2.9-.6-.8-2.2.2-3.4-.5 1.2-.8 2.5-.8 2.5-1.7 0-.9-1.6-1-2.3-2.3 1.5 0 2.2.9 3 .4.8-.6.1-2 .4-3.5 1 .9 1 2.2 1.9 2.1.8-.1.6-1.5 1.8-3.7Z"
      fill="#0ac855"
    />
  </svg>
);

/**
 * What the sources for this title offer, as Apple TV's small outlined
 * badges: 4K, Dolby Vision (or HDR), Dolby Atmos, and CC when the subtitle
 * add-ons have subtitles. Read off the sources you can actually play (the
 * same, cached lookup the player makes), so a badge is a promise it keeps.
 */
export function FormatBadges({ type, videoId }: { type: ContentType; videoId?: string }) {
  const { data: streams } = useStreams(type, videoId);
  const { data: subs } = useQuery({
    queryKey: keys.subtitles(type, videoId),
    queryFn: () => api.subtitles(type, videoId!),
    enabled: !!videoId,
    staleTime: 60 * 60_000,
  });
  const playable = (streams?.streams ?? []).filter((r) => !r.quality.lowQualitySource).map((r) => r.quality);
  const badges = [
    playable.some((q) => (q.resolution ?? 0) >= 2160) && "4K",
    playable.some((q) => q.dolbyVision) ? "Dolby Vision" : playable.some((q) => q.hdr) && "HDR",
    playable.some((q) => q.tags?.some((t) => t.toLowerCase() === "atmos")) && "Dolby Atmos",
    !!subs?.length && "CC",
  ].filter((b): b is string => !!b);
  if (!badges.length) return null;
  return (
    <span className="format-badges">
      {badges.map((b) => (
        <span key={b} className="format-badge" data-long={b.length > 3 || undefined}>
          {b}
        </span>
      ))}
    </span>
  );
}
