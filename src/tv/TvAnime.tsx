import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANIME_GENRES,
  nextSeason,
  seasonOf,
  useAiringToday,
  useAnimeGenre,
  useAnimeHome,
  type AnimeCard,
} from "../lib/anime/anilist";
import { aniZipQuery, fetchAniZip, useAniZip } from "../lib/anime/anizip";
import { countdown, SEASON_LABEL, untilAiring, useAnimeScore } from "../lib/anime/format";
import { animePreview } from "../lib/anime/preview";
import { useShelfVisible } from "../lib/anime/shelves";
import { usePrefs } from "../lib/prefs";
import { useRouter } from "../lib/router";
import type { Shape } from "../lib/shelves";
import { playSound } from "./sounds";
import { TvBrowse, TvCard, TvRail, TvSkeletonRail, type RailRow } from "./TvRails";
import { useStage } from "./TvStage";

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
        <p className="tv-empty">AniList didn't answer. Give it a minute and come back.</p>
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
    ...rail("trending", "Trending Now", "poster", data?.trending),
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
        <p className="tv-empty">Every shelf is turned off in Settings.</p>
      </div>
    );
  }
  return <TvBrowse rows={rows} />;
}

function TvGenreRail({ genre, enabled, shape }: { genre: string; enabled: boolean; shape: Shape }) {
  const { data } = useAnimeGenre(genre, enabled);
  return <TvAnimeRail title={genre} items={data} shape={shape} />;
}

function TvAnimeRail({
  title,
  items,
  shape,
  chip,
}: {
  title: string;
  items?: AnimeCard[];
  shape: Shape;
  chip?: (a: AnimeCard) => string | undefined;
}) {
  if (!items) return <TvSkeletonRail title={title} shape={shape} />;
  if (!items.length) return null;
  const banners = items.filter((a) => a.bannerImage);
  const shown = shape === "landscape" && banners.length >= 6 ? banners : items;
  return (
    <TvRail title={title}>
      {shown.map((a, i) => (
        <TvAnimeCard key={a.id} card={a} shape={shape} chip={chip?.(a)} eager={i === 0} />
      ))}
    </TvRail>
  );
}

function TvAnimeCard({ card, shape, chip, eager }: { card: AnimeCard; shape: Shape; chip?: string; eager: boolean }) {
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

  const item = useMemo(() => animePreview(card, zip, prefs.animeTitles), [card, zip, prefs.animeTitles]);
  const next = prefs.animeCardCountdown ? card.nextAiringEpisode : undefined;
  const nextText = next && `Episode ${next.episode} in ${countdown(untilAiring(next.airingAt))}`;
  // What's on the card stays artwork; when it airs goes on the stage above.
  const kicker = missing ? NO_SOURCE : [score && `★ ${score}`, chip ?? nextText].filter(Boolean).join(" · ") || undefined;

  // The art and logo arrived, or the show turned out not to be playable, while you're on it.
  useEffect(() => {
    if (focused.current) stage({ item, kicker });
  }, [item, kicker, stage]);

  const open = async () => {
    const z = await qc.fetchQuery(aniZipQuery(card.id)).catch(() => null);
    const imdb = z?.mappings.imdb_id;
    if (!imdb) {
      playSound("edge");
      setMissing(true);
      return;
    }
    navigate({ name: "detail", type: item.type, id: imdb });
  };

  return (
    <TvCard
      item={item}
      shape={shape}
      kicker={kicker}
      localOnly
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
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchAniZip({ anilist_id: id })
      .catch(() => null)
      .then((z) => {
        if (!live) return;
        const imdb = z?.mappings.imdb_id;
        if (imdb) replace({ name: "detail", type: z.mappings.type?.toLowerCase() === "movie" ? "movie" : "series", id: imdb });
        else setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [id, replace]);
  if (!missing) return null;
  return (
    <div className="tv-note">
      <h1 className="tv-heading">Anime</h1>
      <p className="tv-empty">{NO_SOURCE}. Press Back to return.</p>
    </div>
  );
}
