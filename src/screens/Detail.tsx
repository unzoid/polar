import { Check, LayoutList, LayoutRow, Play, Plus, Reset, Sources } from "../components/icons";
import { useEffect, useMemo, useState } from "react";
import { EpisodeShelf } from "../components/EpisodeShelf";
import { Dropdown } from "../components/Dropdown";
import { Img } from "../components/Img";
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
import type { ContentType, EpisodeLayout, Meta, MetaPreview, RankedStream, Video } from "../lib/types";

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
      <div className="scroll detail-scroll">
        <DetailHero item={shown} meta={meta} />
        {type === "series" && meta && <Seasons meta={meta} />}
        {type === "movie" && meta && <About meta={meta} />}
      </div>
      {/* Teases what's below the fold; clears as you scroll. */}
      <div className="detail-fold" aria-hidden>
        <i data-l="1" />
        <i data-l="2" />
        <i data-l="3" />
        <i data-l="4" />
        <i data-l="tint" />
        <i data-l="grain" />
      </div>
    </div>
  );
}

function DetailHero({ item, meta }: { item: MetaPreview; meta?: Meta }) {
  const { navigate } = useRouter();
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const isSeries = item.type === "series";
  const inLibrary = library?.some((l) => l.id === item.id);
  const { next, videoId, resumeAt, label: primaryLabel } = usePlayTarget(item, meta);

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
          <Img src={item.logo} alt={item.name} className="detail-logo" loading="eager" />
        ) : (
          <h1 className="t-display detail-title">{item.name}</h1>
        )}
        {item.description && <p className="detail-description t-callout">{item.description}</p>}
        <p className="detail-facts t-callout tabular">
          {item.imdbRating && <RatingRing value={item.imdbRating} imdbId={item.id} />}
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

function Seasons({ meta }: { meta: Meta }) {
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
  // The rating already shows (and links to IMDb) in the hero.
  const info: [string, string | undefined][] = [
    ["Genre", meta.genres?.join(", ")],
    ["Released", meta.releaseInfo],
    ["Runtime", meta.runtime],
    ["Director", meta.director?.join(", ")],
  ];
  return (
    <section className="about">
      <h2 className="t-title2">About</h2>
      <div className="about-grid">
        {meta.description && <p className="about-description">{meta.description}</p>}
        <dl className="about-info t-callout">
          {info
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="about-label">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {meta.cast?.length ? (
          <div className="about-cast">
            <h3 className="about-label">Cast</h3>
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
