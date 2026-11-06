import { useQueries } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  alignByAirDate,
  type Anime,
  type AniZipEpisode,
  aniZipQuery,
  distinctLabels,
  type FranchiseTabs,
  matchVideo,
  playContext,
  regularEpisodes,
  rememberStill,
  useAnimeTitle,
  useEpisodeFlags,
} from "../../lib/anime";
import { setPrefs, useEpisodeLayout, usePrefs } from "../../lib/settings";
import type { PlayRequest } from "../../lib/playback";
import type { Video } from "../../lib/types";
import { Dropdown } from "../Dropdown";
import { LayoutList, LayoutRow } from "../icons";
import { Segmented } from "../Segmented";
import { EpisodeShelf } from "../title/EpisodeShelf";
import { SeasonPicker } from "../title/SeasonPicker";
import { SourcePicker, useSourcePicker } from "../title/SourcePicker";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { SearchField } from "../ui/SearchField";
import { Switch } from "../ui/Switch";
import { useAnimePlayback } from "./useAnimePlayback";

/** The franchise's seasons, which one is showing (lib/anime/relatedRows.ts), and how to show another. */
export interface Franchise extends FranchiseTabs {
  select: (id: number) => void;
}

const PAGE = 100;
/** Episodes the list layout shows before "Show all". */
const LIST_CAP = 12;
/** More pages than this: a dropdown instead of a row of tabs that runs off the bar. */
const RANGE_TABS = 4;
/** Shows longer than this get a search. */
const SEARCH_FROM = 40;

/**
 * An entry's episodes: the season tabs, the range pages or a search for long
 * shows, the filler switch and layout choice, then the shelf or list.
 */
export function AnimeEpisodes({
  anime,
  franchise,
}: {
  anime: Anime;
  franchise?: Franchise;
}) {
  const pb = useAnimePlayback(anime);
  const prefs = usePrefs();
  const { data: flags } = useEpisodeFlags(pb.malId, [anime.title.english, anime.title.romaji]);
  const [layout, setLayout] = useEpisodeLayout();
  const sources = useSourcePicker();
  useFranchiseStills(franchise ? franchise.seasons.map((s) => s.card.id) : [anime.id], pb.metaId, pb.meta?.videos);

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
    if (flags && pb.metaId)
      playContext.filler(
        pb.metaId,
        pb.episodes.flatMap((e) => (e.video ? [e.video.id] : [])),
        pb.episodes.flatMap((e) => (e.video && flags.get(e.number)?.filler ? [e.video.id] : [])),
      );
  }, [flags, pb.episodes, pb.metaId]);

  // Long-running shows: pages of 100, opening on the one you're up to.
  const pages = Math.ceil(list.length / PAGE);
  const [page, setPage] = useState<number | null>(null);
  const upNextId = pb.next.kind !== "start" ? pb.next.ep?.video?.id : undefined;
  const upTo = Math.max(
    0,
    list.findIndex((v) => v.id === (pb.next.ep?.video?.id ?? "")),
  );
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

  // Nothing to play yet for a scheduled episode, nor before the entry is linked to an IMDb or Kitsu id.
  const request = (v: Video): PlayRequest | undefined =>
    v.id.startsWith(PENDING) || !pb.metaId
      ? undefined
      : {
          type: "series",
          metaId: pb.metaId,
          videoId: v.id,
          resumable: pb.byVideo.has(v.id),
          subtitle: `Episode ${v.episode}${v.title ? ` · ${v.title}` : ""}`,
        };

  if (!list.length) {
    const empty = <EmptyState className="anime-no-episodes">{pb.loading || pb.metaLoading ? "Loading episodes…" : "No episodes to play yet."}</EmptyState>;
    // A season that hasn't started yet still sits among the others.
    return franchise ? (
      <section className="seasons">
        <SeasonTabs franchise={franchise} />
        {empty}
      </section>
    ) : (
      empty
    );
  }

  // Ranges, a match count, or the "Episodes" heading: what sits left of the tools.
  const picker = found ? (
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
    <div className="anime-ranges" role="radiogroup" aria-label="Episodes">
      {Array.from({ length: pages }, (_, i) => (
        <button key={i} role="radio" className="anime-range tabular" aria-checked={i === current} onClick={() => setPage(i)}>
          {list[i * PAGE]?.episode}–{list[Math.min(list.length, (i + 1) * PAGE) - 1]?.episode}
        </button>
      ))}
    </div>
  ) : franchise ? null : (
    <h2 className="t-title2 anime-episode-count">Episodes</h2>
  );
  const tools = (
    <div className="anime-episodes-tools">
      {searchable && (
        <SearchField
          look="pill"
          className="anime-episode-search"
          value={query}
          onChange={setQuery}
          label="Find an episode by number or title"
          placeholder="Find episode"
        />
      )}
      {hasFiller && (
        <label className="anime-toggle t-callout">
          <Switch checked={prefs.animeSkipFiller} onChange={(on) => setPrefs({ animeSkipFiller: on })} />
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
  );

  return (
    <section className="seasons">
      {franchise && !picker ? (
        // Nothing to page through: the tools share the season tabs' row, right above the episodes.
        <div className="seasons-bar">
          <SeasonTabs franchise={franchise} />
          {tools}
        </div>
      ) : (
        <>
          {franchise && <SeasonTabs franchise={franchise} />}
          <div className="seasons-bar">
            <div className="seasons-picker">{picker}</div>
            {tools}
          </div>
        </>
      )}
      <EpisodeShelf
        // Downloads keyed like progress: under the id the anime plays from (test report 1, item 18).
        item={pb.meta}
        layout={layout}
        episodes={visible}
        progress={pb.byVideo}
        runtime={anime.duration ? `${anime.duration} min` : undefined}
        upNextId={upNextId}
        onPlay={(v) => {
          const req = request(v);
          if (req) sources.play(req);
        }}
        onSources={(v) => {
          const req = request(v);
          if (req) sources.choose(req);
        }}
      />
      {found && !found.length && <EmptyState>No episode matches “{query.trim()}”.</EmptyState>}
      {capped && (
        <Button variant="glass" className="anime-show-all" onClick={() => setExpanded(true)}>
          Show all {pageList.length} episodes
        </Button>
      )}
      <SourcePicker picker={sources} />
    </section>
  );
}

/** Id prefix for an episode that's scheduled but has nothing to play yet. */
const PENDING = "anime-pending:";

/**
 * The franchise's seasons (and films) as tabs, like a show's, on a row of
 * their own so long names (Paleblade's arcs) all show. Switching swaps the
 * page's season in place.
 */
export function SeasonTabs({ franchise: { seasons, active, select, loading } }: { franchise: Franchise }) {
  const title = useAnimeTitle();
  const labels = distinctLabels(
    seasons.map((s) => [title(s.card.title), s.card.title.romaji, s.card.title.english]),
    seasons.map((s) => s.label),
  );
  return (
    <div className="seasons-tabs">
      <SeasonPicker value={active} onChange={select} options={seasons.map((s, i) => ({ id: s.card.id, label: labels[i] }))} />
      {loading && (
        <span className="seasons-loading t-callout" role="status">
          Loading seasons…
        </span>
      )}
    </div>
  );
}

/**
 * Stills for every season's episodes, for the player's episode list
 * (lib/anime/stills.ts): the metadata addon's are missing past season one
 * for most anime. Entries ani.zip links to this same IMDb show match as their
 * episodes do; the others (a part IMDb lists as a show of its own, like
 * Hundred-Night Ash War next to Paleblade) are lined up by air date, since by
 * number Paleblade's first episode would take Hundred-Night Ash War's still.
 */
function useFranchiseStills(ids: number[], metaId: string | undefined, videos: Video[] | undefined) {
  const imdb = metaId?.startsWith("tt") ? metaId : undefined;
  const zips = useQueries({ queries: ids.map((id) => ({ ...aniZipQuery(id), enabled: !!imdb })) });
  const loaded = zips.map((z) => z.dataUpdatedAt).join();
  useEffect(() => {
    if (!imdb || !videos?.length) return;
    for (const { data: zip } of zips) {
      if (!zip) continue;
      const match = zip.mappings.imdb_id === imdb ? (e: AniZipEpisode) => matchVideo(e, videos) : alignByAirDate(regularEpisodes(zip), videos);
      for (const e of regularEpisodes(zip)) {
        const v = e.image ? match(e) : undefined;
        if (v) rememberStill(v.id, e.image!);
      }
    }
    // `loaded` stands in for `zips`, a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, imdb, videos]);
}
