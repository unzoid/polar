import { Check, LayoutList, LayoutRow, Play, Plus, Reset, Sources, Trailer, Volume, VolumeMuted } from "../components/icons";
import { useFoldSnap } from "../lib/useFoldSnap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBackdropTrailer, usePageOnTop } from "../components/BackdropTrailer";
import { cardMenu } from "../components/CardMenu";
import { ScoreChips, TitleDetails } from "../components/TitleDetails";
import { openTrailer, useTrailerOpen } from "../components/Trailer";
import { episodeEntry } from "../lib/watched";
import { EpisodeShelf } from "../components/EpisodeShelf";
import { EdgeBlur } from "../components/EdgeBlur";
import { DownloadButton } from "../components/DownloadButton";
import { Dropdown } from "../components/Dropdown";
import { Img } from "../components/Img";
import { TitleLogo } from "../components/TitleLogo";
import { PlaylistButton } from "../components/Playlists";
import { RatingRing } from "../components/RatingRing";
import { Segmented } from "../components/Segmented";
import { Sheet } from "../components/Sheet";
import { StreamList } from "../components/StreamList";
import { SwapIcon } from "../components/SwapIcon";
import { progressMap, seasonsOf, upNext } from "../lib/episodes";
import { episodeCode, formatRuntime, seasonLabel } from "../lib/format";
import { usePlayTarget } from "../lib/playTarget";
import { prefetchStreams, useLibrary, useMeta, useProgress, useSettings, useStreams, useToggleLibrary } from "../lib/queries";
import { useRouter } from "../lib/router";
import { useQuery } from "@tanstack/react-query";
import { anilistForImdb } from "../lib/anime/search";
import { usePrefs } from "../lib/prefs";
import { useFileTrailer } from "../lib/trailers";
import type { ContentType, EpisodeLayout, Meta, MetaPreview, RankedStream, Video } from "../lib/types";

/**
 * An anime reached by its IMDb id (Search, Library, Continue Watching) opens
 * on its AniList page instead, so the same show always looks the same.
 */
function useAnimeRedirect(id: string, item: MetaPreview | undefined) {
  const { animeEnabled } = usePrefs();
  const { replace } = useRouter();
  const animated = !!item?.genres?.some((g) => /^anim(e|ation)$/i.test(g));
  const year = Number(item?.releaseInfo?.match(/\d{4}/)?.[0]) || undefined;
  const { data: anilist } = useQuery({
    queryKey: ["anime", "for-imdb", id],
    queryFn: () => anilistForImdb(id, { type: item!.type, name: item!.name, year }),
    enabled: animeEnabled && animated && id.startsWith("tt"),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (anilist) replace({ name: "anime-detail", id: anilist });
  }, [anilist, replace]);
}

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
  useAnimeRedirect(id, shown);

  // The trailer behind the page: only while it's the page on top, and paused
  // once you've scrolled down to read or a sheet or the big trailer is open.
  const root = useRef<HTMLDivElement>(null);
  const onTop = usePageOnTop(root);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [sheets, setSheets] = useState(0);
  const onSheet = useCallback((open: boolean) => setSheets((n) => Math.max(0, n + (open ? 1 : -1))), []);
  const bigTrailer = !!useTrailerOpen();
  const trailer = useBackdropTrailer(id, meta?.trailerYtId, {
    active: onTop,
    paused: scrolledAway || sheets > 0 || bigTrailer,
  });

  const scroller = useRef<HTMLDivElement>(null);
  useFoldSnap(scroller, !!shown);

  if (isError && !shown) return <p className="empty t-body muted">Couldn't load this title: {String(error)}</p>;
  if (!shown) return <div className="detail-loading skeleton" />;

  return (
    <div className="detail" ref={root} data-trailer={trailer.visible} data-type={type}>
      <div className="detail-bg" aria-hidden>
        <Img src={shown.background} alt="" loading="eager" className="detail-bg-sharp" />
        {trailer.node}
        <Img src={shown.background} alt="" loading="eager" className="detail-bg-blur" />
        <div className="detail-bg-scrim" />
      </div>
      <div
        className="scroll detail-scroll"
        ref={scroller}
        onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > e.currentTarget.clientHeight * 0.25)}
      >
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
  const { navigate } = useRouter();
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  useEffect(() => {
    if (!sourcesOpen) return;
    onSheet(true);
    return () => onSheet(false);
  }, [sourcesOpen, onSheet]);

  const isSeries = item.type === "series";
  const inLibrary = library?.some((l) => l.id === item.id);
  const { next, videoId, resumeAt, label: primaryLabel } = usePlayTarget(item, meta);
  const { data: fileTrailer } = useFileTrailer(item.id);

  // Sources for the primary action load as soon as the page opens, so Play
  // (or the source list) is ready by the time the user reaches for it.
  useStreams(item.type, videoId);
  const { data: settings } = useSettings();
  const autoPick = settings?.autoPickSource ?? true;

  const play = (stream?: RankedStream) => {
    if (!videoId) return;
    // Auto-pick off: choose a source first (resuming keeps the file you were on).
    if (!stream && !autoPick && !resumeAt) return setSourcesOpen(true);
    navigate({ name: "player", type: item.type, metaId: item.id, videoId, stream: stream?.stream });
  };

  const facts = [item.releaseInfo, formatRuntime(meta?.runtime)].filter(Boolean);

  return (
    <section className="detail-hero">
      <div className="detail-hero-main">
        {item.logo ? (
          <TitleLogo src={item.logo} alt={item.name} className="detail-logo" loading="eager" />
        ) : (
          <h1 className="t-display detail-title">{item.name}</h1>
        )}
        {item.description && <p className="detail-description t-callout">{item.description}</p>}
        <p className="detail-facts t-callout tabular">
          {item.imdbRating && <RatingRing value={item.imdbRating} imdbId={item.id} />}
          <ScoreChips type={item.type} id={item.id} />
          {facts.join(" · ")}
        </p>

        <div className="detail-actions">
          <button
            className="btn btn-primary detail-play"
            disabled={!videoId}
            onClick={() => play()}
            onPointerEnter={() => videoId && prefetchStreams(item.type, videoId)}
          >
            {resumeAt ? <Reset size={18} strokeWidth={2.5} /> : <Play size={18} fill="currentColor" />}
            {primaryLabel}
          </button>
          {(meta?.trailerYtId || fileTrailer) && (
            <button className="btn btn-glass detail-trailer-btn" onClick={() => openTrailer({ name: item.name, imdbId: item.id, ytId: meta?.trailerYtId })}>
              <Trailer size={18} />
              Trailer
            </button>
          )}
          <button
            className="btn btn-glass btn-icon"
            onClick={() => toggle.mutate(item)}
            aria-label={inLibrary ? "Remove from Library" : "Add to Library"}
            title={inLibrary ? "Remove from Library" : "Add to Library"}
            aria-pressed={inLibrary}
          >
            <SwapIcon state={library && (inLibrary ? "in" : "out")}>{inLibrary ? <Check size={20} /> : <Plus size={20} />}</SwapIcon>
          </button>
          <PlaylistButton item={item} />
          <button
            className="btn btn-glass btn-icon"
            disabled={!videoId}
            onClick={() => setSourcesOpen(true)}
            aria-label="Choose source"
            title="Choose source"
          >
            <Sources size={19} />
          </button>
          {item.type === "movie" && <DownloadButton item={item} />}
          {trailer.visible && (
            <button
              className="btn btn-glass btn-icon detail-mute"
              onClick={trailer.toggleMute}
              aria-label={trailer.muted ? "Turn trailer sound on" : "Mute trailer"}
              title={trailer.muted ? "Sound on" : "Mute"}
            >
              {trailer.muted ? <VolumeMuted size={20} /> : <Volume size={20} />}
            </button>
          )}
        </div>
      </div>

      {(meta?.cast?.length || meta?.director?.length) ? (
        <dl className="detail-credits t-callout">
          {meta.cast?.length ? (
            <div>
              <dt>Starring</dt> <dd>{meta.cast.slice(0, 3).join(", ")}</dd>
            </div>
          ) : null}
          {meta.director?.length ? (
            <div>
              <dt>{isSeries ? "Created by" : "Director"}</dt> <dd>{meta.director.slice(0, 2).join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {videoId && (
        <Sheet
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          title="Sources"
          subtitle={
            isSeries && next?.video ? `${episodeCode(next.video.season, next.video.episode)} · ${next.video.title}` : item.name
          }
        >
          <StreamList
            type={item.type}
            videoId={videoId}
            onPick={(s) => {
              setSourcesOpen(false);
              play(s);
            }}
          />
        </Sheet>
      )}
    </section>
  );
}

/** Up to this many seasons show as tabs; more become a dropdown. */
const MAX_SEASON_TABS = 6;

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
  const { navigate } = useRouter();
  const { data: progress } = useProgress(meta.id);
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const next = useMemo(() => upNext(meta, progress ?? []), [meta, progress]);
  const [season, setSeason] = useState<number | undefined>();
  // This page's choice; until you pick one, the default from Settings.
  const [layoutChoice, setLayout] = useState<EpisodeLayout | undefined>();
  // Kept after closing so the sheet keeps its content while it slides out.
  const [sourcesFor, setSourcesFor] = useState<Video | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!sheetOpen) return;
    onSheet(true);
    return () => onSheet(false);
  }, [sheetOpen, onSheet]);

  // Open on the season you're actually in, not always season 1 — so wait
  // for watch progress before choosing.
  useEffect(() => {
    if (season === undefined && progress !== undefined && next.video) setSeason(next.video.season);
  }, [next.video, season, progress]);

  const current = season ?? seasons[0];
  const episodes = meta.videos.filter((v) => v.season === current);
  const map = useMemo(() => progressMap(progress), [progress]);

  const { data: settings } = useSettings();
  const autoPick = settings?.autoPickSource ?? true;
  const layout = layoutChoice ?? settings?.episodeLayout ?? "row";
  const play = (v: Video, stream?: RankedStream) => {
    // Auto-pick off: choose a source first (a started episode keeps its file).
    if (!stream && !autoPick && !map.has(v.id)) {
      setSourcesFor(v);
      return setSheetOpen(true);
    }
    navigate({ name: "player", type: "series", metaId: meta.id, videoId: v.id, stream: stream?.stream });
  };

  return (
    <section className="seasons">
      <div className="seasons-bar">
        <div className="seasons-picker">
          {seasons.length > MAX_SEASON_TABS ? (
            // Long-running shows: tabs would scroll off-screen and hide most seasons.
            <Dropdown
              label="Season"
              size="large"
              value={String(current)}
              onChange={(v) => setSeason(Number(v))}
              options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
            />
          ) : (
            <Segmented
              label="Season"
              variant="large"
              value={current}
              onChange={setSeason}
              options={seasons.map((s) => ({ id: s, label: seasonLabel(s) }))}
            />
          )}
        </div>
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
        onPlay={(v) => play(v)}
        onSources={(v) => {
          setSourcesFor(v);
          setSheetOpen(true);
        }}
        menu={(v) => cardMenu(meta, episodeEntry(meta, v, map.get(v.id)), { episode: true })}
      />
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Sources"
        subtitle={sourcesFor ? `${episodeCode(sourcesFor.season, sourcesFor.episode)} · ${sourcesFor.title}` : undefined}
      >
        {sourcesFor && (
          <StreamList
            type="series"
            videoId={sourcesFor.id}
            onPick={(s) => {
              setSheetOpen(false);
              play(sourcesFor, s);
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

