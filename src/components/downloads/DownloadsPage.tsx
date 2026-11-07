import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DownloadButton } from "../DownloadButton";
import { TrashLid, useConfirmDelete } from "../ConfirmDeleteButton";
import { Dropdown } from "../Dropdown";
import { Segmented } from "../Segmented";
import { StillPlaceholder } from "../StillPlaceholder";
import { Img } from "../Img";
import { ChevronDown, Download, Play, Watched } from "../icons";
import { Button, buttonClass } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { SearchField } from "../ui/SearchField";
import {
  DOWNLOAD_FILTERS,
  DOWNLOAD_SORTS,
  SEARCH_FROM,
  activeProgress,
  bytesOnDisk,
  downloadFraction,
  downloadsSummary,
  filterTitles,
  groupDownloads,
  isActive,
  keepOpen,
  localStream,
  readDownloadsView,
  removeDownloads,
  saveDownloadsView,
  sortTitles,
  useAllLeaving,
  useDownloads,
  useDownloadsStorage,
  useLeaving,
  watchedFraction,
  watchedIds,
  watchedSet,
  type Download as DownloadRecord,
  type DownloadSeason,
  type DownloadTitle,
  type DownloadsView,
} from "../../lib/library";
import { episodeCode, formatBytes } from "../../lib/format";
import { useProgressOf } from "../../lib/net";
import { useRouter } from "../../lib/router";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const seasonName = (s: number) => (s === 0 ? "Specials" : `Season ${s}`);

/**
 * Library → Downloads (#15): how much they take and how much room is left, what's still coming down
 * in a section of its own, then one compact row per title that opens to its episodes (by season when
 * a show spans several). Sorted, filtered and searched; whole titles, seasons, everything watched or a
 * selection deleted at once. Which titles are open, the sort and the filter are kept on this device.
 */
export function DownloadsPage() {
  const { data } = useDownloads();
  const all = useMemo(() => data ?? [], [data]);
  const metaIds = useMemo(() => [...new Set(all.map((d) => d.metaId))], [all]);
  const progress = useProgressOf(metaIds);
  const watched = useMemo(() => watchedSet(progress, watchedFraction()), [progress]);
  const lastWatched = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of progress) m.set(p.metaId, Math.max(m.get(p.metaId) ?? 0, p.updatedAt));
    return m;
  }, [progress]);

  const [view, setView] = useState<DownloadsView>(readDownloadsView);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const update = (patch: Partial<DownloadsView>) =>
    setView((v) => {
      const next = { ...v, ...patch };
      saveDownloadsView(next);
      return next;
    });

  const toggleOpen = useCallback(
    (key: string) =>
      setView((v) => {
        const next = { ...v, open: v.open.includes(key) ? v.open.filter((k) => k !== key) : [...v.open, key] };
        saveDownloadsView(next);
        return next;
      }),
    [],
  );
  const selection: Selection = useMemo(
    () =>
      selected && {
        has: (id: string) => selected.has(id),
        set: (ids: string[], on: boolean) =>
          setSelected((s) => {
            const next = new Set(s);
            for (const id of ids) on ? next.add(id) : next.delete(id);
            return next;
          }),
      },
    [selected],
  );

  const active = useMemo(() => all.filter(isActive), [all]);
  // The list is polled every second while something downloads; the finished titles are only grouped again when
  // they change, so their rows (memo) aren't drawn again with every poll.
  const done = useMemo(() => all.filter((d) => !isActive(d)), [all]);
  const doneKey = done.map((d) => `${d.id}:${bytesOnDisk(d)}`).join("|");
  const finished = useMemo(() => groupDownloads(done, watched, lastWatched), [doneKey, watched, lastWatched]); // done read through doneKey
  const shownTitles = useMemo(
    () => (view.filter === "active" ? [] : sortTitles(filterTitles(finished, view.filter, query), view.sort)),
    [finished, view.filter, view.sort, query],
  );
  const shownActive = useMemo(
    () =>
      groupDownloads(active, watched, lastWatched)
        .filter((t) => filterTitles([t], view.filter, query).length)
        .flatMap((t) => t.items),
    [active, watched, lastWatched, view.filter, query],
  );

  // Forget open groups and selected rows that are gone (deleted here, or elsewhere).
  const live = data !== undefined;
  useEffect(() => {
    if (!live) return;
    const open = keepOpen(view.open, finished);
    if (open.length !== view.open.length) update({ open });
    setSelected((s) => (s && [...s].some((id) => !all.some((d) => d.id === id)) ? new Set([...s].filter((id) => all.some((d) => d.id === id))) : s));
    // Runs when the list changes; `view.open` is read, not watched.
  }, [all, finished, live]);

  if (data?.length === 0) {
    return (
      <EmptyState>
        Download a movie or an episode with <Download size={15} className="inline-icon" /> on its page to watch it without a connection.
      </EmptyState>
    );
  }
  if (!data) return null;

  const allWatched = watchedIds(done, watched);
  const shownIds = [...shownActive, ...shownTitles.flatMap((t) => t.items)].map((d) => d.id);

  return (
    <div className="downloads">
      <StorageSummary list={all} />
      <div className="downloads-toolbar" data-nav-row data-nav-group>
        <Segmented
          label="Show"
          options={DOWNLOAD_FILTERS.map((f) => ({ id: f.value, label: f.label }))}
          value={view.filter}
          onChange={(filter) => update({ filter })}
        />
        {finished.length + new Set(active.map((d) => d.metaId)).size > SEARCH_FROM && (
          <SearchField look="pill" label="Search downloads" placeholder="Search" value={query} onChange={setQuery} className="downloads-search" />
        )}
        <Dropdown label="Sort by" value={view.sort} onChange={(sort) => update({ sort })} options={DOWNLOAD_SORTS} />
        <span className="downloads-toolbar-gap" />
        {!selected && allWatched.length > 0 && <BulkDelete ids={allWatched} label={`Delete All Watched (${allWatched.length})`} />}
        <Button className="downloads-select" onClick={() => setSelected(selected ? null : new Set())} aria-pressed={!!selected}>
          {selected ? "Done" : "Select"}
        </Button>
      </div>
      {selected && (
        <div className="downloads-selectbar" role="region" aria-label="Selection" data-nav-row>
          <span className="t-callout tabular">{selected.size ? `${plural(selected.size, "download")} selected` : "Select downloads to delete"}</span>
          <Button onClick={() => setSelected(selected.size === shownIds.length ? new Set() : new Set(shownIds))}>
            {selected.size === shownIds.length && shownIds.length ? "Select None" : "Select All"}
          </Button>
          {selected.size > 0 && <BulkDelete ids={[...selected]} label={`Delete Selected (${selected.size})`} onDone={() => setSelected(new Set())} />}
        </div>
      )}

      {shownActive.length > 0 && <ActiveSection list={shownActive} selection={selection} />}

      {shownTitles.length > 0 && (
        <section className="downloads-library" aria-label="Downloaded">
          {shownActive.length > 0 && <h2 className="downloads-heading t-title3">Downloaded</h2>}
          {shownTitles.map((t) => (
            <TitleGroup key={t.key} title={t} watched={watched} open={view.open} onToggle={toggleOpen} selection={selection} />
          ))}
        </section>
      )}
      {!shownActive.length && !shownTitles.length && (
        <EmptyState>{view.filter === "active" && !query ? "Nothing is downloading." : "No downloads match."}</EmptyState>
      )}
    </div>
  );
}

type Selection = { has: (id: string) => boolean; set: (ids: string[], on: boolean) => void } | null;

/** "23 downloads · 41.7 GB · 112 GB free", and the folder they're in. */
function StorageSummary({ list }: { list: DownloadRecord[] }) {
  const { data: storage } = useDownloadsStorage();
  const { count, bytes } = downloadsSummary(list);
  const parts = [plural(count, "download"), formatBytes(bytes), storage?.free != null ? `${formatBytes(storage.free)} free` : null];
  return (
    <div className="downloads-summary">
      <p className="t-headline tabular">{parts.filter(Boolean).join(" · ")}</p>
      {storage?.dir && (
        <p className="t-caption faint downloads-folder" title={storage.dir}>
          Saved in {storage.dir}
        </p>
      )}
    </div>
  );
}

/** Downloading, paused and failed, above the rest, with how far they've come together. */
function ActiveSection({ list, selection }: { list: DownloadRecord[]; selection: Selection }) {
  const f = activeProgress(list);
  const moving = list.filter((d) => d.state === "downloading").length;
  return (
    <section className="downloads-active" aria-label="In progress">
      <div className="downloads-active-head">
        <h2 className="downloads-heading t-title3">{moving ? `Downloading ${moving} of ${list.length}` : "In Progress"}</h2>
        {f != null && (
          <span
            className="downloads-active-bar"
            role="progressbar"
            aria-label="Overall progress"
            aria-valuenow={Math.round(f * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ transform: `scaleX(${f})` }} />
          </span>
        )}
      </div>
      <ul className="download-rows">
        {list.map((d) => (
          <DownloadRow key={d.id} d={d} series={d.type === "series"} watched={false} selection={selection} showTitle />
        ))}
      </ul>
    </section>
  );
}

/**
 * One title, one compact row: its poster, its name and "12 episodes · 14.2 GB · 4 unwatched". A movie
 * plays from it; a show opens to its episodes (by season when it spans several) with its deletes on top.
 * Opening and closing fold the rows in and out through a 0fr ↔ 1fr grid row, as a delete does.
 */
const TitleGroup = memo(function TitleGroup({
  title,
  watched,
  open,
  onToggle,
  selection,
}: {
  title: DownloadTitle;
  watched: Set<string>;
  open: string[];
  onToggle: (key: string) => void;
  selection: Selection;
}) {
  const allLeaving = useAllLeaving(title.items.map((d) => d.id));
  const ids = title.items.map((d) => d.id);
  if (title.type !== "series") {
    return (
      <section className="download-group download-title" data-leaving={allLeaving || undefined}>
        <div className="download-group-fold">
          <ul className="download-rows">
            {title.items.map((d) => (
              <DownloadRow key={d.id} d={d} series={false} watched={watched.has(d.id)} selection={selection} poster />
            ))}
          </ul>
        </div>
      </section>
    );
  }
  const isOpen = open.includes(title.key);
  const bodyId = `download-title-${title.key}`;
  const watchedHere = watchedIds(title.items, watched);
  return (
    <section className="download-group download-title" data-open={isOpen || undefined} data-leaving={allLeaving || undefined}>
      <div className="download-group-fold">
        <div className="download-title-head" data-nav-row>
          {selection && <SelectBox ids={ids} selection={selection} label={`Select every episode of ${title.name}`} />}
          <button className="download-title-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => onToggle(title.key)}>
            <span className="download-title-poster">{title.poster ? <Img src={title.poster} alt="" /> : <StillPlaceholder />}</span>
            <span className="download-row-text">
              <span className="t-headline">{title.name}</span>
              <span className="t-caption faint tabular">
                {[plural(title.items.length, "episode"), formatBytes(title.bytes), title.unwatched ? `${title.unwatched} unwatched` : "All watched"].join(
                  " · ",
                )}
              </span>
            </span>
            <ChevronDown size={18} className="download-title-chevron" />
          </button>
        </div>
        <Fold open={isOpen} id={bodyId}>
          <div className="download-title-actions" data-nav-row>
            {watchedHere.length > 0 && <BulkDelete ids={watchedHere} label={`Delete Watched (${watchedHere.length})`} />}
            <BulkDelete ids={ids} label="Delete All" />
          </div>
          {title.seasons.length ? (
            title.seasons.map((s) => <SeasonGroup key={s.key} season={s} watched={watched} open={open} onToggle={onToggle} selection={selection} />)
          ) : (
            <ul className="download-rows">
              {title.items.map((d) => (
                <DownloadRow key={d.id} d={d} series watched={watched.has(d.id)} selection={selection} />
              ))}
            </ul>
          )}
        </Fold>
      </div>
    </section>
  );
});

/** "Season 1 · 8 episodes · 9.6 GB", folding open to its episodes; its own deletes on the right. */
function SeasonGroup({
  season,
  watched,
  open,
  onToggle,
  selection,
}: {
  season: DownloadSeason;
  watched: Set<string>;
  open: string[];
  onToggle: (key: string) => void;
  selection: Selection;
}) {
  const ids = season.items.map((d) => d.id);
  const allLeaving = useAllLeaving(ids);
  const isOpen = open.includes(season.key);
  const bodyId = `download-season-${season.key}`;
  const watchedHere = watchedIds(season.items, watched);
  return (
    <div className="download-group download-season" data-open={isOpen || undefined} data-leaving={allLeaving || undefined}>
      <div className="download-group-fold">
        <div className="download-season-head" data-nav-row>
          {selection && <SelectBox ids={ids} selection={selection} label={`Select every episode of ${seasonName(season.season)}`} />}
          <button className="download-season-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => onToggle(season.key)}>
            <ChevronDown size={16} className="download-title-chevron" />
            <span className="t-callout">{seasonName(season.season)}</span>
            <span className="t-caption faint tabular">
              {[plural(season.items.length, "episode"), formatBytes(season.bytes), season.unwatched ? `${season.unwatched} unwatched` : "All watched"].join(
                " · ",
              )}
            </span>
          </button>
          {watchedHere.length > 0 && <BulkDelete ids={watchedHere} label={`Delete Watched (${watchedHere.length})`} small />}
          <BulkDelete ids={ids} label="Delete Season" small />
        </div>
        <Fold open={isOpen} id={bodyId}>
          <ul className="download-rows">
            {season.items.map((d) => (
              <DownloadRow key={d.id} d={d} series watched={watched.has(d.id)} selection={selection} />
            ))}
          </ul>
        </Fold>
      </div>
    </div>
  );
}

/**
 * What's inside an open group; while closed it's folded to nothing and out of the tab order. Its rows are only
 * there while it's open or closing, so a page of closed titles doesn't draw every episode.
 */
function Fold({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return (
    <div
      className="download-fold"
      id={id}
      data-open={open || undefined}
      inert={!open}
      onTransitionEnd={(e) => {
        if (!open && e.target === e.currentTarget) setMounted(false);
      }}
    >
      <div className="download-fold-inner">{mounted && children}</div>
    </div>
  );
}

/** A checkbox for one download or a group of them (mixed when only some are picked). */
function SelectBox({ ids, selection, label }: { ids: string[]; selection: NonNullable<Selection>; label: string }) {
  const picked = ids.filter((id) => selection.has(id)).length;
  return (
    <input
      type="checkbox"
      className="download-check"
      aria-label={label}
      checked={picked === ids.length && ids.length > 0}
      ref={(el) => {
        if (el) el.indeterminate = picked > 0 && picked < ids.length;
      }}
      onChange={(e) => selection.set(ids, e.target.checked)}
    />
  );
}

/** A text button that deletes several at once: the first click arms it (red, the bin's lid open), the second deletes. */
function BulkDelete({ ids, label, small = false, onDone }: { ids: string[]; label: string; small?: boolean; onDone?: () => void }) {
  const { armed, props } = useConfirmDelete(() => {
    void removeDownloads(ids).then(onDone);
  }, label);
  return (
    <button
      type="button"
      className={buttonClass("plain", false, `confirm-delete downloads-bulk${small ? " downloads-bulk-sm" : ""}`)}
      {...props}
      aria-label={armed ? `Click again: ${label}` : label}
    >
      <TrashLid size={small ? 15 : 17} />
      <span>{armed ? "Click Again to Delete" : label}</span>
    </button>
  );
}

/** "S1 E3 · 1080p · 2.4 GB", or how far along it is. */
export function downloadLine(d: DownloadRecord) {
  const ep = d.season != null && d.episode != null ? episodeCode(d.season, d.episode) : null;
  const f = downloadFraction(d);
  const status =
    d.state === "done"
      ? formatBytes(bytesOnDisk(d))
      : d.state === "failed"
        ? "Failed"
        : `${d.state === "paused" ? "Paused" : "Downloading"}${f != null ? ` · ${Math.round(f * 100)}%` : ""}`;
  return [ep, d.quality, status].filter(Boolean).join(" · ");
}

function usePlayDownload() {
  const { navigate } = useRouter();
  return (d: DownloadRecord) => navigate({ name: "player", type: d.type, metaId: d.metaId, videoId: d.id, stream: localStream(d) });
}

/**
 * A movie or an episode. Deleting it folds the row shut (height via a 1fr → 0fr grid row, with a fade
 * and a slight drop in scale) before it leaves the list, so the rows below slide up instead of jumping.
 * `poster`: a movie's own row, its poster beside it; `showTitle`: in the In Progress section, the
 * show's name above the episode.
 */
function DownloadRow({
  d,
  series,
  watched,
  selection,
  poster = false,
  showTitle = false,
}: {
  d: DownloadRecord;
  series: boolean;
  watched: boolean;
  selection: Selection;
  poster?: boolean;
  showTitle?: boolean;
}) {
  const leaving = useLeaving(d.id);
  const play = usePlayDownload();
  const name = series && d.episode != null ? `${d.episode}. ${d.episodeTitle ?? `Episode ${d.episode}`}` : d.name;
  const art = poster ? d.poster : (d.thumbnail ?? d.background);
  return (
    <li className="download-row" data-state={d.state} data-watched={watched || undefined} data-leaving={leaving || undefined}>
      <div className="download-row-fold">
        <div className="download-row-inner" data-nav-row>
          {selection && <SelectBox ids={[d.id]} selection={selection} label={`Select ${series && showTitle ? `${d.name} ` : ""}${name}`} />}
          <button className="download-row-main" disabled={d.state !== "done"} onClick={() => play(d)}>
            <span className={poster ? "download-title-poster" : "download-row-still"}>
              {art ? <Img src={art} alt="" /> : <StillPlaceholder />}
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
              {showTitle && series && <span className="t-caption faint">{d.name}</span>}
              <span className="t-headline">{name}</span>
              <span className="t-caption faint tabular download-row-line">
                {watched && (
                  <span className="download-row-watched">
                    <Watched size={14} aria-hidden /> Watched ·{" "}
                  </span>
                )}
                {poster ? ["Movie", downloadLine(d)].join(" · ") : downloadLine(d)}
              </span>
              {d.state === "failed" && d.error && <span className="t-caption download-row-error">{d.error}</span>}
            </span>
          </button>
          <DownloadButton
            item={{ id: d.metaId, type: d.type, name: d.name, poster: d.poster, background: d.background, logo: d.logo }}
            video={series ? { id: d.id, title: d.episodeTitle ?? "", season: d.season ?? 0, episode: d.episode ?? 0, thumbnail: d.thumbnail } : undefined}
            className={buttonClass("plain", true, "download-row-action quiet-btn")}
            size={18}
          />
        </div>
      </div>
    </li>
  );
}
