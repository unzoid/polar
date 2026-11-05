import {
  type Anime,
  type AnimeCard,
  cleanDescription,
  countdown,
  FORMAT_LABEL,
  heroLogo,
  SEASON_LABEL,
  STATUS_LABEL,
  untilAiring,
  upNextLabel,
  useAnimeScore,
} from "../../lib/anime";
import { joinFacts } from "../../lib/format";
import { usePrefs } from "../../lib/settings";
import { Star, Volume, VolumeMuted } from "../icons";
import { IconButton } from "../ui/Button";
import { useEffect } from "react";
import { SourcePicker, useSourcePicker } from "../title/SourcePicker";
import { TitleActions } from "../title/TitleActions";
import { TitleHeading } from "../title/TitleHeading";
import { openTrailer } from "../Trailer";
import { useAnimePlayback } from "./useAnimePlayback";
import { Skeleton } from "../ui/Skeleton";

/**
 * The top of an anime's page: its name (or logo), the facts line, the next
 * episode's airing time, the first paragraph of its story and the action row,
 * playing whatever is up next.
 */
export function AnimeHero({
  item,
  anime,
  logo,
  name,
  onImdb,
  trailer,
}: {
  item: AnimeCard;
  anime?: Anime;
  logo?: string;
  name: string;
  /** The id it plays from, once known (the page's backdrop trailer is that title's). */
  onImdb?: (id: string | undefined) => void;
  trailer?: { visible: boolean; muted: boolean; toggleMute: () => void };
}) {
  const pb = useAnimePlayback(anime ?? item);
  useEffect(() => onImdb?.(pb.metaId), [onImdb, pb.metaId]);
  const picker = useSourcePicker();
  const prefs = usePrefs();

  const target = pb.isMovie ? pb.metaId : pb.next.ep?.video?.id;
  const request = target &&
    pb.metaId && {
      type: pb.isMovie ? ("movie" as const) : ("series" as const),
      metaId: pb.metaId,
      videoId: target,
      resumable: !!pb.next.resumeAt,
      subtitle: pb.next.ep ? `Episode ${pb.next.ep.number}${pb.next.ep.title ? ` · ${pb.next.ep.title}` : ""}` : name,
    };

  const label = upNextLabel(pb.next, pb.isMovie);

  const unavailable =
    !pb.loading && !pb.metaId
      ? "Not linked to any sources yet"
      : !pb.metaLoading && pb.metaId && !target && !pb.isMovie
        ? "No episodes to play yet"
        : undefined;
  const shownLogo = heroLogo({ aniZipLogo: logo, metaId: pb.metaId, meta: pb.meta, metaLoading: pb.metaLoading });
  // Under a logo of unknown language, the name the user reads; otherwise the other script.
  const nativeTitle = shownLogo.logo && !shownLogo.readable ? name : prefs.animeTitles === "native" ? item.title.romaji : item.title.native;
  const score = useAnimeScore()(item.averageScore);
  const studio = anime?.studios.edges.find((e) => e.isMain && e.node.isAnimationStudio)?.node.name;
  const next = item.nextAiringEpisode;
  const paragraphs = cleanDescription(anime?.description);

  return (
    <section className="detail-hero anime-hero">
      <div className="detail-hero-main">
        <TitleHeading name={name} logo={shownLogo.logo} look="detail" />
        {nativeTitle && (nativeTitle !== name || (shownLogo.logo && !shownLogo.readable)) && <p className="anime-native t-callout">{nativeTitle}</p>}
        <p className="detail-facts anime-meta-line t-callout tabular">
          {score && (
            <span className="anime-score" title="AniList score">
              <Star size={13} /> {score}
            </span>
          )}
          {joinFacts([
            item.format && FORMAT_LABEL[item.format],
            item.season && item.seasonYear ? `${SEASON_LABEL[item.season]} ${item.seasonYear}` : item.seasonYear,
            item.format === "MOVIE" ? item.duration && `${item.duration} min` : item.episodes && `${item.episodes} episodes`,
            item.status && STATUS_LABEL[item.status],
            studio,
          ])}
        </p>
        {next && (
          <p className="anime-next t-callout tabular" title={new Date(next.airingAt * 1000).toLocaleString()}>
            <span className="anime-next-ep">Episode {next.episode}</span>{" "}
            {new Date(next.airingAt * 1000).toLocaleDateString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}
            {" · in "}
            {countdown(untilAiring(next.airingAt))}
          </p>
        )}
        {item.genres?.length ? <p className="anime-genres t-caption">{item.genres.join("  ·  ")}</p> : null}
        {anime ? (
          paragraphs[0] && <p className="detail-description t-callout">{paragraphs[0]}</p>
        ) : (
          // The entry's details are still coming: lines where its description goes (re-test N4).
          <div className="detail-description detail-description-loading" aria-label="Loading">
            <Skeleton shape="line" width="100%" />
            <Skeleton shape="line" width="92%" />
            <Skeleton shape="line" width="64%" />
          </div>
        )}

        <TitleActions
          request={request}
          picker={picker}
          label={label}
          resume={!!pb.next.resumeAt}
          playTitle={unavailable}
          loading={!unavailable && (pb.loading || pb.metaLoading || !anime)}
          onTrailer={
            anime?.trailer?.site === "youtube"
              ? () => openTrailer({ name, imdbId: pb.metaId?.startsWith("tt") ? pb.metaId : undefined, ytId: anime.trailer!.id, ytFrom: "AniList" })
              : undefined
          }
          item={pb.meta}
        >
          {trailer?.visible && (
            <IconButton
              variant="glass"
              className="detail-mute"
              onClick={trailer.toggleMute}
              label={trailer.muted ? "Turn trailer sound on" : "Mute trailer"}
              title={trailer.muted ? "Sound on" : "Mute"}
            >
              {trailer.muted ? <VolumeMuted size={20} /> : <Volume size={20} />}
            </IconButton>
          )}
        </TitleActions>
        {unavailable && <p className="anime-unavailable t-caption">{unavailable}</p>}
      </div>

      <SourcePicker picker={picker} />
    </section>
  );
}
