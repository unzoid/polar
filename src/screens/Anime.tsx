import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimeCard, AnimeLandscapeCard, useAnimeHandlers, useOpenAnime } from "../components/anime/AnimeCard";
import { Dropdown } from "../components/Dropdown";
import { Calendar, Close, Filters, Grid, Play } from "../components/icons";
import { Img } from "../components/Img";
import { TitleHeading } from "../components/title/TitleHeading";
import { joinFacts } from "../lib/format";
import { Shelf } from "../components/title/Shelf";
import { PosterGrid } from "../components/title/PosterGrid";
import { Sheet } from "../components/Sheet";
import {
  ANIME_GENRES,
  ANIME_TAGS,
  nextSeason,
  seasonOf,
  useAiringSchedule,
  useAiringToday,
  useAnimeBrowse,
  useAnimeGenre,
  useAniListBusy,
  rowPriority,
  reprioritiseAniList,
  useAnimeHome,
  type AiringSlot,
  type AnimeCard as Card,
  type BrowseFilters,
  type MediaFormat,
  type MediaSeason,
  type MediaStatus,
} from "../lib/anime";
import {
  animePreview,
  type AnimeShelfId,
  aniZipQuery,
  countdown,
  FORMAT_LABEL,
  SEASON_LABEL,
  STATUS_LABEL,
  untilAiring,
  useCardsShown,
  useAnimeTitle,
  useFranchiseBanners,
  useShelfVisible,
} from "../lib/anime";
import { useViewportPlace } from "../lib/ui";
import { usePrefs } from "../lib/settings";
import { useRouter, type Route } from "../lib/router";
import type { MetaPreview } from "../lib/types";
import { HeroCarousel } from "./Home";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { SearchField } from "../components/ui/SearchField";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";

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
  const todayNote = useWaitNote(!today.slots);
  const now = seasonOf();
  const next = nextSeason(now);
  const [index, setIndex] = useState(0);
  const handlers = useAnimeHandlers();
  const { navigate } = useRouter();

  if (isError && !data) {
    return (
      <div className="scroll anime">
        <EmptyState className="anime-unreachable" action={{ label: "Try again", onClick: () => void refetch() }}>
          AniList didn't answer. It limits how often it can be asked, so give it a minute.
        </EmptyState>
      </div>
    );
  }

  // The carousel's shows don't repeat on the shelf they came from.
  const featured = new Set(hero.cards.map((a) => a.id));
  // Each heading opens the grid with the filters its shelf asks AniList for (#48).
  const browse = (title: string, filters: Partial<BrowseFilters>): Route => ({ name: "anime-browse", title, ...filters });
  const seasonTitle = `Airing This ${SEASON_LABEL[now.season]}`;
  const upcomingTitle = `Coming in ${SEASON_LABEL[next.season]} ${next.year}`;
  const shelves: { id: AnimeShelfId; title: string; shape: Shape; items?: Card[]; label?: (a: Card) => string | undefined; to: Route }[] = [
    { id: "season", title: seasonTitle, shape: "poster", items: data?.season, to: browse(seasonTitle, { ...now, sort: "POPULARITY_DESC" }) },
    {
      id: "trending",
      title: "Trending Now",
      shape: "poster",
      items: data?.trending.filter((a) => !featured.has(a.id)),
      to: browse("Trending Now", { sort: "TRENDING_DESC" }),
    },
    {
      id: "upcoming",
      title: upcomingTitle,
      shape: "poster",
      items: data?.upcoming,
      label: upcomingLabel,
      to: browse(upcomingTitle, { ...next, sort: "POPULARITY_DESC" }),
    },
    { id: "top", title: "Highest Rated", shape: "landscape", items: data?.top, to: browse("Highest Rated", { sort: "SCORE_DESC" }) },
    { id: "popular", title: "Most Popular", shape: "poster", items: data?.popular, to: browse("Most Popular", { sort: "POPULARITY_DESC" }) },
    { id: "movies", title: "Movies", shape: "landscape", items: data?.movies, to: browse("Anime Movies", { format: "MOVIE", sort: "POPULARITY_DESC" }) },
  ];
  const on = shelves.filter((s) => visible(s.id));
  // A day with nothing on it (or an error) leaves the shelf out rather than showing a stub.
  const showToday = visible("today") && !today.isError && today.slots?.length !== 0;
  const genres = visible("genres");
  // Today's airings sit below the first shelves: a schedule, not a headline.
  const todayAt = Math.min(2, on.length);
  const airing = today.slots?.map((s) => s.media);
  const todayRow = showToday && (
    <Shelf
      key="today"
      title="Airing Today"
      onOpen={() => navigate({ name: "anime-schedule" })}
      shape="landscape"
      action={todayNote}
      items={airing && forShape(airing, "landscape")}
      skeletons={6}
      card={(m) => {
        const s = today.slots!.find((x) => x.media.id === m.id)!;
        return <AnimeLandscapeCard key={s.id} item={m} label={slotLabel(s)} />;
      }}
    />
  );

  return (
    <div className="scroll home anime" data-hero={hasHero}>
      {hasHero && (
        <HeroCarousel
          items={hero.items}
          // The set can shrink (a new title language, art that didn't load): never point past its end.
          index={hero.items?.length ? index % hero.items.length : 0}
          setIndex={setIndex}
          handlers={(item) => {
            const card = hero.cards.find((a) => item.id === animePreviewId(a));
            return card ? handlers(card) : { onClick: () => {}, onContextMenu: (e) => e.preventDefault() };
          }}
          content={(item) => {
            const i = hero.cards.findIndex((a) => item.id === animePreviewId(a));
            return i >= 0 && <AnimeHeroContent card={hero.cards[i]} item={item} part={hero.parts[i]} />;
          }}
        />
      )}
      <AnimeNav />
      <div className="rows home-rows">
        {on.map((s, i) => [i === todayAt && todayRow, <AnimeShelf key={s.id} title={s.title} shape={s.shape} items={s.items} label={s.label} onOpen={() => navigate(s.to)} />])}
        {todayAt === on.length && todayRow}
        {genres && ANIME_GENRES.map((g, i) => <GenreShelf key={g} genre={g} shape={i % 3 === 0 ? "landscape" : "poster"} />)}
      </div>
    </div>
  );
}

const animePreviewId = (a: Card) => animePreview(a, null, "english").id;

/** Where the rest of the section lives: the schedule, the full browser, and a way in by genre or kind of show. */
function AnimeNav() {
  const { navigate } = useRouter();
  return (
    <nav className="anime-nav" aria-label="Browse anime">
      <Chip className="anime-nav-main" onClick={() => navigate({ name: "anime-schedule" })}>
        <Calendar size={15} /> Schedule
      </Chip>
      <Chip className="anime-nav-main" onClick={() => navigate({ name: "anime-browse" })}>
        <Grid size={15} /> Browse All
      </Chip>
      <span className="anime-nav-sep" aria-hidden />
      {ANIME_GENRES.map((g) => (
        <Chip key={g} onClick={() => navigate({ name: "anime-browse", genre: g })}>
          {g}
        </Chip>
      ))}
      {ANIME_TAGS.map((t) => (
        <Chip key={t} onClick={() => navigate({ name: "anime-browse", tag: t })}>
          {t}
        </Chip>
      ))}
    </nav>
  );
}

/** How many trending shows the carousel holds, and how far down the list it looks for ones with art. */
const HERO_COUNT = 6;
const HERO_POOL = 10;

/**
 * The carousel's titles: trending shows with widescreen art, held back until ani.zip answers so the art doesn't swap mid-view.
 * With seasons grouped, each shows its franchise's base title's art and logo, as the page it opens does, and `parts` names
 * which part is trending (#325).
 */
function useAnimeHero(trending?: Card[]) {
  const { animeTitles } = usePrefs();
  const pool = useMemo(() => trending?.slice(0, HERO_POOL), [trending]);
  const zips = useQueries({ queries: (pool ?? []).map((a) => aniZipQuery(a.id)) });
  const settled = !!pool && zips.every((z) => !z.isLoading);
  const updated = zips.map((z) => z.dataUpdatedAt).join();
  const picks = useMemo(() => {
    if (!pool || !settled) return undefined;
    return pool
      .map((card, i) => ({ card, zip: zips[i]?.data }))
      .filter(({ card, zip }) => card.bannerImage || zip?.images?.some((m) => m.coverType === "Fanart"))
      .slice(0, HERO_COUNT);
    // `zips` is a new array every render; `updated` says when its contents changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, settled, updated]);
  const cards = useMemo(() => picks?.map((p) => p.card), [picks]);
  const banners = useFranchiseBanners(cards);
  return useMemo(() => {
    if (!picks || !banners) return { items: undefined as MetaPreview[] | undefined, cards: [] as Card[], parts: [] as (string | undefined)[] };
    const items = picks.map(({ card, zip }, i) => {
      const own = animePreview(card, zip, animeTitles);
      const b = banners[i];
      return b ? { ...own, name: b.name, background: b.background ?? own.background, logo: b.logo } : own;
    });
    return { items, cards: picks.map((p) => p.card), parts: banners.map((b) => b?.label) };
  }, [picks, banners, animeTitles]);
}

function AnimeHeroContent({ card, item, part }: { card: Card; item: MetaPreview; part?: string }) {
  const open = useOpenAnime(card);
  const { animeCardCountdown } = usePrefs();
  const next = animeCardCountdown ? card.nextAiringEpisode : undefined;
  return (
    <div className="hero-content">
      <TitleHeading name={item.name} logo={item.logo} backdrop={item.background} look="hero" />
      {/* The franchise's logo above: which of its parts is trending (#325). */}
      {part && <p className="hero-part t-caption">{part}</p>}
      <p className="hero-kind t-callout tabular">
        {joinFacts([card.format && FORMAT_LABEL[card.format], ...(card.genres ?? []).slice(0, 2), next && `Episode ${next.episode} in ${countdown(untilAiring(next.airingAt))}`])}
      </p>
      <p className="hero-description t-body">{item.description}</p>
      <div className="hero-actions">
        <Button variant="primary" {...open}>
          <Play size={18} fill="currentColor" /> Watch Now
        </Button>
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

function AnimeShelf({
  title,
  shape,
  items,
  label,
  action,
  onOpen,
}: {
  title: string;
  shape: Shape;
  items?: Card[];
  label?: (a: Card) => string | undefined;
  action?: ReactNode;
  onOpen?: () => void;
}) {
  const C = shape === "landscape" ? AnimeLandscapeCard : AnimeCard;
  const note = useWaitNote(!items);
  return (
    <Shelf
      title={title}
      onOpen={onOpen}
      shape={shape}
      action={note ?? action}
      items={items && forShape(items, shape)}
      card={(a) => <C key={a.id} item={a} label={label?.(a)} />}
    />
  );
}

/** A shelf still waiting its turn behind AniList's limit says so, rather than showing placeholders for a minute (#109). */
function useWaitNote(loading: boolean) {
  const busy = useAniListBusy();
  return loading && busy ? <span className="row-note t-caption">AniList is busy, loading…</span> : undefined;
}

/**
 * Genre shelves below the fold only ask AniList once they're close; while waiting their turn, one on
 * screen goes before one just below it, and one scrolled far away waits behind both (#109).
 */
function GenreShelf({ genre, shape, action }: { genre: string; shape: Shape; action?: ReactNode }) {
  const [ref, near, place] = useViewportPlace<HTMLDivElement>(reprioritiseAniList);
  const priority = useCallback(() => rowPriority(place.current), [place]);
  const { data } = useAnimeGenre(genre, near, priority);
  const { navigate } = useRouter();
  return (
    <div ref={ref}>
      <AnimeShelf
        title={genre}
        shape={shape}
        items={data}
        action={action}
        onOpen={() => navigate({ name: "anime-browse", genre, sort: "TRENDING_DESC" })}
      />
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

export function AnimeBrowse() {
  const { current } = useRouter();
  const from = current.name === "anime-browse" ? current : undefined;
  const { name: _, title, ...filters } = from ?? { name: "anime-browse" };
  return (
    <SubPage title={title ?? from?.genre ?? from?.tag ?? "Browse Anime"}>
      <BrowseView from={filters} />
    </SubPage>
  );
}

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
      <div className="anime-days" role="radiogroup" aria-label="Day">
        {days.map((d, i) => (
          <button key={i} role="radio" className="anime-day" aria-checked={i === day} onClick={() => setDay(i)}>
            <span className="anime-day-name">{i === 1 ? "Today" : i === 0 ? "Yesterday" : i === 2 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" })}</span>
            <span className="anime-day-date tabular">{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          </button>
        ))}
      </div>
      {isError && <EmptyState>Couldn't load the schedule from AniList.</EmptyState>}
      {isLoading && (
        <div className="anime-slots">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="anime-slot" height={88} />
          ))}
        </div>
      )}
      {data && !slots.length && <EmptyState>Nothing airs this day.</EmptyState>}
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

const NO_FILTERS = { genre: "", tag: "", season: "", year: 0, format: "", status: "" } as const;

/** `from`: the filters it opens with (a genre chip, a shelf's heading). */
function BrowseView({ from }: { from: Partial<BrowseFilters> }) {
  const [text, setText] = useState("");
  const [f, setF] = useState<BrowseFilters>(() => ({ ...NO_FILTERS, search: "", sort: "POPULARITY_DESC", ...from }));
  useEffect(() => {
    const t = window.setTimeout(() => setF((f) => ({ ...f, search: text.trim() })), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const set = (patch: Partial<BrowseFilters>) => setF((f) => ({ ...f, ...patch }));
  const q = useAnimeBrowse(f);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear + 2 - 1970 }, (_, i) => thisYear + 1 - i);
  const seen = new Set<number>();
  const listed = (q.data?.pages.flatMap((p) => p.media) ?? []).filter((m) => !seen.has(m.id) && seen.add(m.id));
  const shown = useCardsShown();
  const items = shown(listed);
  const [panel, setPanel] = useState(false);
  // What's narrowing the list, each with a way to take it off again.
  type Active = { label: string; clear: Partial<BrowseFilters> };
  const active = [
    f.genre ? { label: f.genre, clear: { genre: "" } } : null,
    f.tag ? { label: f.tag, clear: { tag: "" } } : null,
    f.year ? { label: String(f.year), clear: { year: 0 } } : null,
    f.season ? { label: SEASON_LABEL[f.season], clear: { season: "" } } : null,
    f.format ? { label: FORMAT_LABEL[f.format], clear: { format: "" } } : null,
    f.status ? { label: STATUS_LABEL[f.status], clear: { status: "" } } : null,
  ].filter(Boolean) as Active[];

  return (
    <div className="anime-browse">
      <div className="anime-filters">
        <SearchField className="anime-search" value={text} onChange={setText} label="Search anime" placeholder="Search anime" />
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
          <FilterField label="Kind">
            <Dropdown label="Kind" value={f.tag || "any"} onChange={(v) => set({ tag: v === "any" ? "" : v })} options={[{ value: "any", label: "Any" }, ...ANIME_TAGS.map((t) => ({ value: t, label: t }))]} />
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
            <button className="anime-row-link anime-clear" onClick={() => set(NO_FILTERS)}>
              Clear all
            </button>
          )}
        </div>
      </Sheet>
      {active.length > 0 && (
        <div className="anime-active-filters">
          {active.map((a) => (
            <Chip key={a.label} variant="tag" pressed onClick={() => set(a.clear)} aria-label={`Remove ${a.label}`}>
              {a.label}
              <Close size={11} strokeWidth={2.5} />
            </Chip>
          ))}
          {active.length > 1 && (
            <button className="anime-row-link anime-clear" onClick={() => set(NO_FILTERS)}>
              Clear all
            </button>
          )}
        </div>
      )}
      <PosterGrid pager={q}>
        {items.map((a) => (
          <AnimeCard key={a.id} item={a} />
        ))}
      </PosterGrid>
      {q.data && !items.length && <EmptyState>Nothing matches. Try fewer filters.</EmptyState>}
      {q.isError && <EmptyState>AniList didn't answer. Try again in a minute.</EmptyState>}
    </div>
  );
}
