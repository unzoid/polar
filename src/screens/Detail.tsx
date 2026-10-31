import { Check, ListVideo, Play, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EpisodeShelf } from "../components/EpisodeShelf";
import { Img } from "../components/Img";
import { RatingRing } from "../components/RatingRing";
import { Segmented } from "../components/Segmented";
import { Sheet } from "../components/Sheet";
import { StreamList } from "../components/StreamList";
import { progressMap, seasonsOf, upNext } from "../lib/episodes";
import { episodeCode, formatTime } from "../lib/format";
import { prefetchStreams, useLibrary, useMeta, useProgress, useStreams, useToggleLibrary } from "../lib/queries";
import { useRouter } from "../lib/router";
import type { ContentType, Meta, MetaPreview, RankedStream, Video } from "../lib/types";

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

  if (isError && !shown) return <p className="empty t-body muted">Couldn't load this title: {String(error)}</p>;
  if (!shown) return <div className="detail-loading skeleton" />;

  return (
    <div className="detail">
      <div className="detail-bg" aria-hidden>
        <Img src={shown.background} alt="" loading="eager" className="detail-bg-sharp" />
        <Img src={shown.background} alt="" loading="eager" className="detail-bg-blur" />
        <div className="detail-bg-scrim" />
      </div>
      {/* Once the hero has receded, the title treatment settles top-centre (tvOS). */}
      <div className="detail-ambient-title" aria-hidden>
        {shown.logo ? <Img src={shown.logo} alt="" /> : <span className="t-title1">{shown.name}</span>}
      </div>
      <div className="scroll detail-scroll">
        <DetailHero item={shown} meta={meta} />
        {type === "series" && meta && <Seasons meta={meta} />}
        {type === "movie" && meta && <About meta={meta} />}
      </div>
    </div>
  );
}

function DetailHero({ item, meta }: { item: MetaPreview; meta?: Meta }) {
  const { navigate } = useRouter();
  const { data: progress } = useProgress(item.id);
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const isSeries = item.type === "series";
  const inLibrary = library?.some((l) => l.id === item.id);

  const next = meta && isSeries ? upNext(meta, progress ?? []) : undefined;
  const movieProgress = !isSeries ? progress?.find((p) => p.videoId === item.id) : undefined;
  const videoId = isSeries ? next?.video?.id : item.id;
  const resumeAt = isSeries
    ? next?.resumeAt
    : movieProgress && movieProgress.position > 30 && movieProgress.position / movieProgress.duration < 0.92
      ? movieProgress.position
      : undefined;

  // Sources for the primary action load as soon as the page opens: by the
  // time the user reaches for Play, it starts immediately — and the badges
  // (4K, Dolby Vision) describe what's actually available.
  const streams = useStreams(item.type, videoId);
  const best = streams.data?.streams[0]?.quality;

  const play = (stream?: RankedStream) =>
    videoId && navigate({ name: "player", type: item.type, metaId: item.id, videoId, stream: stream?.stream });

  const primaryLabel = (() => {
    if (!isSeries) return resumeAt ? `Resume · ${formatTime(resumeAt)}` : "Play";
    if (!next?.video) return "Play";
    const code = `S${next.video.season}, E${next.video.episode}`;
    if (next.kind === "resume") return `Resume ${code}`;
    if (next.kind === "next") return `Play ${code}`;
    return next.video.season === 1 && next.video.episode === 1 ? "Play First Episode" : `Play ${code}`;
  })();

  const kind = [isSeries ? "TV Show" : "Movie", ...(item.genres ?? []).slice(0, 2)].join(" · ");
  const facts = [item.releaseInfo, meta?.runtime?.replace(/(\d+) min/, (_, m) => formatRuntime(Number(m)))].filter(Boolean);

  return (
    <section className="detail-hero">
      <div className="detail-hero-main">
        {item.logo ? (
          <Img src={item.logo} alt={item.name} className="detail-logo" loading="eager" />
        ) : (
          <h1 className="t-display detail-title">{item.name}</h1>
        )}
        <p className="detail-kind t-callout">{kind}</p>
        {item.description && <p className="detail-description t-callout">{item.description}</p>}
        <p className="detail-facts t-callout tabular">
          {item.imdbRating && <RatingRing value={item.imdbRating} />}
          {facts.join(" · ")}
          {best?.resolution === 2160 && <span className="badge-solid">4K</span>}
          {best?.dolbyVision ? (
            <span className="badge-wordmark">Dolby Vision</span>
          ) : best?.hdr ? (
            <span className="badge-outline">HDR</span>
          ) : null}
          {best?.cached && <span className="badge-outline">Instant</span>}
        </p>

        <div className="detail-actions">
          <button
            className="btn btn-primary detail-play"
            disabled={!videoId}
            onClick={() => play()}
            onPointerEnter={() => videoId && prefetchStreams(item.type, videoId)}
          >
            {resumeAt ? <RotateCcw size={18} strokeWidth={2.5} /> : <Play size={18} fill="currentColor" />}
            {primaryLabel}
          </button>
          <button
            className="btn btn-glass btn-icon"
            onClick={() => toggle.mutate(item)}
            aria-label={inLibrary ? "Remove from Library" : "Add to Library"}
            title={inLibrary ? "In Library" : "Add to Library"}
            aria-pressed={inLibrary}
          >
            {inLibrary ? <Check size={20} /> : <Plus size={20} />}
          </button>
          <button
            className="btn btn-glass btn-icon"
            disabled={!videoId}
            onClick={() => setSourcesOpen(true)}
            aria-label="Choose source"
            title="Choose source"
          >
            <ListVideo size={19} />
          </button>
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

function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} hr ${m} min` : `${m} min`;
}

function Seasons({ meta }: { meta: Meta }) {
  const { navigate } = useRouter();
  const { data: progress } = useProgress(meta.id);
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const next = useMemo(() => upNext(meta, progress ?? []), [meta, progress]);
  const [season, setSeason] = useState<number | undefined>();
  // Kept after closing so the sheet keeps its content while it slides out.
  const [sourcesFor, setSourcesFor] = useState<Video | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Open on the season you're actually in, not always season 1 — so wait
  // for watch progress before choosing.
  useEffect(() => {
    if (season === undefined && progress !== undefined && next.video) setSeason(next.video.season);
  }, [next.video, season, progress]);

  const current = season ?? seasons[0];
  const episodes = meta.videos.filter((v) => v.season === current);
  const map = useMemo(() => progressMap(progress), [progress]);

  const play = (v: Video, stream?: RankedStream) =>
    navigate({ name: "player", type: "series", metaId: meta.id, videoId: v.id, stream: stream?.stream });

  return (
    <section className="seasons">
      <div className="seasons-bar">
        <Segmented
          label="Season"
          variant="large"
          value={current}
          onChange={setSeason}
          options={seasons.map((s) => ({ id: s, label: s === 0 ? "Specials" : `Season ${s}` }))}
        />
      </div>
      <EpisodeShelf
        episodes={episodes}
        progress={map}
        runtime={meta.runtime}
        upNextId={next.kind !== "start" ? next.video?.id : undefined}
        onPlay={(v) => play(v)}
        onSources={(v) => {
          setSourcesFor(v);
          setSheetOpen(true);
        }}
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

/** Movies: the Apple TV "About" + information block below the hero. */
function About({ meta }: { meta: Meta }) {
  const info: [string, string | undefined][] = [
    ["Genre", meta.genres?.join(", ")],
    ["Released", meta.releaseInfo],
    ["Runtime", meta.runtime],
    ["Rating", meta.imdbRating && `★ ${meta.imdbRating}`],
    ["Director", meta.director?.join(", ")],
  ];
  return (
    <section className="about">
      <h2 className="t-title2">About</h2>
      <div className="about-grid">
        <div className="about-card">
          <span className="t-headline">{meta.name}</span>
          <p className="t-callout muted">{meta.description}</p>
        </div>
        <dl className="about-info t-callout">
          {info
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="faint">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {meta.cast?.length ? (
          <div className="about-cast">
            <span className="t-headline">Cast</span>
            <ul className="cast-list">
              {meta.cast.slice(0, 12).map((name) => (
                <li key={name} className="cast-chip t-callout">
                  <span className="cast-avatar" aria-hidden>
                    {name
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  {name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
