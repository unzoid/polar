import type { Anime } from "../../lib/anime/anilist";
import { cleanDescription, FORMAT_LABEL, fuzzyDate, SEASON_LABEL, SOURCE_LABEL, STATUS_LABEL, useAnimeTitle } from "../../lib/anime/format";
import { api } from "../../lib/api";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { DetailsColumns, DetailsLinks, DetailsSection } from "../title/TitleDetails";
import { Badge, Chip } from "../ui/Chip";

/**
 * An anime's details, from AniList, built from the same parts as a title's
 * (TitleDetails): its rankings, then the story, tags and links down the left
 * with the facts beside them.
 */
export function AnimeDetails({ anime }: { anime: Anime }) {
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
    [
      "Also known as",
      [anime.title.romaji, anime.title.english, anime.title.native, ...(anime.synonyms ?? [])]
        .filter((t) => t && t !== title(anime.title))
        .slice(0, 4)
        .join(" · ") || undefined,
    ],
  ];

  return (
    <section className="about anime-about">
      <div className="details">
        {rankings.length > 0 && (
          <div className="anime-rankings">
            {rankings.map((r) => (
              <Badge key={`${r.type}/${r.context}/${r.year}/${r.season}`} variant="rank" className="tabular">
                <strong>#{r.rank}</strong> {r.context.replace(/^\w/, (c) => c.toUpperCase())}
                {!r.allTime && r.year ? ` ${r.season ? `${SEASON_LABEL[r.season]} ` : ""}${r.year}` : ""}
              </Badge>
            ))}
          </div>
        )}
        {/* Story, tags and links down the left; the facts beside them, so neither column leaves a hole. */}
        <DetailsColumns facts={facts}>
          <div className="anime-about-main">
            <DetailsSection as="div" label="Story">
              {paragraphs.map((p, i) => (
                <p key={i} className="details-story">
                  {p}
                </p>
              ))}
            </DetailsSection>
            {tags.length > 0 && (
              <DetailsSection label="Tags">
                <div className="anime-tags">
                  {tags.map((t) => (
                    <Badge key={t.name} variant="tag" data-spoiler={t.isMediaSpoiler || t.isGeneralSpoiler} title={t.description ?? undefined}>
                      {t.name} <span className="tabular">{t.rank}%</span>
                    </Badge>
                  ))}
                  {spoilers > 0 && (
                    <button className="settings-link anime-spoilers" onClick={() => setPrefs({ animeSpoilerTags: !prefs.animeSpoilerTags })}>
                      {prefs.animeSpoilerTags ? "Hide spoiler tags" : `Show ${spoilers} spoiler tag${spoilers === 1 ? "" : "s"}`}
                    </button>
                  )}
                </div>
              </DetailsSection>
            )}

            {streaming.length > 0 && (
              <DetailsLinks label="Watch Officially">
                {streaming.map((l) => (
                  <Chip
                    key={l.url}
                    variant="link"
                    style={{ "--site": l.color ?? "#ffffff" } as React.CSSProperties}
                    onClick={() => void api.openExternal(l.url)}
                  >
                    {l.icon && <img src={l.icon} alt="" className="anime-link-icon" />}
                    {l.site}
                    {l.language && l.language !== "English" ? <span className="muted"> · {l.language}</span> : null}
                  </Chip>
                ))}
              </DetailsLinks>
            )}

            <DetailsLinks label="Elsewhere">
              <Chip
                variant="link"
                style={{ "--site": "#02a9ff" } as React.CSSProperties}
                onClick={() => void api.openExternal(`https://anilist.co/anime/${anime.id}`)}
              >
                AniList
              </Chip>
              {anime.idMal && (
                <Chip
                  variant="link"
                  style={{ "--site": "#2e51a2" } as React.CSSProperties}
                  onClick={() => void api.openExternal(`https://myanimelist.net/anime/${anime.idMal}`)}
                >
                  MyAnimeList
                </Chip>
              )}
            </DetailsLinks>
          </div>
        </DetailsColumns>
      </div>
    </section>
  );
}
