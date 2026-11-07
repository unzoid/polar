import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANIME_GENRES,
  fetchAnime,
  nextSeason,
  seasonOf,
  useAiringToday,
  useAnimeGenre,
  useAniListBusy,
  useAnimeHome,
  type Anime,
  type AnimeCard,
} from "../lib/anime";
import {
  animePreview,
  aniZipQuery,
  countdown,
  entryZip,
  imdbForAnime,
  isMature,
  knowsNothing,
  linkAnime,
  lineUpEntry,
  prequelOf,
  SEASON_LABEL,
  untilAiring,
  useAnimeScore,
  useAniZip,
  useFranchiseBanners,
  useLinkedImdb,
  useShelfVisible,
  withLinkedArt,
} from "../lib/anime";
import { cachedLookup } from "../lib/net";
import { usePrefs } from "../lib/settings";
import { useRouter } from "../lib/router";
import type { Shape } from "../lib/catalog";
import { playSound } from "./sounds";
import { TvBrowse, TvCard, TvRail, TvSkeletonRail, type RailRow } from "./TvRails";
import { useStage } from "./TvStage";
import { EmptyState } from "../components/ui/EmptyState";

/** Resting on a card this long fetches its widescreen art and logo; a held D-pad passes every card. */
const ART_AFTER_MS = 300;

const NO_SOURCE = "Not available from your sources yet";

/**
 * Anime on the 10-foot screen, built like TV Home: the stage on top, rails
 * below. A card opens the show's normal title page (the same seasons, sources
 * and history as everything else), through ani.zip's link to its IMDb id.
 */
export function TvAnime() {
  const { data, isError } = useAnimeHome();
  const visible = useShelfVisible();
  const today = useAiringToday(visible("today"));
  const now = seasonOf();
  const next = nextSeason(now);

  if (isError && !data) {
    return (
      <div className="tv-note">
        <h1 className="tv-heading">Anime</h1>
        <EmptyState variant="tv">AniList didn't answer. Give it a minute and come back.</EmptyState>
      </div>
    );
  }

  const rail = (id: Parameters<typeof visible>[0], title: string, shape: Shape, items?: AnimeCard[]): RailRow[] =>
    visible(id) ? [{ key: id, render: () => <TvAnimeRail title={title} items={items} shape={shape} /> }] : [];

  // Today's airings sit below the first shelves: mostly brand-new shows, often not playable yet.
  const todayRows: RailRow[] = [
    ...(visible("today") && !today.isError
      ? [
          {
            key: "today",
            render: () => (
              <TvAnimeRail
                title="Airing Today"
                shape="landscape"
                items={today.slots?.map((s) => s.media)}
                chip={(a) => {
                  const s = today.slots?.find((x) => x.media.id === a.id);
                  return s && `Episode ${s.episode} at ${new Date(s.airingAt * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
                }}
              />
            ),
          },
        ]
      : []),
  ];
  const lead = [
    ...rail("season", `Airing This ${SEASON_LABEL[now.season]}`, "poster", data?.season),
    ...(visible("trending") ? [{ key: "trending", render: () => <TvAnimeRail title="Trending Now" items={data?.trending} shape="poster" franchise /> }] : []),
  ];
  const rows: RailRow[] = [
    ...lead,
    ...todayRows,
    ...rail("upcoming", `Coming in ${SEASON_LABEL[next.season]} ${next.year}`, "poster", data?.upcoming),
    ...rail("top", "Highest Rated", "landscape", data?.top),
    ...rail("popular", "Most Popular", "poster", data?.popular),
    ...rail("movies", "Movies", "landscape", data?.movies),
    ...(visible("genres")
      ? ANIME_GENRES.map((g, i) => ({
          key: `genre/${g}`,
          render: (near: boolean) => <TvGenreRail genre={g} enabled={near} shape={i % 3 === 0 ? "landscape" : "poster"} />,
        }))
      : []),
  ];

  if (!rows.length) {
    return (
      <div className="tv-note">
        <h1 className="tv-heading">Anime</h1>
        <EmptyState variant="tv">Every shelf is turned off in Settings.</EmptyState>
      </div>
    );
  }
  return <TvBrowse rows={rows} />;
}

function TvGenreRail({ genre, enabled, shape }: { genre: string; enabled: boolean; shape: Shape }) {
  const { data } = useAnimeGenre(genre, enabled);
  return <TvAnimeRail title={genre} items={data} shape={shape} />;
}

export function TvAnimeRail({
  title,
  items,
  shape,
  chip,
  franchise = false,
}: {
  title: string;
  items?: AnimeCard[];
  shape: Shape;
  chip?: (a: AnimeCard) => string | undefined;
  /** The featured row: the stage shows each franchise's base title's art and logo, and names the trending part (#325). */
  franchise?: boolean;
}) {
  const { matureContent } = usePrefs();
  // Waiting its turn behind AniList's limit: said beside the title (#109).
  const busy = useAniListBusy();
  if (!items) return <TvSkeletonRail title={title} shape={shape} note={busy ? "AniList is busy, loading…" : undefined} />;
  // TV has no blur: the stage would show the art full-size the moment the
  // card has focus, so "blur" leaves it out here too.
  const kept = matureContent === "show" ? items : items.filter((a) => !isMature(a));
  if (!kept.length) return null;
  const banners = kept.filter((a) => a.bannerImage);
  const shown = shape === "landscape" && banners.length >= 6 ? banners : kept;
  return (
    <TvRail title={title}>
      {shown.map((a, i) => (
        <TvAnimeCard key={a.id} card={a} shape={shape} chip={chip?.(a)} eager={i === 0} franchise={franchise} />
      ))}
    </TvRail>
  );
}

function TvAnimeCard({ card, shape, chip, eager, franchise }: { card: AnimeCard; shape: Shape; chip?: string; eager: boolean; franchise: boolean }) {
  const { navigate } = useRouter();
  const qc = useQueryClient();
  const stage = useStage();
  const prefs = usePrefs();
  const score = useAnimeScore()(prefs.animeCardScores ? card.averageScore : undefined);
  // The first card of a rail can end up on the stage before anything has focus, so it asks right away.
  const [wanted, setWanted] = useState(eager);
  const { data: zip } = useAniZip(card.id, wanted);
  const [missing, setMissing] = useState(false);
  const focused = useRef(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The linked IMDb title's backdrop or poster first, opened or not (#34), the same for every season of a show (#27);
  // the entry's own art first with seasons as separate shows (#194).
  const imdb = useLinkedImdb(card.id);
  const separateArt = prefs.animeSeparateEntries;
  const { item, fallbacks } = useMemo(
    () => withLinkedArt(animePreview(card, zip, prefs.animeTitles), imdb, shape, separateArt),
    [card, zip, prefs.animeTitles, shape, imdb, separateArt],
  );
  // On the featured row with seasons grouped, the stage shows the franchise's base title's art and logo, as the page does, and
  // names the trending part (#325); nothing until they're known. The card itself keeps the entry's own poster and name.
  const grouped = franchise && !separateArt;
  const banners = useFranchiseBanners(useMemo(() => (grouped && wanted ? [card] : undefined), [grouped, wanted, card]));
  const banner = grouped ? (banners ? banners[0] : undefined) : null;
  const staged = useMemo(() => {
    if (banner === null) return item;
    if (!banner) return { ...item, background: undefined, logo: undefined };
    return { ...item, name: banner.name, background: banner.background ?? item.background, logo: banner.logo };
  }, [item, banner]);
  const next = prefs.animeCardCountdown ? card.nextAiringEpisode : undefined;
  const nextText = next && `Episode ${next.episode} in ${countdown(untilAiring(next.airingAt))}`;
  // What's on the card stays artwork; when it airs goes on the stage above.
  const kicker = missing ? NO_SOURCE : [banner?.label, score && `★ ${score}`, chip ?? nextText].filter(Boolean).join(" · ") || undefined;

  // The art and logo arrived, or the show turned out not to be playable, while you're on it.
  useEffect(() => {
    if (focused.current) stage({ item: staged, kicker });
  }, [staged, kicker, stage]);

  const open = async () => {
    const z = await qc.fetchQuery(aniZipQuery(card.id)).catch(() => null);
    // ani.zip's IMDb show, or the one that has this entry's episodes when that one stops short.
    let sure = true;
    const imdb = await imdbForAnime(card, z, cachedLookup(qc)).catch(() => {
      sure = false;
      return z?.mappings.imdb_id;
    });
    // As the desktop page does: the backend learns which id this entry plays from (only a looked-up answer).
    if (imdb && sure) void linkAnime(qc, { canonical: imdb, anilist: card.id, mal: card.idMal ?? z?.mappings.mal_id, kitsu: z?.mappings.kitsu_id });
    if (!imdb) {
      playSound("edge");
      setMissing(true);
      return;
    }
    // Seasons as separate shows (#22): the title's page with just this entry's episodes.
    const separate = prefs.animeSeparateEntries && item.type === "series";
    if (separate) await lineUpEntry(qc, card, z, imdb, prefs.animeTitles);
    navigate({ name: "detail", type: item.type, id: imdb, entry: separate ? card.id : undefined });
  };

  return (
    <TvCard
      item={item}
      shape={shape}
      artFallbacks={fallbacks}
      kicker={kicker}
      localOnly
      staged={staged}
      onOpen={() => void open()}
      onFocusChange={(f) => {
        focused.current = f;
        window.clearTimeout(timer.current);
        if (f) timer.current = window.setTimeout(() => setWanted(true), ART_AFTER_MS);
      }}
    />
  );
}

/** An anime link in TV mode (arriving from desktop mode, say): on to the show's title page. */
export function TvAnimeDetail({ id }: { id: number }) {
  const { replace } = useRouter();
  const qc = useQueryClient();
  const { animeSeparateEntries: separate, animeTitles } = usePrefs();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      let z = await qc.fetchQuery(aniZipQuery(id)).catch(() => null);
      // As on desktop: the IMDb show with this entry's episodes, else Kitsu.
      let sure = true;
      let mal = z?.mappings.mal_id;
      let anime: Anime | undefined;
      const imdb = await fetchAnime(id)
        .then(async (a) => {
          anime = a;
          mal = a.idMal ?? mal;
          // The second half of a split part ani.zip lists under its prequel (lib/anime/splitParts.ts).
          const prequel = prequelOf(a);
          if (knowsNothing(z) && prequel !== undefined) z = entryZip(a, z, await qc.fetchQuery(aniZipQuery(prequel)).catch(() => null)) ?? null;
          return imdbForAnime(a, z, cachedLookup(qc));
        })
        .catch(() => {
          sure = false;
          return z?.mappings.imdb_id;
        });
      const target = imdb ?? (z?.mappings.kitsu_id ? `kitsu:${z.mappings.kitsu_id}` : null);
      if (target && sure) void linkAnime(qc, { canonical: target, anilist: id, mal, kitsu: z?.mappings.kitsu_id });
      const movie = z?.mappings.type?.toLowerCase() === "movie";
      // Seasons as separate shows (#22): the title's page with just this entry's episodes.
      const entry = separate && !movie && anime && target ? anime : undefined;
      if (entry && target) await lineUpEntry(qc, entry, z, target, animeTitles);
      if (!live) return;
      if (target) replace({ name: "detail", type: movie ? "movie" : "series", id: target, entry: entry?.id });
      else setMissing(true);
    })();
    return () => {
      live = false;
    };
  }, [id, replace, qc, separate, animeTitles]);
  if (!missing) return null;
  return (
    <div className="tv-note">
      <h1 className="tv-heading">Anime</h1>
      <EmptyState variant="tv">{NO_SOURCE}. Press Back to return.</EmptyState>
    </div>
  );
}
