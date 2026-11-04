import { AlertCircle, Check } from "./icons";
import { useRouter } from "../lib/router";
import { openSettings, type PageId } from "../lib/settings";
import { useSettings, useStreams } from "../lib/net";
import { sourceRow, TAG_LABELS, tagsOf, useSourceFilters } from "../lib/playback";
import type { ContentType, RankedStream } from "../lib/types";
import { SourceFilterBar } from "./SourceFilters";
import { Button } from "./ui/Button";
import { errorMessage } from "../lib/errors";
import { Skeleton } from "./ui/Skeleton";

/**
 * Sources for one video, with the filters on top (add-on, resolution,
 * language, size, tags) and the sort. Sorted by best match, the top pick
 * stands out above the rest; any other sort is one plain list.
 */
export function StreamList({
  type,
  videoId,
  currentKey,
  onPick,
  tv = false,
}: {
  type: ContentType;
  videoId: string;
  currentKey?: string;
  onPick: (s: RankedStream) => void;
  /** TV mode: filters as chip rows a remote can reach. */
  tv?: boolean;
}) {
  const { tab } = useRouter();
  // Desktop settings are the overlay over this page; TV has its own settings screen.
  const showSettings = (page: PageId) => (tv ? tab({ name: "settings", page }) : openSettings(page));
  const { data, isLoading, isError, error } = useStreams(type, videoId);
  const { data: settings } = useSettings();
  const f = useSourceFilters(data?.streams, settings);

  if (isLoading) {
    return (
      <div className="stream-list">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="stream-row" height={64} />
        ))}
      </div>
    );
  }
  if (isError) return <p className="t-body muted">Couldn't load sources: {errorMessage(error)}</p>;
  if (!data) return null;

  const hidden = data.hidden ?? 0;
  if (!data.streams.length) {
    return (
      <div className="stream-empty">
        <p className="t-body muted">
          {hidden
            ? `All ${hidden} sources are hidden by your source filters.`
            : data.failed.length
              ? "Your add-ons didn't respond in time."
              : "No sources found."}
        </p>
        {hidden ? (
          <Button variant="glass" onClick={() => showSettings("sources")}>
            Source Filters
          </Button>
        ) : (
          <Button variant="glass" onClick={() => showSettings("addons")}>
            Manage Add-ons
          </Button>
        )}
      </div>
    );
  }

  // What matches the filters; with filters that only order (Settings → Sources), the rest follows it.
  const shown = f.view.slice(0, f.matched).map(({ r }) => r);
  const others = f.view.slice(f.matched).map(({ r }) => r);
  const grouped = f.sort === "best";
  const [best, ...rest] = shown;

  return (
    <div className="stream-list">
      <SourceFilterBar f={f} tv={tv} />

      {!shown.length && (
        <div className="stream-empty">
          <p className="t-body muted">No sources match these filters.</p>
          <Button variant="glass" onClick={f.clear}>
            Clear Filters
          </Button>
        </div>
      )}

      {/* Sorted by best match, the top pick is set apart; the quality control
          above already sorts by picture, so the rest is one plain list. */}
      {grouped && best && (
        <>
          <div className="stream-group-label t-micro faint">Best Match</div>
          <StreamRow s={best} featured current={currentKey === streamKey(best)} onPick={onPick} />
          {rest.length > 0 && <div className="stream-group-label t-micro faint">More Sources</div>}
          {rest.map((s) => (
            <StreamRow key={streamKey(s)} s={s} current={currentKey === streamKey(s)} onPick={onPick} />
          ))}
        </>
      )}
      {!grouped && shown.map((s) => <StreamRow key={streamKey(s)} s={s} current={currentKey === streamKey(s)} onPick={onPick} />)}
      {others.length > 0 && (
        <>
          <div className="stream-group-label t-micro faint">Other Sources</div>
          {others.map((s) => (
            <StreamRow key={streamKey(s)} s={s} current={currentKey === streamKey(s)} onPick={onPick} />
          ))}
        </>
      )}

      {hidden > 0 && <p className="stream-failed t-caption faint">{hidden} more hidden by Settings → Sources</p>}
      {data.failed.length > 0 && (
        <p className="stream-failed t-caption faint">
          <AlertCircle size={12} /> No response from {data.failed.join(", ")}
        </p>
      )}
    </div>
  );
}

/** Tags worth a badge on the row itself (the label already says resolution, HDR and codec). */
const ROW_TAGS = new Set(["hdr10+", "remux", "atmos", "truehd", "dts:x", "dts-hd", "10-bit", "imax", "3d"]);

function StreamRow({
  s,
  featured,
  current,
  onPick,
}: {
  s: RankedStream;
  featured?: boolean;
  current?: boolean;
  onPick: (s: RankedStream) => void;
}) {
  const row = sourceRow(s);
  const tags = tagsOf(s).filter((t) => ROW_TAGS.has(t));
  return (
    <button
      className="stream-row pressable"
      data-featured={featured}
      data-current={current}
      onClick={() => onPick(s)}
      // The release name is for the curious: on hover, not in the row.
      title={s.stream.title ?? s.stream.description}
    >
      <span className="stream-lead" aria-hidden>
        {current ? <Check size={16} strokeWidth={2.5} /> : null}
      </span>
      <span className="stream-text">
        <span className="stream-main">
          <span className="stream-title">{row.title}</span>
          {tags.map((t) => (
            <span key={t} className="badge">
              {TAG_LABELS[t]}
            </span>
          ))}
          {s.quality.lowQualitySource && <span className="badge badge-bad">CAM</span>}
        </span>
        <span className="stream-sub t-caption">
          {current ? "Playing · " : ""}
          {row.detail}
        </span>
      </span>
      {row.size && <span className="stream-size tabular">{row.size}</span>}
    </button>
  );
}

export function streamKey(s: RankedStream | { stream: RankedStream["stream"] }) {
  const st = s.stream;
  return st.url ?? st.ytId ?? "";
}
