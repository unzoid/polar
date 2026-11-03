import { useEffect, useMemo, useRef, useState } from "react";
import { useFoldSnap } from "../lib/useFoldSnap";
import { AnimeCard } from "../components/anime/AnimeCard";
import { Check, ChevronDown, LayoutList, LayoutRow, Play, Plus, Reset, Search, Sources, Star, Trailer } from "../components/icons";
import { EpisodeShelf } from "../components/EpisodeShelf";
import { Dropdown } from "../components/Dropdown";
import { Img } from "../components/Img";
import { TitleLogo } from "../components/TitleLogo";
import { Row } from "../components/Row";
import { Segmented } from "../components/Segmented";
import { Sheet } from "../components/Sheet";
import { StreamList } from "../components/StreamList";
import { SwapIcon } from "../components/SwapIcon";
import { openTrailer } from "../components/Trailer";
import { api } from "../lib/api";
import { useAnime, useAnimeSeasons, type Anime, type AnimeCard as Card, type RelationType } from "../lib/anime/anilist";
import { animeArt, episodeTitle, matchVideo, regularEpisodes, useAniZip, type AniZipEpisode } from "../lib/anime/anizip";
import { rememberAnimeEpisode } from "../lib/anime/aniskip";
import {
  cleanDescription,
  countdown,
  FORMAT_LABEL,
  fuzzyDate,
  RELATION_LABEL,
  SEASON_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  useAnimeScore,
  untilAiring,
  useAnimeTitle,
} from "../lib/anime/format";
import { useEpisodeFlags } from "../lib/anime/jikan";
import { rememberFiller } from "../lib/anime/filler";
import { rememberAltIds } from "../lib/anime/altIds";
import { useImdbFallback } from "../lib/anime/search";
import { formatTime } from "../lib/format";
import { setPrefs, usePrefs } from "../lib/prefs";
import { useLibrary, useMeta, useProgress, useSettings, useToggleLibrary } from "../lib/queries";
import { useRouter } from "../lib/router";
import type { EpisodeLayout, Progress, RankedStream, Video } from "../lib/types";
import { watchedFraction } from "../lib/watched";

/**
 * An anime's page, built from AniList with ani.zip filling in episode titles,
 * stills and the link to the app's sources. Its episodes play through the
 * same IMDb-keyed streams, player and watch history as everything else, so
 * Continue Watching and Up Next just work.
 */
export function AnimeDetail({ id, preview }: { id: number; preview?: Card }) {
  const { data: anime, isError } = useAnime(id);
  const shown: Card | undefined = anime ?? preview;
  const { data: zip } = useAniZip(id);
  const title = useAnimeTitle();

  const scroller = useRef<HTMLDivElement>(null);
  useFoldSnap(scroller, !!shown);

  if (isError && !shown) return <p className="empty t-body muted">Couldn't load this anime from AniList. Try again in a minute.</p>;
  if (!shown) return <div className="detail-loading skeleton" />;

  const { background: art, logo } = animeArt(shown, zip);

  return (
    <div className="detail anime-detail" style={{ "--cover": shown.coverImage.color ?? undefined } as React.CSSProperties}>
      <div className="detail-bg" aria-hidden>
        <Img src={art} alt="" loading="eager" className="detail-bg-sharp" />
        <Img src={art} alt="" loading="eager" className="detail-bg-blur" />
        <div className="detail-bg-scrim" />
      </div>
      <div className="scroll detail-scroll" ref={scroller}>
        <Hero item={shown} anime={anime} logo={logo} name={title(shown.title)} />
        {anime && <Body anime={anime} />}
      </div>
    </div>
  );
}

// --- Playback model ------------------------------------------------------------

interface Ep {
  number: number;
  title?: string;
  image?: string;
  overview?: string;
  /** ISO date or date-time. */
  airDate?: string;
  runtime?: number;
  video?: Video;
  upcoming: boolean;
}

/** Everything the page needs to play: the episodes, matched to the app's videos, and where you're up to. */
function usePlayback(anime: Card | Anime) {
  const { data: zip } = useAniZip(anime.id);
  const isMovie = anime.format === "MOVIE";
  const kitsu = zip?.mappings.kitsu_id;
  // ani.zip has it but can't link it (new seasons often): find it on Cinemeta by title.
  const unlinked = zip !== undefined && !zip?.mappings.imdb_id && !kitsu;
  const { data: foundImdb } = useImdbFallback(anime, unlinked);
  const imdb = zip?.mappings.imdb_id ?? foundImdb ?? undefined;
  // The app's id for this show: its IMDb page, or (for the many with none) its Kitsu id, which the stream addons know.
  const metaId = imdb ?? (kitsu ? `kitsu:${kitsu}` : undefined);
  const { data: meta, isLoading: metaLoading } = useMeta(isMovie ? "movie" : "series", metaId ?? "", !!metaId);
  const { data: progress } = useProgress(metaId ?? "");
  const malId = anime.idMal ?? zip?.mappings.mal_id;
  const { animeTitles } = usePrefs();

  const episodes = useMemo<Ep[]>(() => {
    if (isMovie) return [];
    const now = Date.now();
    const videos = meta?.videos ?? [];
    // A Kitsu show's videos are numbered like the anime's; an IMDb one's are matched by air date.
    const videoFor = (e: AniZipEpisode) =>
      !videos.length ? undefined : imdb ? matchVideo(e, videos) : videos.find((v) => v.episode === Number(e.episode));
    const fromZip = regularEpisodes(zip).map((e: AniZipEpisode): Ep => {
      const airDate = e.airDateUtc ?? e.airDate ?? e.airdate;
      const video = videoFor(e);
      return {
        number: Number(e.episode),
        title: episodeTitle(e, animeTitles),
        image: e.image,
        overview: e.overview ?? e.summary,
        airDate,
        runtime: e.runtime ?? e.length,
        video,
        upcoming: !!airDate && new Date(airDate).getTime() > now,
      };
    });
    const list = fromZip.length
      ? fromZip
      : Array.from({ length: anime.episodes ?? Math.max(0, (anime.nextAiringEpisode?.episode ?? 1) - 1) }, (_, i): Ep => ({
          number: i + 1,
          upcoming: false,
          video: videoFor({ episode: String(i + 1) } as AniZipEpisode),
        }));
    // Episodes AniList has scheduled that ani.zip doesn't list yet.
    const scheduled = "airingSchedule" in anime ? anime.airingSchedule.nodes : [];
    const have = new Set(list.map((e) => e.number));
    for (const s of scheduled) {
      const airDate = new Date(s.airingAt * 1000).toISOString();
      const upcoming = s.airingAt * 1000 > now;
      // Airing shows ani.zip hasn't caught up with: the aired ones still need
      // their video, or they'd be dropped from the shelf as unplayable.
      const video = upcoming ? undefined : videoFor({ episode: String(s.episode), airDateUtc: airDate } as AniZipEpisode);
      if (!have.has(s.episode)) list.push({ number: s.episode, airDate, upcoming, video });
      else {
        const e = list.find((x) => x.number === s.episode)!;
        if (upcoming) e.upcoming = true;
        e.airDate ??= airDate;
        e.video ??= video;
      }
    }
    return list.sort((a, b) => a.number - b.number);
  }, [zip, meta, anime, isMovie, animeTitles, imdb]);

  // AniSkip needs MyAnimeList's numbering, which the player can't know: leave it for every episode.
  // Stream addons know an IMDb-matched episode by its Kitsu id too: leave that, so both are asked.
  useEffect(() => {
    if (malId) for (const e of episodes) if (e.video) rememberAnimeEpisode(e.video.id, malId, e.number);
    if (imdb && kitsu) {
      for (const e of episodes) if (e.video) rememberAltIds(e.video.id, [`kitsu:${kitsu}:${e.number}`]);
      if (isMovie) rememberAltIds(imdb, [`kitsu:${kitsu}`]);
    }
  }, [episodes, malId, imdb, kitsu, isMovie]);

  const byVideo = useMemo(() => new Map((progress ?? []).map((p) => [p.videoId, p])), [progress]);
  const done = (p?: Progress) => !!p && p.duration > 0 && p.position / p.duration >= watchedFraction();

  // Up next: carry on from the episode you touched last.
  const next = useMemo(() => {
    if (isMovie) {
      const p = metaId ? byVideo.get(metaId) : undefined;
      const resumeAt = p && !done(p) && p.position > 30 ? p.position : undefined;
      return { ep: undefined, resumeAt, kind: resumeAt ? ("resume" as const) : ("start" as const) };
    }
    const playable = episodes.filter((e) => e.video && !e.upcoming);
    const touched = playable
      .map((e) => ({ e, p: byVideo.get(e.video!.id) }))
      .filter((x) => x.p)
      .sort((a, b) => b.p!.updatedAt - a.p!.updatedAt)[0];
    if (touched) {
      if (!done(touched.p)) {
        // Unfinished: resume it, or (barely started) play it again from the top.
        return touched.p!.position > 30
          ? { ep: touched.e, resumeAt: touched.p!.position, kind: "resume" as const }
          : { ep: touched.e, resumeAt: undefined, kind: "next" as const };
      }
      const after = playable.find((e) => e.number > touched.e.number);
      if (after) return { ep: after, resumeAt: undefined, kind: "next" as const };
    }
    return { ep: playable[0], resumeAt: undefined, kind: "start" as const };
  }, [episodes, byVideo, isMovie, metaId]);

  return { zip, metaId, meta, metaLoading, malId, episodes, byVideo, next, isMovie, done };
}

// --- Hero ---------------------------------------------------------------------

function Hero({ item, anime, logo, name }: { item: Card; anime?: Anime; logo?: string; name: string }) {
  const { navigate } = useRouter();
  const pb = usePlayback(anime ?? item);
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const { data: settings } = useSettings();
  const autoPick = settings?.autoPickSource ?? true;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const prefs = usePrefs();

  const target = pb.isMovie ? pb.metaId : pb.next.ep?.video?.id;
  const inLibrary = !!pb.metaId && library?.some((l) => l.id === pb.metaId);
  const play = (stream?: RankedStream) => {
    if (!target || !pb.metaId) return;
    if (!stream && !autoPick && !pb.next.resumeAt) return setSourcesOpen(true);
    navigate({ name: "player", type: pb.isMovie ? "movie" : "series", metaId: pb.metaId, videoId: target, stream: stream?.stream });
  };

  const label = (() => {
    if (pb.isMovie) return pb.next.resumeAt ? `Resume · ${formatTime(pb.next.resumeAt)}` : "Play";
    const ep = pb.next.ep;
    if (!ep) return "Play";
    if (pb.next.kind === "resume") return `Resume Episode ${ep.number}`;
    if (pb.next.kind === "next") return `Play Episode ${ep.number}`;
    return ep.number === 1 ? "Play First Episode" : `Play Episode ${ep.number}`;
  })();

  const unavailable = !!pb.zip && !pb.metaId ? "Not linked to any sources yet" : !pb.metaLoading && pb.metaId && !target && !pb.isMovie ? "No episodes to play yet" : undefined;
  const nativeTitle = prefs.animeTitles === "native" ? item.title.romaji : item.title.native;
  const score = useAnimeScore()(item.averageScore);
  const studio = anime?.studios.edges.find((e) => e.isMain && e.node.isAnimationStudio)?.node.name;
  const next = item.nextAiringEpisode;
  const paragraphs = cleanDescription(anime?.description);

  return (
    <section className="detail-hero anime-hero">
      <div className="detail-hero-main">
        {logo ? <TitleLogo src={logo} alt={name} className="detail-logo" loading="eager" /> : <h1 className="t-display detail-title">{name}</h1>}
        {nativeTitle && nativeTitle !== name && <p className="anime-native t-callout">{nativeTitle}</p>}
        <p className="detail-facts anime-meta-line t-callout tabular">
          {score && (
            <span className="anime-score" title="AniList score">
              <Star size={13} /> {score}
            </span>
          )}
          {[
            item.format && FORMAT_LABEL[item.format],
            item.season && item.seasonYear ? `${SEASON_LABEL[item.season]} ${item.seasonYear}` : item.seasonYear,
            item.format === "MOVIE" ? item.duration && `${item.duration} min` : item.episodes && `${item.episodes} episodes`,
            item.status && STATUS_LABEL[item.status],
            studio,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {next && (
          <p className="anime-next t-callout tabular" title={new Date(next.airingAt * 1000).toLocaleString()}>
            <span className="anime-next-ep">Episode {next.episode}</span>
            {" "}
            {new Date(next.airingAt * 1000).toLocaleDateString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}
            {" · in "}
            {countdown(untilAiring(next.airingAt))}
          </p>
        )}
        {item.genres?.length ? <p className="anime-genres t-caption">{item.genres.join("  ·  ")}</p> : null}
        {paragraphs[0] && <p className="detail-description t-callout">{paragraphs[0]}</p>}

        <div className="detail-actions">
          <button className="btn btn-primary detail-play" disabled={!target} onClick={() => play()} title={unavailable}>
            {pb.next.resumeAt ? <Reset size={18} strokeWidth={2.5} /> : <Play size={18} fill="currentColor" />}
            {label}
          </button>
          {anime?.trailer?.site === "youtube" && (
            <button className="btn btn-glass detail-trailer-btn" onClick={() => openTrailer({ name, imdbId: pb.metaId?.startsWith("tt") ? pb.metaId : undefined, ytId: anime.trailer!.id })}>
              <Trailer size={18} />
              Trailer
            </button>
          )}
          {pb.meta && (
            <button
              className="btn btn-glass btn-icon"
              onClick={() => toggle.mutate(pb.meta!)}
              aria-label={inLibrary ? "Remove from Library" : "Add to Library"}
              title={inLibrary ? "Remove from Library" : "Add to Library"}
              aria-pressed={inLibrary}
            >
              <SwapIcon state={library && (inLibrary ? "in" : "out")}>{inLibrary ? <Check size={20} /> : <Plus size={20} />}</SwapIcon>
            </button>
          )}
          <button className="btn btn-glass btn-icon" disabled={!target} onClick={() => setSourcesOpen(true)} aria-label="Choose source" title="Choose source">
            <Sources size={19} />
          </button>
        </div>
        {unavailable && <p className="anime-unavailable t-caption">{unavailable}</p>}
      </div>

      {target && pb.metaId && (
        <Sheet
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
          title="Sources"
          subtitle={pb.next.ep ? `Episode ${pb.next.ep.number}${pb.next.ep.title ? ` · ${pb.next.ep.title}` : ""}` : name}
        >
          <StreamList
            type={pb.isMovie ? "movie" : "series"}
            videoId={target}
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

// --- Below the fold ---------------------------------------------------------

/**
 * Everything below the hero on one page, as a show's own: the episodes in a
 * shelf (or a list, your choice), then the cast, details and franchise links.
 */
function Body({ anime }: { anime: Anime }) {
  const isMovie = anime.format === "MOVIE";
  const hasSeasons = useHasSeasons(anime);
  const hasRelated = anime.relations.edges.length > 0 || anime.recommendations.nodes.some((n) => !!n.mediaRecommendation);
  return (
    <>
      {!isMovie && <Episodes anime={anime} />}
      {/* A film in a franchise: the seasons bar alone, to get back to the series. */}
      {isMovie && hasSeasons && (
        <section className="seasons">
          <div className="seasons-bar">
            <div className="seasons-picker">
              <SeasonTabs anime={anime} />
            </div>
          </div>
        </section>
      )}
      {anime.characters.edges.length > 0 && <Characters anime={anime} />}
      <h2 className="t-title2 anime-section-title">Details</h2>
      <Details anime={anime} />
      {hasRelated && <Related anime={anime} />}
    </>
  );
}

const PAGE = 100;
/** Episodes the list layout shows before "Show all". */
const LIST_CAP = 12;
/** More pages than this: a dropdown instead of a row of tabs that runs off the bar. */
const RANGE_TABS = 4;
/** Shows longer than this get a search. */
const SEARCH_FROM = 40;

function Episodes({ anime }: { anime: Anime }) {
  const { navigate } = useRouter();
  const pb = usePlayback(anime);
  const prefs = usePrefs();
  const { data: flags } = useEpisodeFlags(pb.malId, [anime.title.english, anime.title.romaji]);
  const { data: settings } = useSettings();
  const autoPick = settings?.autoPickSource ?? true;
  // This page's choice; until you pick one, the default from Settings → Browsing.
  const [layoutChoice, setLayout] = useState<EpisodeLayout | undefined>();
  const layout = layoutChoice ?? settings?.episodeLayout ?? "row";
  const [sourcesFor, setSourcesFor] = useState<Video | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasSeasons = useHasSeasons(anime);

  const hasFiller = !!flags && [...flags.values()].some((f) => f.filler);
  // What the shelf can show: episodes you can play, and the ones still to air.
  const list: Video[] = pb.episodes
    .filter((e) => (e.video || e.upcoming) && !(prefs.animeHideRecaps && flags?.get(e.number)?.recap))
    .map((e) => {
      const f = flags?.get(e.number);
      return {
        id: e.video?.id ?? `${PENDING}${e.number}`,
        title: e.title ?? e.video?.title ?? `Episode ${e.number}`,
        season: 1,
        episode: e.number,
        released: e.airDate ?? e.video?.released,
        thumbnail: e.image ?? e.video?.thumbnail,
        overview: e.overview ?? e.video?.overview,
        tag: f?.filler ? "Filler" : f?.recap ? "Recap" : undefined,
      };
    });

  useEffect(() => {
    if (flags) rememberFiller(pb.episodes.filter((e) => e.video && flags.get(e.number)?.filler).map((e) => e.video!.id));
  }, [flags, pb.episodes]);

  // Long-running shows: pages of 100, opening on the one you're up to.
  const pages = Math.ceil(list.length / PAGE);
  const [page, setPage] = useState<number | null>(null);
  const upNextId = pb.next.kind !== "start" ? pb.next.ep?.video?.id : undefined;
  const upTo = Math.max(0, list.findIndex((v) => v.id === (pb.next.ep?.video?.id ?? "")));
  const current = Math.min(pages - 1, page ?? Math.floor(upTo / PAGE));
  const pageList = pages > 1 ? list.slice(current * PAGE, current * PAGE + PAGE) : list;

  // A list of hundreds pushes the rest of the page out of reach: the list
  // layout shows a stretch from where you're up to, the rest one click away,
  // and long shows get a search by number or title.
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const q = query.trim().toLowerCase();
  const searchable = list.length > SEARCH_FROM;
  const found = q ? list.filter((v) => String(v.episode) === q || v.title?.toLowerCase().includes(q)) : undefined;
  const capped = layout === "list" && !expanded && !found && pageList.length > LIST_CAP;
  const from = capped ? Math.max(0, Math.min(pageList.length - LIST_CAP, pageList.findIndex((v) => v.id === pb.next.ep?.video?.id) - 1)) : 0;
  const visible = found ?? (capped ? pageList.slice(from, from + LIST_CAP) : pageList);
  // Paging or searching starts collapsed again.
  useEffect(() => setExpanded(false), [current, q]);

  const play = (v: Video, stream?: RankedStream) => {
    if (v.id.startsWith(PENDING) || !pb.metaId) return;
    if (!stream && !autoPick && !pb.byVideo.has(v.id)) {
      setSourcesFor(v);
      return setSheetOpen(true);
    }
    navigate({ name: "player", type: "series", metaId: pb.metaId, videoId: v.id, stream: stream?.stream });
  };

  if (!list.length) {
    const empty = <p className="empty t-body muted anime-no-episodes">{pb.zip === undefined ? "Loading episodes…" : "No episodes to play yet."}</p>;
    // A season that hasn't started yet still sits among the others.
    return hasSeasons ? (
      <section className="seasons">
        <div className="seasons-bar">
          <div className="seasons-picker">
            <SeasonTabs anime={anime} />
          </div>
        </div>
        {empty}
      </section>
    ) : (
      empty
    );
  }

  return (
    <section className="seasons">
      <div className="seasons-bar">
        <div className="seasons-picker">
        {hasSeasons && !found && <SeasonTabs anime={anime} />}
        {found ? (
          <h2 className="t-title2 anime-episode-count">
            {found.length} {found.length === 1 ? "match" : "matches"}
          </h2>
        ) : pages > RANGE_TABS ? (
          <Dropdown
            label="Episodes"
            value={String(current)}
            onChange={(v) => setPage(Number(v))}
            options={Array.from({ length: pages }, (_, i) => ({
              value: String(i),
              label: `Episodes ${list[i * PAGE]?.episode}–${list[Math.min(list.length, (i + 1) * PAGE) - 1]?.episode}`,
            }))}
          />
        ) : pages > 1 ? (
          <div className="anime-ranges" role="tablist" aria-label="Episodes">
            {Array.from({ length: pages }, (_, i) => (
              <button key={i} role="tab" className="anime-range tabular" aria-selected={i === current} onClick={() => setPage(i)}>
                {list[i * PAGE]?.episode}–{list[Math.min(list.length, (i + 1) * PAGE) - 1]?.episode}
              </button>
            ))}
          </div>
        ) : hasSeasons ? null : (
          <h2 className="t-title2 anime-episode-count">Episodes</h2>
        )}
        </div>
        <div className="anime-episodes-tools">
          {searchable && (
            <label className="pill-search anime-episode-search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find episode"
                aria-label="Find an episode by number or title"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          )}
          {hasFiller && (
            <label className="anime-toggle t-callout">
              <input type="checkbox" className="switch" checked={prefs.animeSkipFiller} onChange={(e) => setPrefs({ animeSkipFiller: e.target.checked })} />
              Skip filler
            </label>
          )}
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
      </div>
      <EpisodeShelf
        layout={layout}
        episodes={visible}
        progress={pb.byVideo}
        runtime={anime.duration ? `${anime.duration} min` : undefined}
        upNextId={upNextId}
        onPlay={(v) => play(v)}
        onSources={(v) => {
          setSourcesFor(v);
          setSheetOpen(true);
        }}
      />
      {found && !found.length && <p className="empty t-body muted">No episode matches “{query.trim()}”.</p>}
      {capped && (
        <button className="btn btn-glass anime-show-all" onClick={() => setExpanded(true)}>
          Show all {pageList.length} episodes
        </button>
      )}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Sources"
        subtitle={sourcesFor ? `Episode ${sourcesFor.episode}${sourcesFor.title ? ` · ${sourcesFor.title}` : ""}` : undefined}
      >
        {sourcesFor && !sourcesFor.id.startsWith(PENDING) && (
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

/** Id prefix for an episode that's scheduled but has nothing to play yet. */
const PENDING = "anime-pending:";

/** More entries than this: a dropdown, as for a show's seasons. */
const MAX_SEASON_TABS = 6;

/**
 * The franchise's seasons (and films) as tabs, like a show's: switching opens
 * that entry in place of this one, so Back still leaves the franchise.
 * Nothing when this entry has no seasons around it, or isn't one itself (an OVA).
 */
function SeasonTabs({ anime }: { anime: Anime }) {
  const { replace } = useRouter();
  const { data: seasons } = useAnimeSeasons(anime);
  const title = useAnimeTitle();
  if (!seasons || seasons.length < 2 || !seasons.some((s) => s.card.id === anime.id)) return null;
  const labels = distinctLabels(seasons.map((s) => title(s.card.title)), seasons.map((s) => s.label));
  const go = (id: number) => {
    if (id === anime.id) return;
    replace({ name: "anime-detail", id, preview: seasons.find((s) => s.card.id === id)?.card });
  };
  return seasons.length > MAX_SEASON_TABS ? (
    <Dropdown
      label="Season"
      size="large"
      value={String(anime.id)}
      onChange={(v) => go(Number(v))}
      options={seasons.map((s, i) => ({ value: String(s.card.id), label: labels[i] }))}
    />
  ) : (
    <Segmented
      label="Season"
      variant="large"
      value={anime.id}
      onChange={go}
      options={seasons.map((s, i) => ({ id: s.card.id, label: labels[i] }))}
    />
  );
}

const word = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * What tells each entry apart: its title minus the words it shares with the
 * first one ("Tower of Glass Season 3 Part 2" → "Season 3 Part 2",
 * "Ember Hunter: Hikari no Tsurugi Entertainment District Arc" →
 * "Entertainment District Arc"). The first entry, or one whose title adds
 * nothing, gets its place instead ("Season 1", "Movie").
 */
function distinctLabels(titles: string[], fallbacks: string[]) {
  const base = (titles[0] ?? "").split(/\s+/).map(word).filter(Boolean);
  return titles.map((t, i) => {
    if (i === 0) return fallbacks[0];
    const words = t.split(/\s+/);
    let n = 0;
    let b = 0;
    // Skip words that are only punctuation ("-"), then match the franchise name word by word.
    while (n < words.length && b < base.length) {
      const w = word(words[n]);
      if (!w) n++;
      else if (w === base[b]) (n++, b++);
      else break;
    }
    const rest = b > 0 ? words.slice(n).join(" ").replace(/^[\s:\-–—~|,.]+/, "").trim() : "";
    return rest || fallbacks[i];
  });
}

/** Whether SeasonTabs will show for this entry. */
function useHasSeasons(anime: Anime) {
  const { data: seasons } = useAnimeSeasons(anime);
  return !!seasons && seasons.length > 1 && seasons.some((s) => s.card.id === anime.id);
}

/** Watch order first (prequels, sequels, the main story), then everything else. */
const RELATION_ORDER: RelationType[] = [
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
  "ALTERNATIVE",
  "SUMMARY",
  "COMPILATION",
  "CONTAINS",
  "CHARACTER",
  "OTHER",
  "SOURCE",
  "ADAPTATION",
];

function Related({ anime }: { anime: Anime }) {
  // Entries already in the season tabs above aren't repeated here.
  const { data: seasons } = useAnimeSeasons(anime);
  const tabbed = new Set(useHasSeasons(anime) ? (seasons ?? []).map((s) => s.card.id) : []);
  const edges = [...anime.relations.edges].filter((e) => !tabbed.has(e.node.id)).sort(
    (a, b) =>
      RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType) ||
      (a.node.startDate?.year ?? 9999) - (b.node.startDate?.year ?? 9999),
  );
  const watchOrder = edges.filter((e) => ["PREQUEL", "SEQUEL", "PARENT"].includes(e.relationType));
  const rest = edges.filter((e) => !watchOrder.includes(e));
  const label = (e: (typeof edges)[number]) =>
    [RELATION_LABEL[e.relationType], e.node.format ? FORMAT_LABEL[e.node.format] : undefined, e.node.seasonYear ?? e.node.startDate?.year]
      .filter(Boolean)
      .join(" · ");
  const watchOrderRow = watchOrder.length > 0 && (
    <Row title="Watch Order">
      {watchOrder.map((e) => (
        <AnimeCard key={`${e.relationType}/${e.node.id}`} item={e.node} label={label(e)} />
      ))}
    </Row>
  );
  const franchiseRow = rest.length > 0 && (
    <Row title="Also in This Franchise">
      {rest.map((e) => (
        <AnimeCard key={`${e.relationType}/${e.node.id}`} item={e.node} label={label(e)} />
      ))}
    </Row>
  );
  return (
    <div className="rows anime-related">
      {watchOrderRow && franchiseRow ? (
        <div className="anime-franchise-grid">
          <div className="anime-franchise-col" style={{ "--cards": Math.min(2, watchOrder.length) } as React.CSSProperties}>
            {watchOrderRow}
          </div>
          <div className="anime-franchise-col" style={{ "--cards": Math.min(2, rest.length) } as React.CSSProperties}>
            {franchiseRow}
          </div>
        </div>
      ) : (
        <>
          {watchOrderRow}
          {franchiseRow}
        </>
      )}
      <Recommendations anime={anime} />
    </div>
  );
}

function Recommendations({ anime }: { anime: Anime }) {
  const recs = anime.recommendations.nodes.map((n) => n.mediaRecommendation).filter((m): m is Card => !!m);
  if (!recs.length) return null;
  return (
    <Row title="If You Liked This">
      {recs.map((m) => (
        <AnimeCard key={m.id} item={m} />
      ))}
    </Row>
  );
}

function Characters({ anime }: { anime: Anime }) {
  const prefs = usePrefs();
  const lang = prefs.animeVoices;
  const edges = anime.characters.edges;
  const [actorsOpen, setActorsOpen] = useState(false);
  if (!edges.length) return <p className="empty t-body muted">AniList has no characters for this one yet.</p>;
  return (
    <section className="anime-characters-wrap" data-expanded={actorsOpen}>
      <div className="anime-cast-heading">
        <h2 className="t-title2">Characters &amp; Voice Actors</h2>
        <button
          type="button"
          className="anime-ranking anime-cast-toggle"
          aria-expanded={actorsOpen}
          aria-controls={`anime-cast-${anime.id}`}
          aria-label={`${actorsOpen ? "Hide" : "Show"} characters and voice actors`}
          onClick={() => setActorsOpen((open) => !open)}
        >
          {actorsOpen ? "Hide" : "Show"}
          <ChevronDown size={18} />
        </button>
      </div>
      <div id={`anime-cast-${anime.id}`} className="anime-cast-content" hidden={!actorsOpen}>
        <div className="anime-episodes-bar">
          <span className="t-callout muted">Voices</span>
          <Segmented
            label="Voice language"
            value={lang}
            onChange={(v) => setPrefs({ animeVoices: v })}
            options={[
              { id: "japanese", label: "Japanese" },
              { id: "english", label: "English" },
            ]}
          />
        </div>
        <div className="anime-characters">
          {edges.map((e) => {
            const va = (lang === "english" ? e.en : e.ja)[0];
            return (
              <div key={e.node.id} className="anime-character">
                <span className="anime-character-side">
                  <Img src={e.node.image?.large ?? undefined} alt="" className="anime-character-img" />
                  <span className="anime-character-text">
                    <span className="t-callout anime-character-name">{e.node.name.full}</span>
                    <span className="t-caption muted">{e.role === "MAIN" ? "Main" : e.role === "SUPPORTING" ? "Supporting" : "Background"}</span>
                  </span>
                </span>
                {va && (
                  <span className="anime-character-side anime-character-va">
                    <span className="anime-character-text">
                      <span className="t-callout anime-character-name">{va.name.full}</span>
                      <span className="t-caption muted">{va.name.native ?? (lang === "english" ? "English" : "Japanese")}</span>
                    </span>
                    <Img src={va.image?.large ?? undefined} alt="" className="anime-character-img" />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {anime.staff.edges.length > 0 && (
        <>
          <h3 className="details-label anime-staff-label">Staff</h3>
          <div className="anime-staff">
            {anime.staff.edges.map((s) => (
              <div key={`${s.node.id}/${s.role}`} className="anime-staff-item">
                <span className="t-callout">{s.node.name.full}</span>
                <span className="t-caption muted">{s.role}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Details({ anime }: { anime: Anime }) {
  const prefs = usePrefs();
  const title = useAnimeTitle();
  const paragraphs = cleanDescription(anime.description);
  const studios = anime.studios.edges.filter((e) => e.node.isAnimationStudio).map((e) => e.node.name);
  const producers = anime.studios.edges.filter((e) => !e.node.isAnimationStudio).map((e) => e.node.name);
  const spoilers = anime.tags.filter((t) => t.isMediaSpoiler || t.isGeneralSpoiler).length;
  const tags = anime.tags.filter((t) => prefs.animeSpoilerTags || !(t.isMediaSpoiler || t.isGeneralSpoiler));
  const streaming = anime.externalLinks.filter((l) => l.type === "STREAMING");
  const rankings = anime.rankings.filter((r) => r.rank <= 100).slice(0, 4);
  const aired = [fuzzyDate(anime.startDate), anime.status === "RELEASING" ? "now" : fuzzyDate(anime.endDate)].filter(Boolean);

  const facts: [string, string | undefined][] = [
    ["Format", anime.format ? FORMAT_LABEL[anime.format] : undefined],
    ["Episodes", anime.episodes ? String(anime.episodes) : undefined],
    ["Episode length", anime.duration ? `${anime.duration} min` : undefined],
    ["Status", anime.status ? STATUS_LABEL[anime.status] : undefined],
    ["Aired", aired.length ? aired.join(" to ") : undefined],
    ["Season", anime.season && anime.seasonYear ? `${SEASON_LABEL[anime.season]} ${anime.seasonYear}` : undefined],
    ["Studio", studios.join(", ") || undefined],
    ["Source", anime.source ? (SOURCE_LABEL[anime.source] ?? anime.source) : undefined],
    ["Producers", producers.slice(0, 4).join(", ") || undefined],
    ["Average score", anime.averageScore ? `${anime.averageScore}%` : undefined],
    ["Favourites", anime.favourites ? anime.favourites.toLocaleString() : undefined],
    ["Also known as", [anime.title.romaji, anime.title.english, anime.title.native, ...(anime.synonyms ?? [])].filter((t) => t && t !== title(anime.title)).slice(0, 4).join(" · ") || undefined],
  ];

  return (
    <section className="about anime-about">
      <div className="details">
        {rankings.length > 0 && (
          <div className="anime-rankings">
            {rankings.map((r) => (
              <span key={`${r.type}/${r.context}/${r.year}/${r.season}`} className="anime-ranking tabular">
                <strong>#{r.rank}</strong> {r.context.replace(/^\w/, (c) => c.toUpperCase())}
                {!r.allTime && r.year ? ` ${r.season ? `${SEASON_LABEL[r.season]} ` : ""}${r.year}` : ""}
              </span>
            ))}
          </div>
        )}
        {/* Story, tags and links down the left; the facts beside them, so neither column leaves a hole. */}
        <section className="details-section details-columns">
          <div className="anime-about-main">
            <div>
              <h3 className="details-label">Story</h3>
              {paragraphs.map((p, i) => (
                <p key={i} className="details-story">
                  {p}
                </p>
              ))}
            </div>
        {tags.length > 0 && (
          <section className="details-section">
            <h3 className="details-label">Tags</h3>
            <div className="anime-tags">
              {tags.map((t) => (
                <span key={t.name} className="anime-tag" data-spoiler={t.isMediaSpoiler || t.isGeneralSpoiler} title={t.description ?? undefined}>
                  {t.name} <span className="tabular">{t.rank}%</span>
                </span>
              ))}
              {spoilers > 0 && (
                <button className="settings-link anime-spoilers" onClick={() => setPrefs({ animeSpoilerTags: !prefs.animeSpoilerTags })}>
                  {prefs.animeSpoilerTags ? "Hide spoiler tags" : `Show ${spoilers} spoiler tag${spoilers === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </section>
        )}

        {streaming.length > 0 && (
          <section className="details-section">
            <h3 className="details-label">Watch Officially</h3>
            <div className="details-links">
              {streaming.map((l) => (
                <button
                  key={l.url}
                  className="details-link pressable"
                  style={{ "--site": l.color ?? "#ffffff" } as React.CSSProperties}
                  onClick={() => void api.openExternal(l.url)}
                >
                  {l.icon && <img src={l.icon} alt="" className="anime-link-icon" />}
                  {l.site}
                  {l.language && l.language !== "English" ? <span className="muted"> · {l.language}</span> : null}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="details-section">
          <h3 className="details-label">Elsewhere</h3>
          <div className="details-links">
            <button className="details-link pressable" style={{ "--site": "#02a9ff" } as React.CSSProperties} onClick={() => void api.openExternal(`https://anilist.co/anime/${anime.id}`)}>
              AniList
            </button>
            {anime.idMal && (
              <button className="details-link pressable" style={{ "--site": "#2e51a2" } as React.CSSProperties} onClick={() => void api.openExternal(`https://myanimelist.net/anime/${anime.idMal}`)}>
                MyAnimeList
              </button>
            )}
          </div>
        </section>
          </div>
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
        </section>
      </div>
    </section>
  );
}
