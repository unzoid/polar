import { useQueryClient } from "@tanstack/react-query";
import {
  type AnimeCard as Media,
  aniZipQuery,
  cardFacts,
  countdown,
  entryAction,
  type EntryAction,
  prefetchAnime,
  FORMAT_LABEL,
  isMature,
  landscapeArt,
  posterArt,
  untilAiring,
  useAnimeScore,
  useAnimeTitle,
  useLinkedImdb,
} from "../../lib/anime";
import { usePrefs } from "../../lib/settings";
import { useRouter } from "../../lib/router";
import { menuPoint, openCardMenu } from "../CardMenu";
import { api } from "../../lib/api";
import { useCardIntent } from "../../lib/ui";
import { ArtTitle, Card } from "../title/Card";
import { Star, Warning } from "../icons";
import { openTrailer } from "../Trailer";

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
    () => void prefetchAnime(qc, item.id),
    INTENT_DELAY,
  );
  return { ...useAnimeHandlers()(item), ...intent };
}

/**
 * An anime's poster: the cover with its own key colour behind it while it
 * loads and, as Settings → Anime has them, the AniList score and when the next
 * episode lands. `label` replaces the caption's facts (a relation type,
 * "Episode 5 · 18:30"). `onOpen` replaces opening its page (a season tab of the
 * page it's on); `current` marks the entry on screen. `action` is what a click
 * does instead of opening its page (lib/anime/franchiseEntry.ts); a manga or
 * novel always opens on the site Settings → Anime picks.
 */
export function AnimeCard({
  item,
  label,
  onOpen,
  current,
  action: given,
}: {
  item: Media;
  label?: string;
  onOpen?: (e: React.MouseEvent<HTMLElement>) => void;
  current?: boolean;
  action?: EntryAction;
}) {
  const title = useAnimeTitle()(item.title);
  const open = useOpenAnime(item);
  const prefs = usePrefs();
  const next = prefs.animeCardCountdown ? item.nextAiringEpisode : undefined;
  const score = useAnimeScore()(prefs.animeCardScores ? item.averageScore : undefined);
  // A manga or novel in a franchise has no page here: it opens on the chosen site (AniList when MyAnimeList
  // doesn't list it), badged so it doesn't pass for a show; so does an entry Polarity can't play (#192).
  const isAnime = item.type !== "MANGA";
  const action: EntryAction = given ?? (isAnime ? { kind: "page" } : entryAction(item, prefs.animeReadOn));
  // The linked IMDb title's poster first, so every season of a show looks alike (#27), unless seasons are
  // separate shows (#194): then the entry's own cover. Nothing until the links answer.
  const imdb = useLinkedImdb(isAnime ? item.id : 0);
  const cover = item.coverImage.extraLarge ?? item.coverImage.large;
  const separate = prefs.animeSeparateEntries;
  const [art, ...artFallbacks] = !isAnime ? (cover ? [cover] : []) : imdb === undefined ? [] : posterArt({ imdb, cover, separate });
  if (prefs.matureContent === "hide" && isMature(item)) return null;
  const click =
    action.kind === "site"
      ? { onClick: () => void api.openExternal(action.url), hint: `Open on ${action.site}` }
      : action.kind === "youtube"
        ? { onClick: () => openTrailer({ name: title, ytId: action.ytId, ytFirst: true, ytFrom: "AniList" }), hint: "Play on YouTube" }
        : open;

  return (
    <Card
      shape="poster"
      className={current ? "anime-card anime-card-current" : "anime-card"}
      aria-current={current || undefined}
      frameClass="anime-card-frame"
      art={art}
      artFallbacks={artFallbacks}
      title={title}
      // On air: when the next episode lands, in place of the usual facts.
      detail={
        label ??
        (next
          ? [item.format && FORMAT_LABEL[item.format], `Ep ${next.episode} in ${countdown(untilAiring(next.airingAt))}`].filter(Boolean).join(" · ")
          : cardFacts(item))
      }
      {...click}
      {...(onOpen && { onClick: onOpen })}
      style={{ "--cover": item.coverImage.color ?? undefined } as React.CSSProperties}
    >
      {prefs.matureContent === "blur" && isMature(item) && <MatureCover />}
      {action.kind !== "page" && <span className="card-kind-badge">{action.badge}</span>}
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
  const { matureContent, animeSeparateEntries: separate } = usePrefs();
  // Wide art first (re-test N5), the entry's own with seasons as separate shows (#194); nothing until the links
  // answer, so the picture doesn't change once drawn.
  const imdb = useLinkedImdb(item.id);
  const [art, ...artFallbacks] =
    imdb === undefined ? [] : landscapeArt({ imdb, bannerImage: item.bannerImage, cover: item.coverImage.extraLarge, separate });
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
