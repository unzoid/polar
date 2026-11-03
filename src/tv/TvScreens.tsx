import { useEffect, useMemo, useRef, useState } from "react";
import { Speed } from "../components/icons";
import { addRecentSearch, clearRecentSearches, useRecentSearches } from "../lib/recentSearches";
import { playSound } from "./sounds";
import { useContinueWatching, useLibrary, useSearch, useWatchHistory } from "../lib/queries";
import {
  GENRES,
  progressFraction,
  progressItem,
  shelfKey,
  todaysShelves,
  trendingPicks,
  useSeeds,
  useShownAbove,
  useTrending,
  type Shape,
  type Shelf,
} from "../lib/shelves";
import type { ContentType, MetaPreview } from "../lib/types";
import { useBack, usePageActive } from "./shell";
import { focusWhenReady } from "./spatial";
import { usePlaylistItem } from "../components/Playlists";
import { usePlaylists, type PlaylistItem } from "../lib/playlists";
import { localStream, useDownloads } from "../lib/downloads";
import { episodeCode } from "../lib/format";
import { useRouter } from "../lib/router";
import { TvBrowse, TvCard, TvContinueRail, TvItemsRail, TvRail, TvShelfRail, type RailRow } from "./TvRails";
import { TvKeyboard } from "./TvKeyboard";
import { byDay, dayLabel, useCalendar } from "../lib/calendar";

const NO_TITLES: MetaPreview[] = [];

/** Home: what you're watching, what's trending, then the day's shelves. */
export function TvHome() {
  const seeds = useSeeds();
  const shelves = useMemo(() => todaysShelves(seeds), [seeds]);
  const trending = useTrending();
  const picks = useMemo(
    () => (trending.series && trending.movies ? trendingPicks(trending.series, trending.movies, [], 20) : undefined),
    [trending.series, trending.movies],
  );
  const shownAbove = useShownAbove(shelves, picks ?? NO_TITLES);
  const { data: watching } = useContinueWatching();
  const watched = useMemo(() => new Set((watching ?? []).map((p) => p.metaId)), [watching]);

  const rows: RailRow[] = [
    { key: "continue", render: () => <TvContinueRail /> },
    { key: "trending", render: () => <TvItemsRail title="Trending Now" items={picks} shape="poster" /> },
    ...shelves.map((shelf, i) => ({
      key: shelfKey(shelf).join("/"),
      render: (near: boolean) => (
        <TvShelfRail
          shelf={shelf}
          enabled={near}
          // Recommendations also skip what you're already watching.
          exclude={shelf.kind === "because" ? new Set([...shownAbove[i], ...watched]) : shownAbove[i]}
        />
      ),
    })),
  ];
  return <TvBrowse rows={rows} />;
}

const CATALOGS = [
  { id: "trending", title: "Trending" },
  { id: "popular", title: "Popular" },
  { id: "new", title: "New" },
  { id: "top_rated", title: "Top Rated" },
  { id: "gems", title: "Hidden Gems" },
  { id: "classics", title: "Classics" },
];

/** Series or Movies: every catalog, then every genre, as rails. */
export function TvDiscover({ type }: { type: ContentType }) {
  const shelves = useMemo<Shelf[]>(() => {
    const noun = type === "movie" ? "Movies" : "Series";
    const shapeAt = (i: number): Shape => (i % 3 === 0 ? "landscape" : "poster");
    const catalogs = CATALOGS.map((c, i): Shelf => ({ kind: "catalog", type, id: c.id, title: `${c.title} ${noun}`, shape: shapeAt(i) }));
    const genres = GENRES.filter((g) => g.type === type).map(
      (g, i): Shelf => ({ kind: "catalog", type, id: "popular", genre: g.genre, title: g.title, shape: shapeAt(i + 1) }),
    );
    return [...catalogs, ...genres];
  }, [type]);
  const shownAbove = useShownAbove(shelves, NO_TITLES);
  const rows: RailRow[] = shelves.map((shelf, i) => ({
    key: shelfKey(shelf).join("/"),
    render: (near) => <TvShelfRail shelf={shelf} enabled={near} exclude={shownAbove[i]} />,
  }));
  return <TvBrowse rows={rows} />;
}

/** Library: your downloads, what you've saved, what you've watched and your playlists, as rails under the stage. */
export function TvLibrary() {
  const { data: saved } = useLibrary();
  const { data: history } = useWatchHistory();
  const { data: downloads } = useDownloads();
  const playlists = usePlaylists();
  const { navigate } = useRouter();
  // Only what's here to watch: a download still coming down can't play yet.
  const ready = (downloads ?? []).filter((d) => d.state === "done");

  if (saved?.length === 0 && history?.length === 0 && playlists.length === 0 && !ready.length) {
    return (
      <div className="tv-note">
        <h1 className="tv-heading">Library</h1>
        <p className="tv-empty">Titles you save, watch or put in a playlist appear here.</p>
      </div>
    );
  }

  const rows: RailRow[] = [
    {
      key: "downloads",
      render: () =>
        ready.length ? (
          <TvRail title="Downloads">
            {ready.map((d) => (
              <TvCard
                key={d.id}
                item={{ id: d.metaId, type: d.type, name: d.name, poster: d.poster, background: d.thumbnail ?? d.background, logo: d.logo }}
                shape="landscape"
                chip={[d.season != null && d.episode != null ? episodeCode(d.season, d.episode) : null, d.quality].filter(Boolean).join(" · ")}
                onOpen={() => navigate({ name: "player", type: d.type, metaId: d.metaId, videoId: d.id, stream: localStream(d) })}
              />
            ))}
          </TvRail>
        ) : null,
    },
    { key: "saved", render: () => <TvItemsRail title="Saved" items={saved} shape="poster" /> },
    {
      key: "watched",
      render: () =>
        history?.length ? (
          <TvRail title="Watched">
            {history.map((p) => (
              <TvCard key={p.metaId} item={progressItem(p)} shape="landscape" progress={progressFraction(p)} entry={p} />
            ))}
          </TvRail>
        ) : null,
    },
    ...playlists
      .filter((p) => p.items.length)
      .map((p) => ({
        key: `playlist/${p.id}`,
        render: () => (
          <TvRail title={p.name}>
            {p.items.map((i) => (
              <TvPlaylistCard key={i.id} item={i} />
            ))}
          </TvRail>
        ),
      })),
  ];
  return <TvBrowse rows={rows} />;
}

function TvPlaylistCard({ item }: { item: PlaylistItem }) {
  const shown = usePlaylistItem(item);
  return <TvCard item={shown ?? { id: item.id, type: item.type, name: "" }} shape="poster" />;
}

const MAX_QUERY = 60;

/**
 * Search, controller-first: an on-screen keyboard on the left, results on
 * the right as you type. A real keyboard types straight in, too.
 */
export function TvSearch() {
  const active = usePageActive();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const { data, isPlaceholderData } = useSearch(query);
  const recent = useRecentSearches();
  const trending = useTrending();
  const suggestions = useMemo(
    () => (trending.series && trending.movies ? trendingPicks(trending.series, trending.movies, [], 18) : undefined),
    [trending.series, trending.movies],
  );

  // The network waits for a pause in typing.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  // A genre picked from "Browse by Genre" fills the results; Back (or typing) returns to the list.
  const [genre, setGenre] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const openGenre = (g: string) => {
    setGenre(g);
    // The tile you pressed is gone: land on the genre's first title once it's in.
    requestAnimationFrame(() => focusWhenReady(resultsRef.current));
  };
  useBack(active && !!genre, () => {
    setGenre(null);
    requestAnimationFrame(() => focusWhenReady(resultsRef.current));
  });
  useEffect(() => {
    if (text) setGenre(null);
  }, [text]);

  const searching = query.length > 1;
  const empty = searching && data && !isPlaceholderData && !data.movies.length && !data.series.length;

  // Enter (or a recent search): search now, and go to the first result once it's in.
  const pendingFocus = useRef<string | null>(null);
  const [submits, setSubmits] = useState(0);
  const runSearch = (q: string) => {
    q = q.trim().slice(0, MAX_QUERY);
    if (q.length < 2) return false;
    setText(q);
    setQuery(q);
    addRecentSearch(q);
    pendingFocus.current = q;
    setSubmits((n) => n + 1); // the same search again still moves to the results
    return true;
  };
  useEffect(() => {
    if (pendingFocus.current !== query || !data || isPlaceholderData) return;
    pendingFocus.current = null;
    if (data.movies.length || data.series.length) return focusWhenReady(resultsRef.current);
  }, [query, data, isPlaceholderData, submits]);

  return (
    <div className="tv-search">
      <aside className="tv-osk">
        <TvKeyboard
          text={text}
          onChange={setText}
          // Enter in the field (the shell's own Enter sound doesn't reach it).
          onSubmit={() => runSearch(text) && playSound("select")}
          placeholder="Search titles"
          active={active}
          max={MAX_QUERY}
        />
        {recent.length > 0 && (
          <section className="tv-recent" data-nav-memory aria-label="Recent searches">
            <div className="tv-recent-head">
              <h2 className="tv-recent-title">Recent Searches</h2>
              <button className="tv-recent-clear" onClick={clearRecentSearches}>
                Clear
              </button>
            </div>
            {recent.map((r) => (
              <button key={r} className="tv-recent-item" onClick={() => runSearch(r)}>
                <Speed size={18} />
                <span>{r}</span>
              </button>
            ))}
          </section>
        )}
      </aside>
      <div
        className="tv-scroll tv-search-results"
        data-nav-scroll="start"
        ref={resultsRef}
        // Opening a result counts as running the search.
        onClickCapture={(e) => searching && (e.target as HTMLElement).closest(".tv-card") && addRecentSearch(query)}
      >
        {!searching && genre && <TvGenreResults genre={genre} />}
        {!searching && !genre && (
          <>
            <TvRail title="Browse by Genre">
              {SEARCH_GENRES.map((g) => (
                <button key={g} className="tv-card tv-genre" data-shape="genre" onClick={() => openGenre(g)}>
                  <span className="tv-card-frame">
                    <span className="tv-genre-name">{g}</span>
                  </span>
                </button>
              ))}
            </TvRail>
            <TvItemsRail title="Popular Searches" items={suggestions} shape="poster" />
          </>
        )}
        {searching && !data && <TvItemsRail title="Results" items={undefined} shape="poster" />}
        {searching && data && (
          <>
            <TvItemsRail title="Movies" items={data.movies} shape="poster" />
            <TvItemsRail title="Series" items={data.series} shape="poster" />
          </>
        )}
        {empty && <p className="tv-empty">Nothing found for “{query}”.</p>}
      </div>
    </div>
  );
}

/** Genres to browse from Search. */
const SEARCH_GENRES = [
  "Action",
  "Comedy",
  "Drama",
  "Sci-Fi",
  "Thriller",
  "Horror",
  "Crime",
  "Animation",
  "Romance",
  "Fantasy",
  "Mystery",
  "Adventure",
  "Family",
  "Documentary",
];

/** One genre's popular and top-rated titles, movies and series. */
function TvGenreResults({ genre }: { genre: string }) {
  const shelves: Shelf[] = [
    { kind: "catalog", type: "movie", id: "popular", genre, title: `Popular ${genre} Movies`, shape: "poster" },
    { kind: "catalog", type: "series", id: "popular", genre, title: `Popular ${genre} Series`, shape: "poster" },
    { kind: "catalog", type: "movie", id: "top_rated", genre, title: `Top Rated ${genre} Movies`, shape: "poster" },
    { kind: "catalog", type: "series", id: "top_rated", genre, title: `Top Rated ${genre} Series`, shape: "poster" },
  ];
  return (
    <>
      <h1 className="tv-heading tv-genre-heading">{genre}</h1>
      {shelves.map((s) => (
        <TvShelfRail key={shelfKey(s).join("/")} shelf={s} enabled exclude={NO_IDS} />
      ))}
    </>
  );
}
const NO_IDS = new Set<string>();

/** The Calendar (when it's on): one rail per day, last week first, then what's coming. */
export function TvCalendar() {
  const { entries, loading, showCount } = useCalendar();
  const days = useMemo(() => byDay(entries), [entries]);

  if (!loading && !days.length) {
    return (
      <div className="tv-note">
        <h1 className="tv-heading">Calendar</h1>
        <p className="tv-empty">
          {showCount === 0
            ? "Add shows to your library, or start watching one, and their new episodes show up here."
            : "Nothing aired in the last week, and nothing's scheduled yet for your shows."}
        </p>
      </div>
    );
  }

  const rows: RailRow[] = days.map((d) => {
    const label = dayLabel(d.day);
    return {
      key: String(d.day),
      render: () => (
        <TvRail title={`${label.name} · ${label.date}`}>
          {d.entries.map(({ show, video }) => (
            <TvCard
              key={video.id}
              item={show}
              shape="landscape"
              kicker={label.past ? "Aired" : label.today ? "Today" : "Coming up"}
              chip={`S${video.season}, E${video.episode}`}
            />
          ))}
        </TvRail>
      ),
    };
  });
  return <TvBrowse rows={rows} />;
}
