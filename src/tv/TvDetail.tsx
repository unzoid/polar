import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Edit, Episodes, Play, PlaylistIcon, Plus, Reset, Sources } from "../components/icons";
import { useBackdropTrailer } from "../components/BackdropTrailer";
import { TitleDetails } from "../components/TitleDetails";
import { Info } from "../components/icons";
import { addToPlaylist, createPlaylist, removeFromPlaylist, renamePlaylist, usePlaylists } from "../lib/playlists";
import { TitleLogo } from "../components/TitleLogo";
import { ProgressBar } from "../components/PosterCard";
import { Still } from "../components/StillPlaceholder";
import { stillFor } from "../lib/anime/stills";
import { StreamList } from "../components/StreamList";
import { progressMap, seasonsOf, upNext } from "../lib/episodes";
import { episodeCode, formatDate, formatRemaining, formatRuntime, isReleased, seasonLabel } from "../lib/format";
import { usePlayTarget } from "../lib/playTarget";
import { useLibrary, useMeta, useProgress, useSettings, useStreams, useToggleLibrary } from "../lib/queries";
import { useRouter } from "../lib/router";
import { watchedFraction } from "../lib/watched";
import type { ContentType, Meta, MetaPreview, RankedStream, Video } from "../lib/types";
import { useBack, useFocusTrap, usePageActive } from "./shell";
import { reveal } from "./spatial";
import { TvKeyboard } from "./TvKeyboard";
import { Facts, TvBackdrop, titleFacts } from "./TvStage";

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
export function TvDetail({ type, id, preview }: { type: ContentType; id: string; preview?: MetaPreview }) {
  const { data: meta, isError } = useMeta(type, id);
  const shown: MetaPreview | undefined = meta ?? preview;
  const active = usePageActive();
  const { navigate } = useRouter();
  const [panels, setPanels] = useState<Panel[]>([]);
  const push = (p: Panel) => setPanels((ps) => [...ps, p]);
  const pop = () => setPanels((ps) => ps.slice(0, -1));
  useBack(active && panels.length > 0, pop);

  const { data: settings } = useSettings();
  const autoPick = settings?.autoPickSource ?? true;
  // The trailer behind the art, while nothing's open over the page.
  const trailer = useBackdropTrailer(id, { active: active && panels.length === 0 });

  /** Play now, or (auto-pick off, nothing to resume) choose a source first. */
  const play = (videoId: string, subtitle: string, opts: { stream?: RankedStream; resumable?: boolean } = {}) => {
    if (!opts.stream && !autoPick && !opts.resumable) return push({ kind: "sources", videoId, subtitle });
    // Coming back from the player returns to the episode list, not a source picker.
    setPanels((ps) => ps.filter((p) => p.kind !== "sources"));
    navigate({ name: "player", type, metaId: id, videoId, stream: opts.stream?.stream });
  };

  if (!shown) {
    return isError ? (
      <div className="tv-note">
        <p className="tv-empty">Couldn't load this title.</p>
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
        {shown.logo ? (
          <TitleLogo src={shown.logo} alt={shown.name} className="tv-detail-logo" loading="eager" />
        ) : (
          <h1 className="tv-detail-title">{shown.name}</h1>
        )}
        <Facts facts={titleFacts(shown, [formatRuntime(meta?.runtime)])} />
        {shown.description && <p className="tv-detail-description">{shown.description}</p>}
        <Credits meta={meta} />
        {/* A series' Play depends on watch history: wait for it, or focus would land on the wrong button. */}
        {type === "movie" || meta ? (
          <Actions item={shown} meta={meta} play={play} push={push} />
        ) : (
          <div className="tv-actions" aria-hidden>
            <span className="tv-pill tv-pill-skeleton skeleton" />
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
  const inPlaylist = usePlaylists().some((p) => p.items.some((i) => i.id === item.id));
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

/** "New Playlist", or "New Playlist 2" and so on if that's taken. */
function freshName(taken: string[]) {
  const names = new Set(taken);
  let n = 1;
  while (names.has(n === 1 ? "New Playlist" : `New Playlist ${n}`)) n++;
  return n === 1 ? "New Playlist" : `New Playlist ${n}`;
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
  const playlists = usePlaylists();
  return (
    <div className="tv-panel tv-sources tv-playlists" ref={ref} data-nav-scope role="dialog" aria-label="Add to playlist">
      <header className="tv-sources-head">
        <h2 className="tv-heading">Add to Playlist</h2>
        <p className="tv-sources-sub">{item.name}</p>
      </header>
      <div className="tv-scroll tv-sources-list tv-playlist-list" data-nav-scroll="center" data-nav-memory>
        {playlists.map((p, i) => {
          const has = p.items.some((x) => x.id === item.id);
          return (
            <div key={p.id} className="tv-playlist-line">
              <button
                className="tv-playlist-row"
                role="menuitemcheckbox"
                aria-checked={has}
                data-nav-default={i === 0 || undefined}
                onClick={() => (has ? removeFromPlaylist(p.id, item.id) : addToPlaylist(p.id, item))}
              >
                <span className="tv-playlist-check">{has && <Check size={22} />}</span>
                <span className="tv-playlist-name">{p.name}</span>
                <span className="tv-playlist-count tabular">
                  {p.items.length} {p.items.length === 1 ? "title" : "titles"}
                </span>
              </button>
              <button className="tv-playlist-rename" aria-label={`Rename ${p.name}`} onClick={() => onRename(p.id)}>
                <Edit size={30} />
              </button>
            </div>
          );
        })}
        <button
          className="tv-playlist-row tv-playlist-new"
          data-nav-default={playlists.length === 0 || undefined}
          onClick={onNew}
        >
          <span className="tv-playlist-check">
            <Plus size={22} />
          </span>
          <span className="tv-playlist-name">New Playlist</span>
        </button>
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
  const editing = playlistId ? playlists.find((p) => p.id === playlistId) : undefined;
  const [text, setText] = useState(editing?.name ?? "");

  const save = () => {
    const name = text.trim();
    if (editing) {
      if (name && name !== editing.name) renamePlaylist(editing.id, name);
    } else {
      createPlaylist(name || freshName(playlists.map((p) => p.name)), item);
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
          <dd>{meta.cast.slice(0, 3).join(", ")}</dd>
        </div>
      ) : null}
      {meta.director?.length ? (
        <div>
          <dt>{meta.type === "series" ? "Created by" : "Director"}</dt>
          <dd>{meta.director.slice(0, 2).join(", ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** "49 min" → "49m" */
const shortRuntime = (r?: string) => r?.replace(/\s*min$/, "m");

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
        {meta.logo ? <TitleLogo src={meta.logo} alt={meta.name} className="tv-panel-logo" /> : <h2 className="tv-panel-title">{meta.name}</h2>}
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
          const fraction = p?.duration ? p.position / p.duration : 0;
          const watched = fraction >= watchedFraction();
          const released = isReleased(v);
          const isEntry = v.id === entryId;
          const status = !released
            ? `Coming ${formatDate(v.released)}`
            : fraction > 0 && !watched && p
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
                  {fraction > 0 && !watched && <ProgressBar fraction={fraction} />}
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
          el.scrollBy({ top: (down ? 1 : -1) * el.clientHeight * 0.4, behavior: "smooth" });
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
