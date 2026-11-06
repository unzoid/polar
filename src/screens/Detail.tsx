import { LayoutList, LayoutRow, Volume, VolumeMuted } from "../components/icons";
import { NameList } from "../components/title/NameList";
import { useArtGate, useFoldSnap, useFormFactor } from "../lib/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBackdropTrailer, usePageOnTop } from "../components/BackdropTrailer";
import { cardMenu } from "../components/CardMenu";
import { FormatBadges, ScoreChips, TitleDetails } from "../components/title/TitleDetails";
import { openTrailer, useTrailerOpen } from "../components/Trailer";
import { episodeEntry, progressMap, seasonsOf, upNext } from "../lib/library";
import { EpisodeShelf } from "../components/title/EpisodeShelf";
import { EdgeBlur } from "../components/EdgeBlur";
import { SeasonPicker } from "../components/title/SeasonPicker";
import { Img } from "../components/Img";
import { TitleHeading } from "../components/title/TitleHeading";
import { RatingRing } from "../components/RatingRing";
import { Segmented } from "../components/Segmented";
import { SourcePicker, useSourcePicker } from "../components/title/SourcePicker";
import { episodeCode, formatRuntime, isReleased, joinFacts, seasonLabel } from "../lib/format";
import { type PlayRequest, trailerFor, useFileTrailer, usePlayTarget } from "../lib/playback";
import { prefetchStreams, useMeta, useProgress, useSettings, useStreams } from "../lib/net";
import type { ContentType, EpisodeLayout, Meta, MetaPreview, Video } from "../lib/types";
import { IconButton } from "../components/ui/Button";
import { TitleActions } from "../components/title/TitleActions";
import { EmptyState } from "../components/ui/EmptyState";
import { BatchDownload } from "../components/BatchDownload";
import { Skeleton } from "../components/ui/Skeleton";
import { errorMessage } from "../lib/errors";

/**
 * Title page in the Apple TV layout: the art fills the window, the title
 * treatment and actions sit bottom-left, credits bottom-right, and the
 * seasons/episodes peek in below. Scrolling down blurs the art into an
 * ambient backdrop (scroll-driven CSS — no JS on scroll).
 */
export function Detail({ type, id, preview }: { type: ContentType; id: string; preview?: MetaPreview }) {
  const { data: meta, isError, error } = useMeta(type, id);
  // Render instantly from the catalog preview; fill in when full meta arrives.
  const shown: MetaPreview | undefined = meta ?? preview;

  // The trailer behind the page: only while it's the page on top, and paused
  // once you've scrolled down to read or a sheet or the big trailer is open.
  const root = useRef<HTMLDivElement>(null);
  const onTop = usePageOnTop(root);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [sheets, setSheets] = useState(0);
  const onSheet = useCallback((open: boolean) => setSheets((n) => Math.max(0, n + (open ? 1 : -1))), []);
  const bigTrailer = !!useTrailerOpen();
  const trailer = useBackdropTrailer(id, {
    active: onTop,
    paused: scrolledAway || sheets > 0 || bigTrailer,
  });

  const scroller = useRef<HTMLDivElement>(null);
  useFoldSnap(scroller, !!shown);
  // A phone's page scrolls as one: the art sits at its top and leaves with it (detail.css), instead
  // of staying behind the page as on a big screen.
  const phone = useFormFactor().form === "phone";

  if (isError && !shown) return <EmptyState>Couldn't load this title: {errorMessage(error)}</EmptyState>;
  if (!shown) return <Skeleton className="detail-loading" />;

  const art = (
    <div className="detail-bg" aria-hidden>
      <Img src={shown.background} alt="" loading="eager" className="detail-bg-sharp" />
      {trailer.node}
      {/* No backdrop (or it fails): the poster, blurred, rather than plain black. */}
      <Img src={shown.background} fallbacks={[shown.poster]} alt="" loading="eager" className="detail-bg-blur" />
      <div className="detail-bg-scrim" />
    </div>
  );

  return (
    <div className="detail" ref={root} data-trailer={trailer.visible} data-type={type}>
      {!phone && art}
      <div
        className="scroll detail-scroll"
        ref={scroller}
        onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > e.currentTarget.clientHeight * 0.25)}
      >
        {phone && art}
        <DetailHero item={shown} meta={meta} onSheet={onSheet} trailer={trailer} />
        {type === "series" && meta && <SeriesBody meta={meta} onSheet={onSheet} />}
        {type === "movie" && meta && (
          <section className="about">
            <h2 className="t-title2">About</h2>
            <TitleDetails meta={meta} />
          </section>
        )}
      </div>
      {/* Teases what's below the fold; clears as you scroll. */}
      <EdgeBlur className="detail-fold" />
    </div>
  );
}

function DetailHero({
  item,
  meta,
  onSheet,
  trailer,
}: {
  item: MetaPreview;
  meta?: Meta;
  onSheet: (open: boolean) => void;
  trailer: { visible: boolean; muted: boolean; toggleMute: () => void };
}) {
  const picker = useSourcePicker(onSheet);

  const isSeries = item.type === "series";
  const { next, videoId, resumeAt, label: primaryLabel } = usePlayTarget(item, meta);
  const { data: fileTrailer } = useFileTrailer(item.id);

  // Sources for the primary action load as soon as the page opens, so Play
  // (or the source list) is ready by the time the user reaches for it.
  useStreams(item.type, videoId);
  const request = videoId && {
    type: item.type,
    metaId: item.id,
    videoId,
    resumable: !!resumeAt,
    subtitle: isSeries && next?.video ? `${episodeCode(next.video.season, next.video.episode)} · ${next.video.title}` : item.name,
  };

  const facts = joinFacts([item.releaseInfo, formatRuntime(meta?.runtime)]);
  // The logo or name waits for the backdrop (or the poster blurred in its place, as the page draws it; #173).
  const gate = useArtGate(item.background, [item.poster]);

  return (
    <section className="detail-hero" {...gate}>
      <div className="detail-hero-main">
        <TitleHeading name={item.name} logo={item.logo} logos={item.logos} backdrop={item.background} look="detail" />
        {item.description && <p className="detail-description t-callout">{item.description}</p>}
        <p className="detail-facts t-callout tabular">
          {item.imdbRating && <RatingRing value={item.imdbRating} imdbId={item.id} />}
          {facts && <span>{facts}</span>}
          <ScoreChips type={item.type} id={item.id} />
          <FormatBadges type={item.type} videoId={videoId} />
        </p>

        <TitleActions
          request={request}
          picker={picker}
          label={primaryLabel}
          resume={!!resumeAt}
          onWarm={() => videoId && prefetchStreams(item.type, videoId)}
          onTrailer={meta?.trailerYtId || fileTrailer ? () => openTrailer(trailerFor(item.name, item.id, meta)) : undefined}
          item={item}
          playlist
          download={item.type === "movie"}
        >
          {trailer.visible && (
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
      </div>

      {(meta?.cast?.length || meta?.director?.length) ? (
        <dl className="detail-credits t-callout">
          {meta.cast?.length ? (
            <div>
              <dt>Starring</dt> <dd><NameList names={meta.cast.slice(0, 3)} /></dd>
            </div>
          ) : null}
          {meta.director?.length ? (
            <div>
              <dt>{isSeries ? "Created by" : "Director"}</dt> <dd><NameList names={meta.director.slice(0, 2)} /></dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <SourcePicker picker={picker} />
    </section>
  );
}

/** A show below the fold: its episodes, then everything else about it, as a movie's About. */
function SeriesBody({ meta, onSheet }: { meta: Meta; onSheet: (open: boolean) => void }) {
  return (
    <>
      <Seasons meta={meta} onSheet={onSheet} />
      <section className="about about-series">
        <h2 className="t-title2">About</h2>
        <TitleDetails meta={meta} />
      </section>
    </>
  );
}

function Seasons({ meta, onSheet }: { meta: Meta; onSheet: (open: boolean) => void }) {
  const { data: progress } = useProgress(meta.id);
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const next = useMemo(() => upNext(meta, progress ?? []), [meta, progress]);
  const [season, setSeason] = useState<number | undefined>();
  // This page's choice; until you pick one, the default from Settings.
  const [layoutChoice, setLayout] = useState<EpisodeLayout | undefined>();
  const picker = useSourcePicker(onSheet);

  // Open on the season you're actually in, not always season 1 — so wait
  // for watch progress before choosing.
  useEffect(() => {
    if (season === undefined && progress !== undefined && next.video) setSeason(next.video.season);
  }, [next.video, season, progress]);

  const current = season ?? seasons[0];
  const episodes = meta.videos.filter((v) => v.season === current);
  const map = useMemo(() => progressMap(progress), [progress]);

  const { data: settings } = useSettings();
  const layout = layoutChoice ?? settings?.episodeLayout ?? "row";
  // A started episode keeps its file.
  const request = (v: Video): PlayRequest => ({
    type: "series",
    metaId: meta.id,
    videoId: v.id,
    resumable: map.has(v.id),
    subtitle: `${episodeCode(v.season, v.episode)} · ${v.title}`,
  });

  return (
    <section className="seasons">
      <div className="seasons-bar">
        <div className="seasons-picker">
          <SeasonPicker value={current} onChange={setSeason} options={seasons.map((s) => ({ id: s, label: seasonLabel(s) }))} />
        </div>
        <BatchDownload item={meta} videos={downloadableEpisodes(episodes)} season={current} />
        <Segmented
          label="Episode layout"
          value={layout}
          onChange={setLayout}
          options={[
            { id: "row", label: "Row", icon: <LayoutRow size={18} /> },
            { id: "list", label: "List", icon: <LayoutList size={18} /> },
          ]}
        />
      </div>
      <EpisodeShelf
        item={meta}
        layout={layout}
        episodes={episodes}
        progress={map}
        runtime={meta.runtime}
        upNextId={next.kind !== "start" ? next.video?.id : undefined}
        onPlay={(v) => picker.play(request(v))}
        onSources={(v) => picker.choose(request(v))}
        menu={(v) => cardMenu(meta, episodeEntry(meta, v, map.get(v.id)), { episode: true })}
      />
      <SourcePicker picker={picker} />
    </section>
  );
}

/** The episodes a season or show download takes (#24): released ones, specials aside, in order. */
const downloadableEpisodes = (videos: Video[]) =>
  videos.filter((v) => v.season > 0 && isReleased(v)).sort((a, b) => a.season - b.season || a.episode - b.episode);
