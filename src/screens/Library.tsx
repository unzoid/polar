import { useMemo, useState, type ReactNode } from "react";
import { Dropdown } from "../components/Dropdown";
import { ConfirmDeleteButton } from "../components/ConfirmDeleteButton";
import { DownloadButton, DownloadGlyph } from "../components/DownloadButton";
import { Bookmark, ChevronLeft, ChevronRight, Close, Download, PlaylistIcon, Play, Plus, Watched } from "../components/icons";
import { Img } from "../components/Img";
import { PlaylistTile, usePlaylistItem } from "../components/Playlists";
import { PosterCard } from "../components/PosterCard";
import { Card, ProgressBar } from "../components/title/Card";
import { errorMessage } from "../lib/errors";
import { formatRemaining } from "../lib/format";
import { watchedFraction } from "../lib/library";
import { fileKind, fileTitle, forgetRecent, playRecent, useRecentFiles, type RecentFile } from "../lib/localFiles";
import { Row } from "../components/Row";
import { StillPlaceholder } from "../components/StillPlaceholder";
import { downloadFraction, localStream, useAllLeaving, useDownloads, useLeaving, type Download as DownloadRecord } from "../lib/library";
import { TitleLogo } from "../components/TitleLogo";
import { episodeCode, formatBytes } from "../lib/format";
import {
  createPlaylist,
  MAX_PLAYLISTS,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
  usePlaylists,
  type PlaylistItem,
} from "../lib/library";
import { useLibrary, useWatchHistory } from "../lib/net";
import { useRouter, type Route } from "../lib/router";
import { progressFraction, progressItem } from "../lib/catalog";
import type { ContentType } from "../lib/types";
import { buttonClass } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { PosterGrid } from "../components/title/PosterGrid";

type Collection = Extract<Route, { name: "library-collection" }>["view"];
type Open = { view: Collection } | { view: "playlist"; id: string; fresh: boolean };
type Kind = "all" | ContentType;
type Sort = "recent" | "title";

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Shows" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "title", label: "Title" },
];

/**
 * Your titles, nothing suggested. Laid out like Apple Music's library: the
 * collections up top as big tiles (Saved, Playlists, Downloads, Watched),
 * each with its count, then a shelf of the latest from each. A tile or "See
 * All" opens the whole collection (route `library-collection`); a playlist
 * opens from there (route `playlist`), so Esc and Back step out one page at a time.
 */
export function Library() {
  const open = useOpen();
  return (
    <div className="scroll">
      <Overview onOpen={open} />
    </div>
  );
}

/** Library's sub-pages go on the navigation stack, like Anime's. */
function useOpen() {
  const { navigate } = useRouter();
  return (o: Open) => navigate(o.view === "playlist" ? { name: "playlist", id: o.id, fresh: o.fresh } : { name: "library-collection", view: o.view });
}

/** One collection in full. */
export function LibraryCollection({ view }: { view: Collection }) {
  const { back } = useRouter();
  const open = useOpen();
  return (
    <div className="scroll">
      {view === "saved" && (
        <CollectionPage title="Saved" onBack={back} filters>
          {(kind, sort) => <Saved kind={kind} sort={sort} />}
        </CollectionPage>
      )}
      {view === "watched" && (
        <CollectionPage title="Watched" onBack={back} filters>
          {(kind, sort) => <WatchedGrid kind={kind} sort={sort} />}
        </CollectionPage>
      )}
      {view === "playlists" && (
        <CollectionPage title="Playlists" onBack={back}>
          {() => <Playlists onOpen={(id, fresh = false) => open({ view: "playlist", id, fresh })} />}
        </CollectionPage>
      )}
      {view === "downloads" && (
        <CollectionPage title="Downloads" onBack={back}>
          {() => <Downloads />}
        </CollectionPage>
      )}
    </div>
  );
}

/** One playlist; its back button names the page it came from. */
export function LibraryPlaylist({ id, fresh }: { id: string; fresh: boolean }) {
  const { back, stack } = useRouter();
  // Where it was opened from (pages pushed on top later don't change it).
  const [backLabel] = useState(() => (stack[stack.length - 2]?.route.name === "library-collection" ? "Playlists" : "Library"));
  return (
    <div className="scroll">
      <PlaylistView id={id} fresh={fresh} onClose={back} backLabel={backLabel} />
    </div>
  );
}

// --- Overview --------------------------------------------------------------------------------

function Overview({ onOpen }: { onOpen: (o: Open) => void }) {
  const { data: saved } = useLibrary();
  const { data: history } = useWatchHistory();
  const watching = useWatching();
  const { data: downloads } = useDownloads();
  const playlists = usePlaylists();
  const dl = downloads ?? [];
  const finished = dl.filter((d) => d.state === "done");
  const moving = dl.length - finished.length;
  const bytes = finished.reduce((n, d) => n + (d.total ?? d.received), 0);
  const seeAll = (view: Collection) => (
    <button className="library-see-all t-callout" onClick={() => onOpen({ view })}>
      See All <ChevronRight size={14} strokeWidth={2.25} />
    </button>
  );
  const { data: recentFiles = [] } = useRecentFiles();
  const nothing = saved?.length === 0 && history?.length === 0 && playlists.length === 0 && dl.length === 0 && !recentFiles.length;

  return (
    <>
      <header className="screen-header">
        <h1 className="t-title1">Library</h1>
      </header>
      <div className="library-collections">
        <CollectionTile
          icon={<Bookmark size={22} />}
          title="Saved"
          detail={count(saved?.length, "title")}
          art={saved?.[0]?.poster}
          onOpen={() => onOpen({ view: "saved" })}
        />
        <CollectionTile
          icon={<PlaylistIcon size={22} />}
          title="Playlists"
          detail={count(playlists.length, "playlist")}
          art={playlists.find((p) => p.items.length)?.items[0]?.poster}
          onOpen={() => onOpen({ view: "playlists" })}
        />
        <CollectionTile
          icon={<Download size={22} />}
          title="Downloads"
          detail={moving ? `${moving} downloading` : finished.length ? `${count(finished.length, "video")} · ${formatBytes(bytes)}` : "None yet"}
          art={dl[0]?.background ?? dl[0]?.poster}
          onOpen={() => onOpen({ view: "downloads" })}
        />
        <CollectionTile
          icon={<Watched size={22} />}
          title="Watched"
          detail={count(history?.length, "title")}
          art={history?.[0]?.background ?? history?.[0]?.poster}
          onOpen={() => onOpen({ view: "watched" })}
        />
      </div>

      {nothing && <EmptyState>Titles you save, download, watch or put in a playlist gather here.</EmptyState>}

      <div className="rows library-rows">
        {recentFiles.length > 0 && (
          <Row title="Recent Files" shape="landscape">
            {recentFiles.map((f) => (
              <RecentFileCard key={f.path} file={f} />
            ))}
          </Row>
        )}
        {dl.length > 0 && (
          <Row title="Downloads" shape="landscape" action={seeAll("downloads")}>
            {dl.slice(0, 16).map((d) => (
              <DownloadCard key={d.id} d={d} onOpen={() => onOpen({ view: "downloads" })} />
            ))}
          </Row>
        )}
        {!!saved?.length && (
          <Row title="Recently Saved" action={seeAll("saved")}>
            {saved.slice(0, 20).map((item) => (
              <PosterCard key={item.id} item={item} watching={watching.get(item.id)} />
            ))}
          </Row>
        )}
        {playlists.length > 0 && (
          <Row title="Playlists" action={seeAll("playlists")}>
            {playlists.map((p) => (
              <PlaylistTile key={p.id} playlist={p} onOpen={() => onOpen({ view: "playlist", id: p.id, fresh: false })} />
            ))}
          </Row>
        )}
        {!!history?.length && (
          <Row title="Recently Watched" action={seeAll("watched")}>
            {history.slice(0, 20).map((p) => (
              <PosterCard key={p.metaId} item={progressItem(p)} progress={progressFraction(p)} entry={p} />
            ))}
          </Row>
        )}
      </div>
    </>
  );
}

const count = (n: number | undefined, noun: string) => (n == null ? "" : n === 0 ? "None yet" : `${n} ${noun}${n === 1 ? "" : "s"}`);

/** A collection as a big tile: its latest art washed out behind an icon, the name and a count. */
function CollectionTile({ icon, title, detail, art, onOpen }: { icon: ReactNode; title: string; detail: string; art?: string; onOpen: () => void }) {
  return (
    <button className="library-tile pressable" onClick={onOpen}>
      {art && <Img src={art} alt="" className="library-tile-art" />}
      <span className="library-tile-icon">{icon}</span>
      <span className="library-tile-text">
        <span className="library-tile-title">{title}</span>
        <span className="library-tile-detail tabular">{detail}</span>
      </span>
      <ChevronRight size={18} className="library-tile-chevron" />
    </button>
  );
}

/** One download on the overview's shelf: plays when it's here, else opens Downloads. */
function DownloadCard({ d, onOpen }: { d: DownloadRecord; onOpen: () => void }) {
  const play = usePlayDownload();
  const leaving = useLeaving(d.id);
  return (
    <Card
      shape="landscape"
      className="download-card"
      art={d.thumbnail ?? d.background ?? d.poster}
      fallback={<StillPlaceholder />}
      title={d.name}
      detail={downloadLine(d)}
      data-leaving={leaving || undefined}
      onClick={() => (d.state === "done" ? play(d) : onOpen())}
    >
      <div className="card-art-scrim" />
      <span className="download-card-state" data-state={d.state}>
        {d.state === "done" ? <Play size={14} fill="currentColor" /> : <DownloadGlyph d={d} size={18} />}
      </span>
    </Card>
  );
}

/**
 * A video file opened on this device (#204), kept here and never synced: plays from where it stopped,
 * with its folder's other videos as episodes. One that's gone says so; × takes it off the list.
 */
function RecentFileCard({ file }: { file: RecentFile }) {
  const { navigate } = useRouter();
  const [gone, setGone] = useState<string | null>(null);
  const fraction = file.duration > 0 ? file.position / file.duration : 0;
  const watched = fraction >= watchedFraction();
  const detail = gone ?? [formatBytes(file.size), watched ? "Watched" : fraction > 0.01 ? formatRemaining(file.position, file.duration) : ""].filter(Boolean).join(" · ");
  const open = () =>
    void playRecent(file.path).then(
      (route) => route && navigate(route),
      (e) => setGone(errorMessage(e)),
    );
  return (
    <Card
      shape="landscape"
      className="recent-file-card"
      fallback={<StillPlaceholder />}
      title={fileTitle(file.name)}
      detail={detail}
      hint={file.name}
      onClick={open}
      actions={
        <button
          type="button"
          className="recent-file-forget"
          aria-label={`Remove ${file.name} from Recent Files`}
          onClick={(e) => {
            e.stopPropagation();
            void forgetRecent(file.path);
          }}
        >
          <Close size={16} />
        </button>
      }
    >
      <span className="recent-file-kind">{fileKind(file.name)}</span>
      {!gone && !watched && fraction > 0.01 && <ProgressBar fraction={fraction} />}
    </Card>
  );
}

function usePlayDownload() {
  const { navigate } = useRouter();
  return (d: DownloadRecord) => navigate({ name: "player", type: d.type, metaId: d.metaId, videoId: d.id, stream: localStream(d) });
}

/** "S1 E3 · 1080p · 2.4 GB", or how far along it is. */
function downloadLine(d: DownloadRecord) {
  const ep = d.season != null && d.episode != null ? episodeCode(d.season, d.episode) : null;
  const f = downloadFraction(d);
  const status =
    d.state === "done"
      ? formatBytes(d.total ?? d.received)
      : d.state === "failed"
        ? "Failed"
        : `${d.state === "paused" ? "Paused" : "Downloading"}${f != null ? ` · ${Math.round(f * 100)}%` : ""}`;
  return [ep, d.quality, status].filter(Boolean).join(" · ");
}

// --- A whole collection ----------------------------------------------------------------------

function CollectionPage({
  title,
  onBack,
  filters = false,
  children,
}: {
  title: string;
  onBack: () => void;
  filters?: boolean;
  children: (kind: Kind, sort: Sort) => ReactNode;
}) {
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("recent");
  return (
    <>
      <header className="screen-header library-page-header">
        <div className="library-page-title">
          <button className="playlist-back t-callout" onClick={onBack}>
            <ChevronLeft size={16} strokeWidth={2.25} />
            Library
          </button>
          <h1 className="t-title1">{title}</h1>
        </div>
        {filters && (
          <div className="library-toolbar">
            <Dropdown label="Show" value={kind} onChange={setKind} options={KINDS} />
            <Dropdown label="Sort by" value={sort} onChange={setSort} options={SORTS} />
          </div>
        )}
      </header>
      {children(kind, sort)}
    </>
  );
}

function arrange<T extends { type: ContentType; name: string }>(items: T[] | undefined, kind: Kind, sort: Sort) {
  if (!items) return undefined;
  const shown = kind === "all" ? items : items.filter((i) => i.type === kind);
  return sort === "title" ? [...shown].sort((a, b) => a.name.localeCompare(b.name)) : shown;
}

/** Title id → the episode last watched, for saved anime shown by their entry with seasons as separate shows (#22). */
function useWatching(): ReadonlyMap<string, string> {
  const { data } = useWatchHistory();
  return useMemo(() => new Map((data ?? []).map((p) => [p.metaId, p.videoId])), [data]);
}

function Saved({ kind, sort }: { kind: Kind; sort: Sort }) {
  const { data } = useLibrary();
  const watching = useWatching();
  const items = useMemo(() => arrange(data, kind, sort), [data, kind, sort]);
  if (data?.length === 0) return <EmptyState>Titles you save with + on their page appear here.</EmptyState>;
  return (
    <>
      {items?.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
      <PosterGrid>
        {items?.map((item) => (
          <PosterCard key={item.id} item={item} watching={watching.get(item.id)} />
        ))}
      </PosterGrid>
    </>
  );
}

function WatchedGrid({ kind, sort }: { kind: Kind; sort: Sort }) {
  const { data } = useWatchHistory();
  const items = useMemo(() => arrange(data, kind, sort), [data, kind, sort]);
  if (data?.length === 0) return <EmptyState>Movies and shows you watch appear here.</EmptyState>;
  return (
    <>
      {items?.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
      <PosterGrid>
        {items?.map((p) => (
          <PosterCard key={p.metaId} item={progressItem(p)} progress={progressFraction(p)} entry={p} />
        ))}
      </PosterGrid>
    </>
  );
}

/**
 * Downloads, grouped by title as Netflix does: the poster and how much of it
 * is here, then a row per movie or episode - tap the still to play, the
 * control on the right to pause, resume or delete.
 */
function Downloads() {
  const { data } = useDownloads();
  const play = usePlayDownload();
  const groups = useMemo(() => {
    const m = new Map<string, DownloadRecord[]>();
    for (const d of data ?? []) m.set(d.metaId, [...(m.get(d.metaId) ?? []), d]);
    for (const list of m.values()) list.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
    return [...m.values()];
  }, [data]);

  if (data?.length === 0) {
    return (
      <EmptyState>
        Download a movie or an episode with <Download size={15} className="inline-icon" /> on its page to watch it without a connection.
      </EmptyState>
    );
  }
  return (
    <div className="downloads">
      {groups.map((list) => (
        <DownloadGroup key={list[0].metaId} list={list} play={play} />
      ))}
    </div>
  );
}

/** One title: its logo (or name) and how much of it is here, then its rows. Folds away with its last row. */
function DownloadGroup({ list, play }: { list: DownloadRecord[]; play: (d: DownloadRecord) => void }) {
  const first = list[0];
  const here = list.filter((d) => d.state === "done");
  const bytes = here.reduce((n, d) => n + (d.total ?? d.received), 0);
  const series = first.type === "series";
  const allLeaving = useAllLeaving(list.map((d) => d.id));
  return (
    <section className="download-group" data-leaving={allLeaving || undefined}>
      <div className="download-group-fold">
        <div className="download-group-head">
          {first.logo ? (
            <TitleLogo src={first.logo} alt={first.name} className="download-group-logo" />
          ) : (
            <h2 className="download-group-title">{first.name}</h2>
          )}
          <p className="t-caption faint tabular">
            {[series ? count(list.length, "episode") : "Movie", here.length ? formatBytes(bytes) : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ul className="download-rows">
          {list.map((d) => (
            <DownloadRow key={d.id} d={d} series={series} play={play} />
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * A movie or an episode. Deleting it folds the row shut (height via a
 * 1fr → 0fr grid row, with a fade and a slight drop in scale) before it
 * leaves the list, so the rows below slide up instead of jumping.
 */
function DownloadRow({ d, series, play }: { d: DownloadRecord; series: boolean; play: (d: DownloadRecord) => void }) {
  const leaving = useLeaving(d.id);
  return (
    <li className="download-row" data-state={d.state} data-leaving={leaving || undefined}>
      <div className="download-row-fold">
        <div className="download-row-inner">
                  <button className="download-row-main" disabled={d.state !== "done"} onClick={() => play(d)}>
                    <span className="download-row-still">
                      {d.thumbnail ?? d.background ? <Img src={(d.thumbnail ?? d.background)!} alt="" /> : <StillPlaceholder />}
                      {d.state === "done" && (
                        <span className="download-row-play">
                          <Play size={16} fill="currentColor" />
                        </span>
                      )}
                      {d.state !== "done" && downloadFraction(d) != null && (
                        <span className="progress-track">
                          <span className="progress-fill" style={{ transform: `scaleX(${downloadFraction(d)})` }} />
                        </span>
                      )}
                    </span>
                    <span className="download-row-text">
                      <span className="t-headline">
                        {series && d.episode != null ? `${d.episode}. ${d.episodeTitle ?? `Episode ${d.episode}`}` : d.name}
                      </span>
                      <span className="t-caption faint tabular">{downloadLine(d)}</span>
                      {d.state === "failed" && d.error && <span className="t-caption download-row-error">{d.error}</span>}
                    </span>
                  </button>
                  <DownloadButton
                    item={{ id: d.metaId, type: d.type, name: d.name, poster: d.poster, background: d.background, logo: d.logo }}
                    video={
                      series
                        ? { id: d.id, title: d.episodeTitle ?? "", season: d.season ?? 0, episode: d.episode ?? 0, thumbnail: d.thumbnail }
                        : undefined
                    }
                    className={buttonClass("plain", true, "download-row-action quiet-btn")}
                    size={18}
                  />
        </div>
      </div>
    </li>
  );
}

// --- Playlists -------------------------------------------------------------------------------

function Playlists({ onOpen }: { onOpen: (id: string, isNew?: boolean) => void }) {
  const playlists = usePlaylists();
  return (
    <>
      {playlists.length === 0 && (
        <p className="library-hint t-body muted">Group titles into playlists from their page, or start one here.</p>
      )}
      <PosterGrid>
        {playlists.map((p) => (
          <PlaylistTile key={p.id} playlist={p} onOpen={() => onOpen(p.id)} />
        ))}
        {playlists.length < MAX_PLAYLISTS && (
          <button className="card card-poster playlist-tile" onClick={() => onOpen(createPlaylist("New Playlist")!.id, true)}>
            <div className="card-frame playlist-new">
              <Plus size={28} />
              <span className="t-callout">New Playlist</span>
            </div>
          </button>
        )}
      </PosterGrid>
    </>
  );
}

function PlaylistView({ id, fresh, onClose, backLabel }: { id: string; fresh: boolean; onClose: () => void; backLabel: string }) {
  const playlist = usePlaylists().find((p) => p.id === id);
  if (!playlist) return null;
  const n = playlist.items.length;

  return (
    <div className="playlist-view">
      <div className="playlist-view-head">
        <button className="playlist-back t-callout" onClick={onClose}>
          <ChevronLeft size={16} strokeWidth={2.25} />
          {backLabel}
        </button>
        <div className="playlist-view-title">
          <input
            key={playlist.name}
            className="playlist-name-input t-title2"
            defaultValue={playlist.name}
            maxLength={60}
            aria-label="Playlist name"
            // A new playlist starts with its name selected, ready to type over.
            autoFocus={fresh}
            onFocus={(e) => fresh && e.currentTarget.select()}
            onBlur={(e) => {
              if (e.target.value.trim()) renamePlaylist(id, e.target.value);
              else e.target.value = playlist.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.stopPropagation();
                e.currentTarget.value = playlist.name;
                e.currentTarget.blur();
              }
            }}
          />
          <span className="t-callout faint tabular">
            {n} {n === 1 ? "title" : "titles"}
          </span>
          <span className="playlist-view-spacer" />
          <ConfirmDeleteButton label="playlist" onConfirm={() => (deletePlaylist(id), onClose())} />
        </div>
      </div>
      {playlist.packed ? (
        <EmptyState>Made with a newer version of Polarity. Update Polarity to see its titles.</EmptyState>
      ) : n === 0 ? (
        <EmptyState>Add titles with the playlist button on their page.</EmptyState>
      ) : (
        <PosterGrid>
          {playlist.items.map((item) => (
            <PlaylistEntry key={item.id} playlistId={id} item={item} />
          ))}
        </PosterGrid>
      )}
    </div>
  );
}

function PlaylistEntry({ playlistId, item }: { playlistId: string; item: PlaylistItem }) {
  const shown = usePlaylistItem(item);
  return (
    <div className="playlist-entry">
      <PosterCard item={shown ?? { id: item.id, type: item.type, name: "" }} />
      <button
        className="playlist-remove"
        aria-label={`Remove ${shown?.name ?? "title"} from playlist`}
        title="Remove from playlist"
        onClick={() => removeFromPlaylist(playlistId, item.id)}
      >
        <Close size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}
