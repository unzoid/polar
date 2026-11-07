import type { Route } from "../router";
import type { Download } from "../library/downloads";
import type { News } from "./whatsNew";

/** One notification as the platform shows it (lib/platform/notifications.ts). */
export interface Note {
  /** Stable for what it's about: a newer note with the same id replaces the older one where the system can. */
  id: string;
  title: string;
  body: string;
  /** What a click opens. */
  route: Route;
}

/** More shows than this with news in one check: one note for all of them. */
export const MAX_SEPARATE = 3;

const code = (season: number, episode: number) => (season === 0 ? `Special ${episode}` : `S${season} E${episode}`);

/** "S2 E5" or "S2 E5–E7" (or "S2 E9 – S3 E1" across seasons). */
function span(news: News) {
  const first = news.videos[0];
  const last = news.videos[news.videos.length - 1];
  if (first === last) return code(first.season, first.episode);
  if (first.season === last.season && first.season !== 0) return `${code(first.season, first.episode)}–E${last.episode}`;
  return `${code(first.season, first.episode)} – ${code(last.season, last.episode)}`;
}

export function newsBody(news: News): string {
  const n = news.videos.length;
  if (news.kind === "season") {
    const inSeason = news.videos.filter((v) => v.season === news.season).length;
    return inSeason > 1 ? `Season ${news.season} is out: ${inSeason} episodes` : `Season ${news.season} is out`;
  }
  if (n === 1) {
    const v = news.videos[0];
    const title = v.title?.trim();
    return title && !/^episode \d+$/i.test(title) ? `${span(news)} · ${title} is out` : `${span(news)} is out`;
  }
  return `${n} new episodes: ${span(news)}`;
}

/** One note per show, or one for all when many arrive at once. */
export function newsNotes(all: readonly News[]): Note[] {
  if (all.length === 0) return [];
  if (all.length > MAX_SEPARATE) {
    const names = all.map((n) => n.show.name);
    return [
      {
        id: "news:many",
        title: `New episodes of ${all.length} shows`,
        body: `${names.slice(0, 2).join(", ")} and ${all.length - 2} more`,
        route: { name: "library" },
      },
    ];
  }
  return all.map((news) => ({
    id: `news:${news.show.id}`,
    title: news.show.name,
    body: newsBody(news),
    route: { name: "detail", type: news.show.type, id: news.show.id },
  }));
}

/** Downloads that finished or failed between two looks at the list (one that was never seen moving isn't news). */
export function downloadNotes(before: readonly Download[], after: readonly Download[]): Note[] {
  const was = new Map(before.map((d) => [d.id, d.state]));
  const out: Note[] = [];
  for (const d of after) {
    if (was.get(d.id) !== "downloading" || (d.state !== "done" && d.state !== "failed")) continue;
    const what = d.season != null && d.episode != null ? `${d.name} · ${code(d.season, d.episode)}` : d.name;
    out.push({
      id: `download:${d.id}`,
      title: d.state === "done" ? "Download finished" : "Download failed",
      body: what,
      route: d.state === "done" ? { name: "detail", type: d.type, id: d.metaId } : { name: "library-collection", view: "downloads" },
    });
  }
  return out;
}
