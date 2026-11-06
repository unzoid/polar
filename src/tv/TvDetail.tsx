import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NameList } from "../components/title/NameList";
import { Check, Edit, Episodes, Play, PlaylistIcon, Plus, Reset, Sources } from "../components/icons";
import { useBackdropTrailer } from "../components/BackdropTrailer";
import { TitleDetails } from "../components/title/TitleDetails";
import { Info } from "../components/icons";
import { episodeState, progressMap, renamePlaylist, seasonsOf, upNext, usePlaylists, watchedFraction } from "../lib/library";
import { usePlaylistChecklist } from "../components/title/PlaylistChecklist";
import { TitleHeading } from "../components/title/TitleHeading";
import { ProgressBar } from "../components/title/Card";
import { Still } from "../components/StillPlaceholder";
import { animeEntries, entryMeta, pickTitle, stillFor } from "../lib/anime";
import { StreamList } from "../components/StreamList";
import { episodeCode, formatDate, formatRemaining, formatRuntime, isReleased, seasonLabel, shortRuntime } from "../lib/format";
import { usePlayTarget, useTitlePlayback } from "../lib/playback";
import { useLibrary, useMeta, useProgress, useStreams, useToggleLibrary } from "../lib/net";
import { usePrefs } from "../lib/settings";
import type { ContentType, Meta, MetaPreview, RankedStream, Video } from "../lib/types";
import { useBack, useFocusTrap, usePageActive } from "./shell";
import { reveal } from "./spatial";
import { glideScroll, glideTarget } from "./follow";
import { TvKeyboard } from "./TvKeyboard";
import { Facts, TvBackdrop, titleFacts } from "./TvStage";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";

type Panel =
  | { kind: "episodes" }
  | { kind: "details" }
  | { kind: "sources"; videoId: string; subtitle: string }
  | { kind: "playlists" }
  /** Name a playlist: rename `playlistId`, or create one holding the title. */
  | { kind: "name"; playlistId?: string };

/**
 * A title, TV-style: art across the screen, the logo, facts and synopsis on
 * the left, and a short column of actions. Episodes and sources open as
 * full-screen panels on top; Back closes them one at a time.
 */
export function TvDetail({ type, id, preview, entry }: { type: ContentType; id: string; preview?: MetaPreview; entry?: number }) {
  const { data: loaded, isError } = useMeta(type, id);
  // Seasons as separate shows (#22): one AniList entry's page, its name and episodes, when it was lined up here.
  const { animeSeparateEntries, animeTitles } = usePrefs();
  const meta = useMemo(() => {
    const record = loaded && entry !== undefined && animeSeparateEntries ? animeEntries.entry(id, entry) : undefined;
    return record && loaded ? entryMeta(loaded, record, pickTitle(record.title, animeTitles) || loaded.name) : loaded;
  }, [loaded, entry, animeSeparateEntries, animeTitles, id]);
  const shown: MetaPreview | undefined = meta ?? preview;
  const active = usePageActive();
  const [panels, setPanels] = useState<Panel[]>([]);
  const push = (p: Panel) => setPanels((ps) => [...ps, p]);
  const pop = () => setPanels((ps) => ps.slice(0, -1));
  useBack(active && panels.length > 0, pop);

  // The trailer behind the art, while nothing's open over the page.
  const trailer = useBackdropTrailer(id, { active: active && panels.length === 0 });

  /** Play now, or (auto-pick off, nothing to resume) choose a source first. */
  const playback = useTitlePlayback(
    (req) => push({ kind: "sources", videoId: req.videoId, subtitle: req.subtitle ?? "" }),
    // Coming back from the player returns to the episode list, not a source picker.
    () => setPanels((ps) => ps.filter((p) => p.kind !== "sources")),
  );
  const play = (videoId: string, subtitle: string, opts: { stream?: RankedStream; resumable?: boolean } = {}) =>
    playback({ type, metaId: id, videoId, subtitle, resumable: opts.resumable }, opts.stream);

  if (!shown) {
    return isError ? (
      <div className="tv-note">
        <EmptyState variant="tv">Couldn't load this title.</EmptyState>
      </div>
    ) : (
      <div className="tv-detail" />
    );
  }

  return (
    <div className="tv-detail" data-trailer={trailer.visible}>
      <TvBackdrop src={shown.background} className="tv-detail-art">
        {trailer.node}
      </TvBackdrop>
      <div className="tv-detail-body">
        <TitleHeading name={shown.name} logo={shown.logo} look="tv-detail" />
        <Facts facts={titleFacts(shown, [formatRuntime(meta?.runtime)])} />
        {shown.description && <p className="tv-detail-description">{shown.description}</p>}
        <Credits meta={meta} />
        {/* A series' Play depends on watch history: wait for it, or focus would land on the wrong button. */}
        {type === "movie" || meta ? (
          <Actions item={shown} meta={meta} play={play} push={push} />
        ) : (
          <div className="tv-actions" aria-hidden>
            <Skeleton as="span" className="tv-pill tv-pill-skeleton" />
          </div>
        )}
      </div>

      {panels.map((p, i) =>
        p.kind === "episodes" && meta ? (
          <EpisodesPanel
            key={i}
            meta={meta}
            onPlay={(v, resumable) => play(v.id, episodeLine(v), { resumable })}
            onSources={(v) => push({ kind: "sources", videoId: v.id, subtitle: episodeLine(v) })}
          />
        ) : p.kind === "details" && meta ? (
          <DetailsPanel key={i} meta={meta} />
        ) : p.kind === "playlists" ? (
          <PlaylistsPanel
            key={i}
            item={shown}
            onRename={(playlistId) => push({ kind: "name", playlistId })}
            onNew={() => push({ kind: "name" })}
          />
        ) : p.kind === "name" ? (
          <NamePanel key={i} item={shown} playlistId={p.playlistId} active={active && i === panels.length - 1} onDone={pop} />
        ) : p.kind === "sources" ? (
          <SourcesPanel
            key={i}
            type={type}
            videoId={p.videoId}
            subtitle={p.subtitle}
            onPick={(s) => play(p.videoId, p.subtitle, { stream: s })}
          />
        ) : null,
      )}
    </div>
  );
}

const episodeLine = (v: Video) => `${episodeCode(v.season, v.episode)} · ${v.title}`;

function Actions({
  item,
  meta,
  play,
  push,
}: {
  item: MetaPreview;
  meta?: Meta;
  play: (videoId: string, subtitle: string, opts?: { resumable?: boolean }) => void;
  push: (p: Panel) => void;
}) {
  const { next, videoId, resumeAt, label } = usePlayTarget(item, meta);
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const inLibrary = library?.some((l) => l.id === item.id);
  const inPlaylist = usePlaylistChecklist(item).inAny;
  const subtitle = item.type === "series" && next?.video ? episodeLine(next.video) : item.name;
  // Warm the sources for Play while the page is read.
  useStreams(item.type, videoId);

  return (
    <div className="tv-actions" data-nav-memory>
      <ActionPill
        icon={resumeAt ? <Reset size={26} /> : <Play size={26} />}
        label={label}
        isDefault
        disabled={!videoId}
        onClick={() => videoId && play(videoId, subtitle, { resumable: !!resumeAt })}
      />
      {item.type === "series" && <ActionPill icon={<Episodes size={26} />} label="Episodes" onClick={() => push({ kind: "episodes" })} />}
      <ActionPill
        icon={<Sources size={26} />}
        label="Choose Source"
        disabled={!videoId}
        onClick={() => videoId && push({ kind: "sources", videoId, subtitle })}
      />
      {meta && <ActionPill icon={<Info size={26} />} label="Details" onClick={() => push({ kind: "details" })} />}
      <ActionPill
        icon={inLibrary ? <Check size={26} /> : <Plus size={26} />}
        label={inLibrary ? "In Library" : "Add to Library"}
        onClick={() => toggle.mutate(item)}
      />
      <ActionPill
        icon={<PlaylistIcon size={26} />}
        label={inPlaylist ? "In a Playlist" : "Add to Playlist"}
        onClick={() => push({ kind: "playlists" })}
      />
    </div>
  );
}

/**
 * Tick the playlists a title belongs in. Right of each row is Rename; New
 * Playlist asks for a name on the on-screen keyboard and puts the title in.
 */
export function PlaylistsPanel({
  item,
  onRename,
  onNew,
}: {
  item: MetaPreview;
  onRename: (playlistId: string) => void;
  onNew: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const { rows, toggle, full } = usePlaylistChecklist(item);
  return (
    <div className="tv-panel tv-sources tv-playlists" ref={ref} data-nav-scope role="dialog" aria-label="Add to playlist">
      <header className="tv-sources-head">
        <h2 className="tv-heading">Add to Playlist</h2>
        <p className="tv-sources-sub">{item.name}</p>
      </header>
      <div className="tv-scroll tv-sources-list tv-playlist-list" data-nav-scroll="center" data-nav-memory>
        {rows.map((row, i) => (
          <div key={row.id} className="tv-playlist-line">
            <button
              className="tv-playlist-row"
              role="menuitemcheckbox"
              aria-checked={row.has}
              data-nav-default={i === 0 || undefined}
              onClick={() => toggle(row)}
            >
              <span className="tv-playlist-check">{row.has && <Check size={22} />}</span>
              <span className="tv-playlist-name">{row.name}</span>
              <span className="tv-playlist-count tabular">
                {row.count} {row.count === 1 ? "title" : "titles"}
              </span>
            </button>
            <button className="tv-playlist-rename" aria-label={`Rename ${row.name}`} onClick={() => onRename(row.id)}>
              <Edit size={30} />
            </button>
          </div>
        ))}
        {!full && (
          <button
            className="tv-playlist-row tv-playlist-new"
            data-nav-default={rows.length === 0 || undefined}
            onClick={onNew}
          >
            <span className="tv-playlist-check">
              <Plus size={22} />
            </span>
            <span className="tv-playlist-name">New Playlist</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Name a playlist on the on-screen keyboard: rename one, or (no
 * `playlistId`) start a new one with this title in it. Back cancels.
 */
export function NamePanel({
  item,
  playlistId,
  active,
  onDone,
}: {
  item: MetaPreview;
  playlistId?: string;
  active: boolean;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const playlists = usePlaylists();
  const { create } = usePlaylistChecklist(item);
  const editing = playlistId ? playlists.find((p) => p.id === playlistId) : undefined;
  const [text, setText] = useState(editing?.name ?? "");

  const save = () => {
    const name = text.trim();
    if (editing) {
      if (name && name !== editing.name) renamePlaylist(editing.id, name);
    } else {
      create(name);
    }
    onDone();
  };

  return (
    <div className="tv-panel tv-sources tv-name" ref={ref} data-nav-scope role="dialog" aria-label={editing ? "Rename playlist" : "New playlist"}>
      <header className="tv-sources-head">
        <h2 className="tv-heading">{editing ? "Rename Playlist" : "New Playlist"}</h2>
        <p className="tv-sources-sub">{editing ? editing.name : `Starts with ${item.name}`}</p>
      </header>
      <div className="tv-osk tv-name-osk">
        <TvKeyboard text={text} onChange={setText} onSubmit={save} placeholder="Playlist name" active={active} caps />
        <button className="tv-pill tv-name-save" onClick={save}>
          <Check size={20} />
          {editing ? "Save" : "Create Playlist"}
        </button>
      </div>
    </div>
  );
}

function ActionPill({
  icon,
  label,
  onClick,
  disabled,
  isDefault,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isDefault?: boolean;
}) {
  return (
    <button className="tv-pill" onClick={onClick} disabled={disabled} data-nav-default={isDefault || undefined}>
      {icon}
      {label}
    </button>
  );
}

function Credits({ meta }: { meta?: Meta }) {
  if (!meta?.cast?.length && !meta?.director?.length) return null;
  return (
    <dl className="tv-credits">
      {meta.cast?.length ? (
        <div>
          <dt>Starring</dt>
          <dd><NameList names={meta.cast.slice(0, 3)} /></dd>
        </div>
      ) : null}
      {meta.director?.length ? (
        <div>
          <dt>{meta.type === "series" ? "Created by" : "Director"}</dt>
          <dd><NameList names={meta.director.slice(0, 2)} /></dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * Seasons down the left, that season's episodes down the right, opening on
 * the episode you're up to. Moving through the seasons switches the list.
 */
function EpisodesPanel({
  meta,
  onPlay,
  onSources,
}: {
  meta: Meta;
  onPlay: (v: Video, resumable: boolean) => void;
  onSources: (v: Video) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const seasonList = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const { data: progress } = useProgress(meta.id);
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const next = useMemo(() => upNext(meta, progress ?? []), [meta, progress]);
  const [season, setSeason] = useState(next.video?.season ?? seasons[0]);
  const episodes = meta.videos.filter((v) => v.season === season);
  const map = useMemo(() => progressMap(progress), [progress]);
  const entryId = (episodes.find((v) => v.id === next.video?.id) ?? episodes.find(isReleased))?.id;

  // A new season starts at its entry episode, not wherever the last one was scrolled to.
  useEffect(() => {
    const el = entryId ? list.current?.querySelector<HTMLElement>(`[data-video="${CSS.escape(entryId)}"]`) : null;
    if (el) reveal(el, false);
    else list.current?.scrollTo({ top: 0 });
  }, [season, entryId]);

  // Opening on season 14 of 20 (focus on its episode) still shows that season in the list.
  useEffect(() => {
    const el = seasonList.current?.querySelector<HTMLElement>("[aria-current]");
    if (el) reveal(el, false);
    // Only on open: once you're moving through seasons, focus keeps them in view.
  }, []);

  return (
    <div className="tv-panel tv-episodes" ref={ref} data-nav-scope role="dialog" aria-label="Episodes">
      <aside className="tv-episodes-side">
        <TitleHeading name={meta.name} logo={meta.logo} look="tv-panel" />
        <div className="tv-seasons" ref={seasonList} data-nav-scroll="center" data-nav-memory data-nav-prefer-entry>
          {seasons.map((s) => (
            <button
              key={s}
              className="tv-season"
              aria-current={s === season || undefined}
              data-nav-entry={s === season || undefined}
              onFocus={() => setSeason(s)}
              onClick={() => setSeason(s)}
            >
              <span>{seasonLabel(s)}</span>
              <span className="tv-season-count">{meta.videos.filter((v) => v.season === s).length} episodes</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="tv-scroll tv-episodes-list" ref={list} data-nav-scroll="center" data-nav-memory>
        {episodes.map((v) => {
          const p = map.get(v.id);
          const { released, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
          const isEntry = v.id === entryId;
          const status = !released
            ? `Coming ${formatDate(v.released)}`
            : inProgress && p
              ? formatRemaining(p.position, p.duration)
              : [shortRuntime(meta.runtime), formatDate(v.released)].filter(Boolean).join(" · ");
          return (
            <div key={v.id} className="tv-episode" data-nav-row data-video={v.id} data-unwatched={!watched}>
              <button
                className="tv-episode-main"
                disabled={!released}
                data-nav-entry={isEntry || undefined}
                data-nav-default={isEntry || undefined}
                // A started episode keeps the file it was playing.
                onClick={() => onPlay(v, !!p)}
              >
                <span className="tv-episode-still">
                  <Still src={stillFor(v.id) ?? v.thumbnail} />
                  {inProgress && <ProgressBar fraction={fraction} />}
                  {watched && (
                    <span className="tv-episode-watched" aria-label="Watched">
                      <Check size={18} />
                    </span>
                  )}
                </span>
                <span className="tv-episode-text">
                  <span className="tv-episode-kicker">
                    {v.id === next.video?.id && next.kind !== "start" ? `Up Next · Episode ${v.episode}` : `Episode ${v.episode}`}
                  </span>
                  <span className="tv-episode-title">{v.title}</span>
                  {v.overview && <span className="tv-episode-overview">{v.overview}</span>}
                  <span className="tv-episode-status">{status}</span>
                </span>
              </button>
              {released && (
                <button className="tv-episode-sources" onClick={() => onSources(v)} aria-label={`Sources for episode ${v.episode}`}>
                  <Sources size={26} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Cast, scores and the facts, full screen. The links out are buttons like any other. */
function DetailsPanel({ meta }: { meta: Meta }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div className="tv-panel tv-sources tv-details" ref={ref} data-nav-scope role="dialog" aria-label="Details">
      <header className="tv-sources-head">
        <h2 className="tv-heading">{meta.name}</h2>
        <p className="tv-sources-sub">Details</p>
      </header>
      {/* Focusable, so the arrows scroll it even where there's nothing to press. */}
      <div
        className="tv-scroll tv-sources-list tv-details-body"
        data-nav-scroll
        tabIndex={0}
        data-nav-default
        onKeyDown={(e) => {
          // On the page itself, up and down read on; at the end, down reaches the links.
          if (e.target !== e.currentTarget || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          const el = e.currentTarget;
          const down = e.key === "ArrowDown";
          if (down ? el.scrollTop + el.clientHeight >= el.scrollHeight - 4 : el.scrollTop <= 0) return;
          e.preventDefault();
          // One glide that a held key keeps steering, not a smooth scroll restarted per press.
          glideScroll(el, "y", (glideTarget(el, "y") ?? el.scrollTop) + (down ? 1 : -1) * el.clientHeight * 0.4);
        }}
      >
        <TitleDetails meta={meta} links={false} />
      </div>
    </div>
  );
}

function SourcesPanel({
  type,
  videoId,
  subtitle,
  onPick,
}: {
  type: ContentType;
  videoId: string;
  subtitle: string;
  onPick: (s: RankedStream) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div className="tv-panel tv-sources" ref={ref} data-nav-scope role="dialog" aria-label="Sources">
      <header className="tv-sources-head">
        <h2 className="tv-heading">Choose a Source</h2>
        <p className="tv-sources-sub">{subtitle}</p>
      </header>
      <div className="tv-scroll tv-sources-list" data-nav-scroll="center">
        <StreamList type={type} videoId={videoId} onPick={onPick} tv />
      </div>
    </div>
  );
}
