import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { fetchAnime, type AnimeCard as Card } from "../../lib/anime/anilist";
import { cardFacts, countdown, FORMAT_LABEL, untilAiring, useAnimeScore, useAnimeTitle } from "../../lib/anime/format";
import { usePrefs } from "../../lib/prefs";
import { useRouter } from "../../lib/router";
import { aniZipQuery } from "../../lib/anime/anizip";
import { menuPoint, openCardMenu } from "../CardMenu";
import { Img } from "../Img";
import { Star } from "../icons";

/** Click and right-click for an anime: its page, and the shared title menu. */
export function useAnimeHandlers() {
  const { navigate } = useRouter();
  const qc = useQueryClient();
  return (item: Card) => ({
    onClick: () => navigate({ name: "anime-detail", id: item.id, preview: item }),
    // The menu works on the IMDb title ani.zip links the show to (that's what
    // the library, playlists and watch history key on).
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      const at = menuPoint(e);
      void qc.fetchQuery({ ...aniZipQuery(item.id), staleTime: 30 * 60_000 }).then((zip) => {
        const imdb = zip?.mappings?.imdb_id;
        if (!imdb) return;
        const name = item.title.english ?? item.title.romaji ?? item.title.native ?? "";
        openCardMenu(
          { id: imdb, type: item.format === "MOVIE" ? "movie" : "series", name, poster: item.coverImage.extraLarge ?? item.coverImage.large ?? undefined },
          at,
          () => navigate({ name: "anime-detail", id: item.id, preview: item }),
        );
      });
    },
  });
}

/** Opens an anime's page, warming its data once the pointer rests on the card. */
export function useOpenAnime(item: Card) {
  const qc = useQueryClient();
  const timer = useRef<number>(undefined);
  return {
    ...useAnimeHandlers()(item),
    onPointerEnter: () => {
      timer.current = window.setTimeout(
        () => qc.prefetchQuery({ queryKey: ["anime", "media", item.id], queryFn: () => fetchAnime(item.id), staleTime: 30 * 60_000 }),
        150,
      );
    },
    onPointerLeave: () => window.clearTimeout(timer.current),
  };
}

/**
 * An anime's poster: the cover with its own key colour behind it while it
 * loads and, as Settings → Anime has them, the AniList score and when the next
 * episode lands. `label` replaces the caption's facts (a relation type,
 * "Episode 5 · 18:30").
 */
export function AnimeCard({ item, label }: { item: Card; label?: string }) {
  const title = useAnimeTitle()(item.title);
  const open = useOpenAnime(item);
  const prefs = usePrefs();
  const next = prefs.animeCardCountdown ? item.nextAiringEpisode : undefined;
  const score = useAnimeScore()(prefs.animeCardScores ? item.averageScore : undefined);
  const isAnime = item.type !== "MANGA";

  return (
    <button
      className="card card-poster anime-card"
      {...(isAnime ? open : {})}
      disabled={!isAnime}
      style={{ "--cover": item.coverImage.color ?? undefined } as React.CSSProperties}
    >
      <div className="card-frame anime-card-frame">
        <Img src={item.coverImage.extraLarge ?? item.coverImage.large ?? undefined} alt="" className="card-img" />
        {score && (
          <span className="card-score card-score-art anime-card-score tabular" title="AniList score">
            <Star size={11} />
            {score}
          </span>
        )}
      </div>
      <div className="card-caption">
        <span className="card-title t-callout">{title}</span>
        {/* On air: when the next episode lands, in place of the usual facts. */}
        <span className="t-caption faint tabular">
          {label ??
            (next
              ? [item.format && FORMAT_LABEL[item.format], `Ep ${next.episode} in ${countdown(untilAiring(next.airingAt))}`].filter(Boolean).join(" · ")
              : cardFacts(item))}
        </span>
      </div>
    </button>
  );
}

/** The widescreen card, for the shelves Home draws that way: the banner with the title over it. */
export function AnimeLandscapeCard({ item, label }: { item: Card; label?: string }) {
  const title = useAnimeTitle()(item.title);
  const open = useOpenAnime(item);
  return (
    <button
      className="card card-landscape anime-card"
      {...open}
      style={{ "--cover": item.coverImage.color ?? undefined } as React.CSSProperties}
    >
      <div className="card-frame anime-card-frame">
        <Img src={item.bannerImage ?? item.coverImage.extraLarge ?? undefined} alt="" className="card-img" />
        <div className="card-art-scrim" />
        <span className="card-art-title t-title2">{title}</span>
      </div>
      <div className="card-caption">
        <span className="card-title t-callout">{title}</span>
        <span className="t-caption faint tabular">{label ?? cardFacts(item)}</span>
      </div>
    </button>
  );
}
