import { useQueryClient } from "@tanstack/react-query";
import {
  type AnimeCard as Media,
  aniZipQuery,
  cardFacts,
  countdown,
  fetchAnime,
  FORMAT_LABEL,
  isMature,
  landscapeArt,
  untilAiring,
  useAnimeScore,
  useAnimeTitle,
  useListedImdb,
} from "../../lib/anime";
import { usePrefs } from "../../lib/settings";
import { useRouter } from "../../lib/router";
import { menuPoint, openCardMenu } from "../CardMenu";
import { api } from "../../lib/api";
import { useCardIntent } from "../../lib/ui";
import { ArtTitle, Card } from "../title/Card";
import { Star, Warning } from "../icons";
import { keys } from "../../lib/net";

/**
 * Settings → Browsing → Mature content, "blur": the art behind dark frosted
 * glass with a warning and "18+". A warning, not a no-entry sign: the card
 * still opens.
 */
function MatureCover() {
  return (
    <span className="card-mature" title="Mature content" aria-label="Mature content">
      <Warning size={24} />
      <span className="card-mature-label">18+</span>
    </span>
  );
}

/** How long the pointer or focus rests on a card before its page is fetched. */
const INTENT_DELAY = 150;

/** Click and right-click for an anime: its page, and the shared title menu. */
export function useAnimeHandlers() {
  const { navigate } = useRouter();
  const qc = useQueryClient();
  return (item: Media) => ({
    onClick: () => navigate({ name: "anime-detail", id: item.id, preview: item }),
    // The menu works on the id the show plays from (what the library, playlists and watch history key on):
    // the IMDb title ani.zip links it to, else its Kitsu id, as the anime page does. With neither (an
    // upcoming show, often), or no answer from ani.zip, it still opens, with only "Go to Show".
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      const at = menuPoint(e);
      const page = () => navigate({ name: "anime-detail", id: item.id, preview: item });
      void qc
        .fetchQuery({ ...aniZipQuery(item.id), staleTime: 30 * 60_000 })
        .catch(() => null)
        .then((zip) => {
          const kitsu = zip?.mappings?.kitsu_id;
          const id = zip?.mappings?.imdb_id ?? (kitsu ? `kitsu:${kitsu}` : undefined);
          const name = item.title.english ?? item.title.romaji ?? item.title.native ?? "";
          const poster = item.coverImage.extraLarge ?? item.coverImage.large ?? undefined;
          const type = item.format === "MOVIE" ? "movie" : "series";
          openCardMenu({ id: id ?? `anilist:${item.id}`, type, name, poster }, at, page, { linked: !!id });
        });
    },
  });
}

/** Opens an anime's page, warming its data once the pointer rests on the card. */
export function useOpenAnime(item: Media) {
  const qc = useQueryClient();
  const intent = useCardIntent(
    () => void qc.prefetchQuery({ queryKey: keys.anime.media(item.id), queryFn: () => fetchAnime(item.id), staleTime: 30 * 60_000 }),
    INTENT_DELAY,
  );
  return { ...useAnimeHandlers()(item), ...intent };
}

/**
 * An anime's poster: the cover with its own key colour behind it while it
 * loads and, as Settings → Anime has them, the AniList score and when the next
 * episode lands. `label` replaces the caption's facts (a relation type,
 * "Episode 5 · 18:30").
 */
export function AnimeCard({ item, label }: { item: Media; label?: string }) {
  const title = useAnimeTitle()(item.title);
  const open = useOpenAnime(item);
  const prefs = usePrefs();
  const next = prefs.animeCardCountdown ? item.nextAiringEpisode : undefined;
  const score = useAnimeScore()(prefs.animeCardScores ? item.averageScore : undefined);
  // A manga or novel in a franchise has no page here: it opens on MyAnimeList
  // (AniList when MAL doesn't list it), badged so it doesn't pass for a show.
  const isAnime = item.type !== "MANGA";
  if (prefs.matureContent === "hide" && isMature(item)) return null;
  const readOn = item.idMal ? `https://myanimelist.net/manga/${item.idMal}` : `https://anilist.co/manga/${item.id}`;

  return (
    <Card
      shape="poster"
      className="anime-card"
      frameClass="anime-card-frame"
      art={item.coverImage.extraLarge ?? item.coverImage.large ?? undefined}
      title={title}
      // On air: when the next episode lands, in place of the usual facts.
      detail={
        label ??
        (next
          ? [item.format && FORMAT_LABEL[item.format], `Ep ${next.episode} in ${countdown(untilAiring(next.airingAt))}`].filter(Boolean).join(" · ")
          : cardFacts(item))
      }
      {...(isAnime ? open : { onClick: () => void api.openExternal(readOn), hint: "Open on MyAnimeList" })}
      style={{ "--cover": item.coverImage.color ?? undefined } as React.CSSProperties}
    >
      {prefs.matureContent === "blur" && isMature(item) && <MatureCover />}
      {!isAnime && <span className="card-kind-badge">{item.format === "NOVEL" ? "Novel" : "Manga"}</span>}
      {score && (
        <span className="card-score card-score-art anime-card-score tabular" title="AniList score">
          <Star size={11} />
          {score}
        </span>
      )}
    </Card>
  );
}

/** The widescreen card, for the shelves Home draws that way: the banner with the title over it. */
export function AnimeLandscapeCard({ item, label }: { item: Media; label?: string }) {
  const title = useAnimeTitle()(item.title);
  const open = useOpenAnime(item);
  const { matureContent } = usePrefs();
  // Wide art first (re-test N5); nothing until the id lists answer, so the picture doesn't change once drawn.
  const imdb = useListedImdb(item.id);
  const [art, ...artFallbacks] = imdb === undefined ? [] : landscapeArt({ imdb, bannerImage: item.bannerImage, cover: item.coverImage.extraLarge });
  if (matureContent === "hide" && isMature(item)) return null;
  return (
    <Card
      shape="landscape"
      className="anime-card"
      frameClass="anime-card-frame"
      art={art}
      artFallbacks={artFallbacks}
      title={title}
      detail={label ?? cardFacts(item)}
      {...open}
      style={{ "--cover": item.coverImage.color ?? undefined } as React.CSSProperties}
    >
      <ArtTitle name={title} />
      {matureContent === "blur" && isMature(item) && <MatureCover />}
    </Card>
  );
}
