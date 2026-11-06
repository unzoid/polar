import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { pickAnimeImdb, type AnimeCard } from "../../lib/anime";
import { useSearch } from "../../lib/net";
import { Img } from "../Img";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "../ui/Popover";
import { SearchField } from "../ui/SearchField";

/**
 * Pick the series (or film) an anime plays from by hand (#189): when nothing
 * links it, or the title search linked the wrong one. Searches the catalogs
 * with the entry's name to start with; the pick is stored as the entry's link,
 * so it's the one it plays from from then on, on every device.
 */
export function AnimeSeriesPick({ anime, isMovie, current, mal, kitsu }: { anime: AnimeCard; isMovie: boolean; current?: string; mal?: number; kitsu?: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(anime.title.english || anime.title.romaji || "");
  const { data, isFetching, isError } = useSearch(open ? query : "");
  const qc = useQueryClient();
  const kind = isMovie ? "film" : "series";
  const results = (isMovie ? data?.movies : data?.series)?.filter((m) => m.id.startsWith("tt")) ?? [];

  const pick = (id: string) => {
    setOpen(false);
    void pickAnimeImdb(qc, { canonical: id, anilist: anime.id, mal, kitsu });
  };

  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="anime-pick-trigger">{current ? `Wrong ${kind}?` : `Choose the ${kind}`}</PopoverTrigger>
      <PopoverPopup sideOffset={8} align="start" collisionPadding={12} className="playlist-menu anime-pick" aria-label={`Choose the ${kind}`}>
        <p className="playlist-menu-title">Which {kind} is this?</p>
        <SearchField value={query} onChange={setQuery} label={`Search for the ${kind}`} look="mini" autoFocus />
        <div className="playlist-menu-list anime-pick-list" aria-busy={isFetching || undefined}>
          {results.map((m) => (
            <button key={m.id} className="playlist-menu-item anime-pick-item" aria-current={m.id === current || undefined} onClick={() => pick(m.id)}>
              {m.poster ? <Img src={m.poster} alt="" className="anime-pick-poster" /> : <span className="anime-pick-poster" />}
              <span className="anime-pick-name">{m.name}</span>
              {m.releaseInfo && <span className="anime-pick-year tabular">{m.releaseInfo}</span>}
            </button>
          ))}
          {!isFetching && query.trim() && !results.length && (
            <p className="anime-pick-note t-caption">{isError ? "The search didn't work. Check your connection and try again." : `No ${kind} by that name in your catalogs.`}</p>
          )}
        </div>
      </PopoverPopup>
    </PopoverRoot>
  );
}
