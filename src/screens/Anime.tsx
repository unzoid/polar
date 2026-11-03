import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimeCard, AnimeLandscapeCard, useOpenAnime } from "../components/anime/AnimeCard";
import { Dropdown } from "../components/Dropdown";
import { ChevronRight, Close, Filters, Play, Search } from "../components/icons";
import { Img } from "../components/Img";
import { TitleLogo } from "../components/TitleLogo";
import { CardSkeleton } from "../components/PosterCard";
import { Row } from "../components/Row";
import { Sheet } from "../components/Sheet";
import {
  ANIME_GENRES,
  nextSeason,
  seasonOf,
  useAiringSchedule,
  useAiringToday,
  useAnimeBrowse,
  useAnimeGenre,
  useAnimeHome,
  type AiringSlot,
  type AnimeCard as Card,
  type BrowseFilters,
  type MediaFormat,
  type MediaSeason,
  type MediaStatus,
} from "../lib/anime/anilist";
import { aniZipQuery } from "../lib/anime/anizip";
import { countdown, FORMAT_LABEL, SEASON_LABEL, STATUS_LABEL, untilAiring, useAnimeTitle } from "../lib/anime/format";
import { animePreview } from "../lib/anime/preview";
import { useShelfVisible, type AnimeShelfId } from "../lib/anime/shelves";
import { usePrefs } from "../lib/prefs";
import { useRouter } from "../lib/router";
import type { MetaPreview } from "../lib/types";
import { HeroCarousel } from "./Home";

type Shape = "poster" | "landscape";

/**
 * The Anime tab, laid out like Home: the featured carousel on its widescreen
 * art, then shelves, in posters and banners. The week's schedule and the full
 * browser are pages of their own, opened from the top shelf's header.
 */
export function Anime() {
  const { data, isError, refetch } = useAnimeHome();
  const visible = useShelfVisible();
  const hasHero = visible("hero");
  const hero = useAnimeHero(hasHero ? data?.trending : undefined);
  const today = useAiringToday(visible("today"));
  const now = seasonOf();
  const next = nextSeason(now);
  const [index, setIndex] = useState(0);

  if (isError && !data) {
    return (
      <div className="scroll anime">
        <div className="empty t-body muted anime-unreachable">
          AniList didn't answer. It limits how often it can be asked, so give it a minute.{" "}
          <button className="settings-link" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  // The carousel's shows don't repeat on the shelf they came from.
  const featured = new Set(hero.cards.map((a) => a.id));
  const shelves: { id: AnimeShelfId; title: string; shape: Shape; items?: Card[]; label?: (a: Card) => string | undefined }[] = [
    { id: "season", title: `Airing This ${SEASON_LABEL[now.season]}`, shape: "poster", items: data?.season },
    { id: "trending", title: "Trending Now", shape: "poster", items: data?.trending.filter((a) => !featured.has(a.id)) },
    { id: "upcoming", title: `Coming in ${SEASON_LABEL[next.season]} ${next.year}`, shape: "poster", items: data?.upcoming, label: upcomingLabel },
    { id: "top", title: "Highest Rated", shape: "landscape", items: data?.top },
    { id: "popular", title: "Most Popular", shape: "poster", items: data?.popular },
    { id: "movies", title: "Movies", shape: "landscape", items: data?.movies },
  ];
  const on = shelves.filter((s) => visible(s.id));
  // A day with nothing on it (or an error) leaves the shelf out rather than showing a stub.
  const showToday = visible("today") && !today.isError && today.slots?.length !== 0;
  const genres = visible("genres");

  // The top shelf, whichever that is, carries the way to Schedule and Browse.
  const links = <AnimeLinks />;

  return (
    <div className="scroll home anime" data-hero={hasHero}>
      {hasHero && (
        <HeroCarousel
          items={hero.items}
          // The set can shrink (a new title language, art that didn't load): never point past its end.
          index={hero.items?.length ? index % hero.items.length : 0}
          setIndex={setIndex}
          content={(item) => {
            const card = hero.cards.find((a) => item.id === animePreviewId(a));
            return card && <AnimeHeroContent card={card} item={item} />;
          }}
        />
      )}
      <div className="rows home-rows">
        {!showToday && !on.length && !genres && <Row action={links}>{null}</Row>}
        {showToday && (
          <Row title="Airing Today" shape="landscape" action={links}>
            {today.slots
              ? forShape(today.slots.map((s) => s.media), "landscape").map((m) => {
                  const s = today.slots!.find((x) => x.media.id === m.id)!;
                  return <AnimeLandscapeCard key={s.id} item={m} label={slotLabel(s)} />;
                })
              : Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} shape="landscape" />)}
          </Row>
        )}
        {on.map((s, i) => (
          <Shelf key={s.id} title={s.title} shape={s.shape} items={s.items} label={s.label} action={!showToday && i === 0 ? links : undefined} />
        ))}
        {genres &&
          ANIME_GENRES.map((g, i) => (
            <GenreShelf key={g} genre={g} shape={i % 3 === 0 ? "landscape" : "poster"} action={!showToday && !on.length && i === 0 ? links : undefined} />
          ))}
      </div>
    </div>
  );
}

const animePreviewId = (a: Card) => animePreview(a, null, "english").id;

/** Where the rest of the section lives. */
function AnimeLinks() {
  const { navigate } = useRouter();
  return (
    <span className="anime-row-links">
      <button className="anime-row-link" onClick={() => navigate({ name: "anime-schedule" })}>
        Schedule <ChevronRight size={16} />
      </button>
      <button className="anime-row-link" onClick={() => navigate({ name: "anime-browse" })}>
        Browse <ChevronRight size={16} />
      </button>
    </span>
  );
}

/** How many trending shows the carousel holds, and how far down the list it looks for ones with art. */
const HERO_COUNT = 6;
const HERO_POOL = 10;

/** The carousel's titles: trending shows with widescreen art, held back until ani.zip answers so the art doesn't swap mid-view. */
function useAnimeHero(trending?: Card[]) {
  const { animeTitles } = usePrefs();
  const pool = useMemo(() => trending?.slice(0, HERO_POOL), [trending]);
  const zips = useQueries({ queries: (pool ?? []).map((a) => aniZipQuery(a.id)) });
  const settled = !!pool && zips.every((z) => !z.isLoading);
  const updated = zips.map((z) => z.dataUpdatedAt).join();
  return useMemo(() => {
    if (!pool || !settled) return { items: undefined as MetaPreview[] | undefined, cards: [] as Card[] };
    const picks = pool
      .map((card, i) => ({ card, zip: zips[i]?.data }))
      .filter(({ card, zip }) => card.bannerImage || zip?.images?.some((m) => m.coverType === "Fanart"))
      .slice(0, HERO_COUNT);
    return { items: picks.map(({ card, zip }) => animePreview(card, zip, animeTitles)), cards: picks.map((p) => p.card) };
    // `zips` is a new array every render; `updated` says when its contents changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, settled, updated, animeTitles]);
}

function AnimeHeroContent({ card, item }: { card: Card; item: MetaPreview }) {
  const open = useOpenAnime(card);
  const { animeCardCountdown } = usePrefs();
  const next = animeCardCountdown ? card.nextAiringEpisode : undefined;
  return (
    <div className="hero-content">
      {item.logo ? <TitleLogo src={item.logo} alt={item.name} className="hero-logo" loading="eager" /> : <h1 className="t-display hero-title">{item.name}</h1>}
      <p className="hero-kind t-callout tabular">
        {[card.format && FORMAT_LABEL[card.format], ...(card.genres ?? []).slice(0, 2), next && `Episode ${next.episode} in ${countdown(untilAiring(next.airingAt))}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="hero-description t-body">{item.description}</p>
      <div className="hero-actions">
        <button className="btn btn-primary" {...open}>
          <Play size={18} fill="currentColor" /> Watch Now
        </button>
      </div>
    </div>
  );
}

function slotLabel(s: AiringSlot) {
  const time = new Date(s.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Episode ${s.episode} · ${time}`;
}

function upcomingLabel(a: Card) {
  const d = a.startDate;
  if (d?.month && d.day) return new Date(d.year!, d.month - 1, d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return a.format ? FORMAT_LABEL[a.format] : undefined;
}

/** Banners aren't universal: a widescreen shelf keeps to the shows that have one, unless too few do. */
function forShape(items: Card[], shape: Shape) {
  if (shape === "poster") return items;
  const banners = items.filter((a) => a.bannerImage);
  return banners.length >= 6 ? banners : items;
}

function Shelf({
  title,
  shape,
  items,
  label,
  action,
}: {
  title: string;
  shape: Shape;
  items?: Card[];
  label?: (a: Card) => string | undefined;
  action?: ReactNode;
}) {
  const C = shape === "landscape" ? AnimeLandscapeCard : AnimeCard;
  return (
    <Row title={title} shape={shape} action={action}>
      {items
        ? forShape(items, shape).map((a) => <C key={a.id} item={a} label={label?.(a)} />)
        : Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} shape={shape} />)}
    </Row>
  );
}

/** Genre shelves below the fold only ask AniList once they're close. */
function GenreShelf({ genre, shape, action }: { genre: string; shape: Shape; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    // The page scrolls inside its own container, so that's the observer's root.
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { root: el.closest(".scroll"), rootMargin: "0px 0px 700px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const { data } = useAnimeGenre(genre, near);
  return (
    <div ref={ref}>
      <Shelf title={genre} shape={shape} items={data} action={action} />
    </div>
  );
}

/** A page of its own, under the same header as the app's other lists. */
function SubPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="scroll anime">
      {/* Scrolls away with the page: the title isn't needed once you're in the list. */}
      <header className="screen-header">
        <h1 className="t-title1">{title}</h1>
      </header>
      {children}
    </div>
  );
}

export const AnimeSchedule = () => (
  <SubPage title="Schedule">
    <ScheduleView />
  </SubPage>
);

export const AnimeBrowse = () => (
  <SubPage title="Browse Anime">
    <BrowseView />
  </SubPage>
);

// --- Schedule ----------------------------------------------------------------

const DAY_S = 86_400;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * The week's airings by day in the viewer's own time zone: today first,
 * yesterday one tap back. Times are when the episode first airs in Japan
 * (streaming services usually follow within the hour).
 */
function ScheduleView() {
  const today = startOfDay(new Date());
  const from = Math.floor(today.getTime() / 1000) - DAY_S;
  const to = from + 8 * DAY_S;
  const { data, isLoading, isError } = useAiringSchedule(from, to);
  const days = useMemo(() => Array.from({ length: 8 }, (_, i) => new Date((from + i * DAY_S) * 1000)), [from]);
  const [day, setDay] = useState(1); // today

  const slots = useMemo(() => {
    const start = Math.floor(days[day].getTime() / 1000);
    return (data ?? []).filter((s) => s.airingAt >= start && s.airingAt < start + DAY_S);
  }, [data, days, day]);

  return (
    <div className="anime-schedule">
      <div className="anime-days" role="tablist" aria-label="Day">
        {days.map((d, i) => (
          <button key={i} role="tab" className="anime-day" aria-selected={i === day} onClick={() => setDay(i)}>
            <span className="anime-day-name">{i === 1 ? "Today" : i === 0 ? "Yesterday" : i === 2 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" })}</span>
            <span className="anime-day-date tabular">{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          </button>
        ))}
      </div>
      {isError && <p className="empty t-body muted">Couldn't load the schedule from AniList.</p>}
      {isLoading && (
        <div className="anime-slots">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="anime-slot skeleton" style={{ height: 88 }} />
          ))}
        </div>
      )}
      {data && !slots.length && <p className="empty t-body muted">Nothing airs this day.</p>}
      <div className="anime-slots">
        {slots.map((s) => (
          <ScheduleSlot key={s.id} slot={s} />
        ))}
      </div>
    </div>
  );
}

function ScheduleSlot({ slot }: { slot: AiringSlot }) {
  const title = useAnimeTitle()(slot.media.title);
  const open = useOpenAnime(slot.media);
  const left = untilAiring(slot.airingAt);
  const aired = left <= 0;
  const time = new Date(slot.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const total = slot.media.episodes;
  return (
    <button className="anime-slot" data-aired={aired} {...open}>
      <span className="anime-slot-time tabular">{time}</span>
      <Img src={slot.media.coverImage.large ?? undefined} alt="" className="anime-slot-cover" />
      <span className="anime-slot-text">
        <span className="anime-slot-title t-headline">{title}</span>
        <span className="t-caption muted tabular">
          Episode {slot.episode}
          {total ? ` of ${total}` : ""}
          {slot.media.format && slot.media.format !== "TV" ? ` · ${FORMAT_LABEL[slot.media.format]}` : ""}
        </span>
      </span>
      <span className="anime-slot-when tabular">{aired ? "Aired" : `in ${countdown(left)}`}</span>
    </button>
  );
}

// --- Browse ------------------------------------------------------------------

const SORTS: { value: BrowseFilters["sort"]; label: string }[] = [
  { value: "POPULARITY_DESC", label: "Popularity" },
  { value: "TRENDING_DESC", label: "Trending" },
  { value: "SCORE_DESC", label: "Score" },
  { value: "START_DATE_DESC", label: "Newest" },
  { value: "TITLE_ROMAJI", label: "Title" },
];

const BROWSE_FORMATS: MediaFormat[] = ["TV", "MOVIE", "ONA", "OVA", "SPECIAL", "TV_SHORT"];
const BROWSE_STATUSES: MediaStatus[] = ["RELEASING", "FINISHED", "NOT_YET_RELEASED"];
const SEASONS: MediaSeason[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="anime-filter-field">
      <span className="anime-filter-label">{label}</span>
      {children}
    </div>
  );
}

function BrowseView() {
  const [text, setText] = useState("");
  const [f, setF] = useState<BrowseFilters>({ search: "", genre: "", season: "", year: 0, format: "", status: "", sort: "POPULARITY_DESC" });
  useEffect(() => {
    const t = window.setTimeout(() => setF((f) => ({ ...f, search: text.trim() })), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const set = (patch: Partial<BrowseFilters>) => setF((f) => ({ ...f, ...patch }));
  const q = useAnimeBrowse(f);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage(), {
      rootMargin: "1200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear + 2 - 1970 }, (_, i) => thisYear + 1 - i);
  const seen = new Set<number>();
  const items = (q.data?.pages.flatMap((p) => p.media) ?? []).filter((m) => !seen.has(m.id) && seen.add(m.id));
  const [panel, setPanel] = useState(false);
  // What's narrowing the list, each with a way to take it off again.
  type Active = { label: string; clear: Partial<BrowseFilters> };
  const active = [
    f.genre ? { label: f.genre, clear: { genre: "" } } : null,
    f.year ? { label: String(f.year), clear: { year: 0 } } : null,
    f.season ? { label: SEASON_LABEL[f.season], clear: { season: "" } } : null,
    f.format ? { label: FORMAT_LABEL[f.format], clear: { format: "" } } : null,
    f.status ? { label: STATUS_LABEL[f.status], clear: { status: "" } } : null,
  ].filter(Boolean) as Active[];

  return (
    <div className="anime-browse">
      <div className="anime-filters">
        <label className="market-search anime-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search anime"
            aria-label="Search anime"
            spellCheck={false}
            autoComplete="off"
          />
          {text && (
            <button type="button" className="market-search-clear" aria-label="Clear search" onClick={() => setText("")}>
              <Close size={14} strokeWidth={2.5} />
            </button>
          )}
        </label>
        <button className="anime-filter-button pressable" aria-label="Filters" title="Filters" aria-expanded={panel} onClick={() => setPanel(true)}>
          <Filters size={18} />
          {active.length > 0 && <span className="anime-filter-count tabular">{active.length}</span>}
        </button>
        <span className="anime-sort">
          <Dropdown label="Sort" value={f.sort} onChange={(v) => set({ sort: v })} options={SORTS} />
        </span>
      </div>
      <Sheet open={panel} onClose={() => setPanel(false)} title="Filters" subtitle={active.length ? `${active.length} on` : "Narrow the list down"}>
        <div className="anime-filter-panel">
          <FilterField label="Genre">
            <Dropdown label="Genre" value={f.genre || "any"} onChange={(v) => set({ genre: v === "any" ? "" : v })} options={[{ value: "any", label: "Any" }, ...ANIME_GENRES.map((g) => ({ value: g, label: g }))]} />
          </FilterField>
          <FilterField label="Year">
            <Dropdown label="Year" value={String(f.year || "any")} onChange={(v) => set({ year: v === "any" ? 0 : Number(v) })} options={[{ value: "any", label: "Any" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
          </FilterField>
          <FilterField label="Season">
            <Dropdown label="Season" value={f.season || "any"} onChange={(v) => set({ season: v === "any" ? "" : (v as MediaSeason) })} options={[{ value: "any", label: "Any" }, ...SEASONS.map((s) => ({ value: s, label: SEASON_LABEL[s] }))]} />
          </FilterField>
          <FilterField label="Format">
            <Dropdown label="Format" value={f.format || "any"} onChange={(v) => set({ format: v === "any" ? "" : (v as MediaFormat) })} options={[{ value: "any", label: "Any" }, ...BROWSE_FORMATS.map((s) => ({ value: s, label: FORMAT_LABEL[s] }))]} />
          </FilterField>
          <FilterField label="Status">
            <Dropdown label="Status" value={f.status || "any"} onChange={(v) => set({ status: v === "any" ? "" : (v as MediaStatus) })} options={[{ value: "any", label: "Any" }, ...BROWSE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
          </FilterField>
          {active.length > 0 && (
            <button className="anime-row-link anime-clear" onClick={() => set({ genre: "", season: "", year: 0, format: "", status: "" })}>
              Clear all
            </button>
          )}
        </div>
      </Sheet>
      {active.length > 0 && (
        <div className="anime-active-filters">
          {active.map((a) => (
            <button key={a.label} className="srcf-tag" aria-pressed onClick={() => set(a.clear)} aria-label={`Remove ${a.label}`}>
              {a.label}
              <Close size={11} strokeWidth={2.5} />
            </button>
          ))}
          {active.length > 1 && (
            <button className="anime-row-link anime-clear" onClick={() => set({ genre: "", season: "", year: 0, format: "", status: "" })}>
              Clear all
            </button>
          )}
        </div>
      )}
      <div className="poster-grid">
        {items.map((a) => (
          <AnimeCard key={a.id} item={a} />
        ))}
        {(q.isLoading || q.isFetchingNextPage) && Array.from({ length: 12 }, (_, i) => <CardSkeleton key={`s${i}`} />)}
      </div>
      {q.data && !items.length && <p className="empty t-body muted">Nothing matches. Try fewer filters.</p>}
      {q.isError && <p className="empty t-body muted">AniList didn't answer. Try again in a minute.</p>}
      <div ref={sentinel} />
    </div>
  );
}
