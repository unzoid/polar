import { AlertCircle, Instant } from "./icons";
import { useRouter } from "../lib/router";
import { useStreams } from "../lib/queries";
import type { ContentType, RankedStream } from "../lib/types";

const GROUPS: { label: string; test: (r?: number) => boolean }[] = [
  { label: "4K", test: (r) => r === 2160 },
  { label: "1080p", test: (r) => r === 1080 || r === 1440 },
  { label: "720p", test: (r) => r === 720 },
  { label: "Other", test: (r) => r == null || r < 720 },
];

/** Sources for one video: the best pick on top, then the rest grouped by resolution. */
export function StreamList({
  type,
  videoId,
  currentKey,
  onPick,
}: {
  type: ContentType;
  videoId: string;
  currentKey?: string;
  onPick: (s: RankedStream) => void;
}) {
  const { tab } = useRouter();
  const { data, isLoading, isError, error } = useStreams(type, videoId);

  if (isLoading) {
    return (
      <div className="stream-list">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="stream-row skeleton" style={{ height: 64 }} />
        ))}
      </div>
    );
  }
  if (isError) return <p className="t-body muted">Couldn't load sources: {String(error)}</p>;
  if (!data) return null;

  if (!data.streams.length) {
    return (
      <div className="stream-empty">
        <p className="t-body muted">
          {data.failed.length ? "Your add-ons didn't respond in time." : "No sources found."}
        </p>
        <button className="btn btn-glass" onClick={() => tab({ name: "settings", page: "addons" })}>
          Manage Add-ons
        </button>
      </div>
    );
  }

  const [best, ...rest] = data.streams;
  return (
    <div className="stream-list">
      <div className="stream-group-label t-micro faint">Best Match</div>
      <StreamRow s={best} featured current={currentKey === streamKey(best)} onPick={onPick} />

      {GROUPS.map((g) => {
        const items = rest.filter((s) => g.test(s.quality.resolution));
        if (!items.length) return null;
        return (
          <div key={g.label}>
            <div className="stream-group-label t-micro faint">{g.label}</div>
            {items.map((s, i) => (
              <StreamRow key={i} s={s} current={currentKey === streamKey(s)} onPick={onPick} />
            ))}
          </div>
        );
      })}

      {data.failed.length > 0 && (
        <p className="stream-failed t-caption faint">
          <AlertCircle size={12} /> No response from {data.failed.join(", ")}
        </p>
      )}
    </div>
  );
}

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
  const detail = (s.stream.title ?? s.stream.description ?? "").split("\n")[0];
  return (
    <button
      className="stream-row pressable"
      data-featured={featured}
      data-current={current}
      onClick={() => onPick(s)}
      title={s.stream.title ?? s.stream.description}
    >
      <div className="stream-main">
        <span className="t-headline">{s.label}</span>
        <span className="stream-badges">
          {s.quality.cached && (
            <span className="badge badge-good">
              <Instant size={11} fill="currentColor" /> Instant
            </span>
          )}
          {s.quality.lowQualitySource && <span className="badge badge-bad">CAM</span>}
          {current && <span className="badge">Playing</span>}
        </span>
      </div>
      <div className="stream-sub t-caption faint">
        <span>{s.addon}</span>
        {s.quality.sources != null && <span className="tabular">{s.quality.sources} peers</span>}
        <span className="stream-raw">{detail}</span>
      </div>
    </button>
  );
}

export function streamKey(s: RankedStream | { stream: RankedStream["stream"] }) {
  const st = s.stream;
  return st.content_id ? `${st.content_id}:${st.fileIdx ?? 0}` : (st.url ?? st.ytId ?? "");
}
