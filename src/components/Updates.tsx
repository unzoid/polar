import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Close } from "./icons";
import { Sheet } from "./Sheet";
import { api } from "../lib/api";
import {
  dismissUpdate,
  downloadUpdate,
  installUpdate,
  releaseUrl,
  takeWhatsNew,
  useUpdate,
  useUpdateDismissed,
  type WhatsNew,
} from "../lib/updater";

/**
 * The bottom-centre notice for a new version. It steps through the whole flow
 * in place: available → downloading (with progress) → ready → restarting.
 * Hidden while something is playing; it waits for the user to come back.
 */
export function UpdateToast({ hidden }: { hidden: boolean }) {
  const s = useUpdate();
  const dismissed = useUpdateDismissed();
  const [notes, setNotes] = useState(false);

  const version = "version" in s ? s.version : null;
  const visible =
    !hidden &&
    version !== null &&
    dismissed !== version &&
    (s.phase === "available" || s.phase === "downloading" || s.phase === "ready" || s.phase === "installing");

  return (
    <>
      {visible && (
        <div className="tv-prompt update-toast" role="status" data-phase={s.phase}>
          <UpdateIcon />
          <span className="tv-prompt-text">
            {s.phase === "available" && (
              <>
                <strong>Polar {s.version} is available</strong>
                <span>You're on an older version.</span>
              </>
            )}
            {s.phase === "downloading" && (
              <>
                <strong>Downloading Polar {s.version}…</strong>
                <span>{s.progress == null ? "Starting" : `${Math.round(s.progress * 100)}%`} · keep watching, it's in the background</span>
                <span className="update-progress" aria-hidden>
                  <span style={{ transform: `scaleX(${s.progress ?? 0.04})` }} />
                </span>
              </>
            )}
            {s.phase === "ready" && (
              <>
                <strong>Polar {s.version} is ready</strong>
                <span>Restart to finish. It takes a few seconds and you'll be right back.</span>
              </>
            )}
            {s.phase === "installing" && (
              <>
                <strong>Installing Polar {s.version}…</strong>
                <span>Polar will reopen by itself.</span>
              </>
            )}
          </span>
          {(s.phase === "available" || s.phase === "ready") && s.notes && (
            <button className="btn btn-glass tv-prompt-go" onClick={() => setNotes(true)}>
              What's new
            </button>
          )}
          {s.phase === "available" && (
            <button className="btn btn-primary tv-prompt-go" onClick={() => void downloadUpdate()}>
              Update
            </button>
          )}
          {s.phase === "ready" && (
            <button className="btn btn-primary tv-prompt-go" onClick={() => void installUpdate()}>
              Restart now
            </button>
          )}
          {s.phase !== "installing" && (
            <button
              className="btn btn-icon"
              aria-label={s.phase === "ready" ? "Later" : "Dismiss"}
              title={s.phase === "ready" ? "Later — it'll wait in the top bar" : "Dismiss"}
              onClick={dismissUpdate}
            >
              <Close size={18} />
            </button>
          )}
        </div>
      )}
      <Sheet
        open={notes && "notes" in s}
        onClose={() => setNotes(false)}
        title={version ? `What's new in ${version}` : "What's new"}
      >
        <div className="whats-new">
          <ReleaseNotes text={"notes" in s ? s.notes : ""} />
          <a className="whats-new-link" href={releaseUrl(version ?? undefined)} onClick={openExternally}>
            Full release notes
          </a>
        </div>
      </Sheet>
    </>
  );
}

/**
 * Left in the top bar once the toast is closed, so an update is never lost:
 * "Update" while it's available, "Restart to update" once it's downloaded.
 */
export function UpdatePill() {
  const s = useUpdate();
  const dismissed = useUpdateDismissed();
  if (!("version" in s) || dismissed !== s.version) return null;
  if (s.phase === "available")
    return (
      <button className="navbar-update pressable" onClick={() => void downloadUpdate()} title={`Download Polar ${s.version}`}>
        <span className="navbar-update-dot" aria-hidden />
        Update
      </button>
    );
  if (s.phase === "downloading")
    return (
      <span className="navbar-update" data-busy title={`Downloading Polar ${s.version}`}>
        <span className="navbar-update-dot" aria-hidden />
        {s.progress == null ? "Updating…" : `${Math.round(s.progress * 100)}%`}
      </span>
    );
  if (s.phase === "ready")
    return (
      <button className="navbar-update pressable" onClick={() => void installUpdate()} title={`Install Polar ${s.version} and restart`}>
        <span className="navbar-update-dot" aria-hidden />
        Restart to update
      </button>
    );
  return null;
}

/** Once, on the first launch after an update: what changed. */
export function WhatsNewSheet() {
  const [info, setInfo] = useState<WhatsNew | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void takeWhatsNew().then((w) => {
      if (live && w) {
        setInfo(w);
        setOpen(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <Sheet
      open={open && !!info}
      onClose={() => setOpen(false)}
      title={`Updated to Polar ${info?.version ?? ""}`}
      subtitle={info ? `From ${info.previous}. Everything you had is still here.` : undefined}
    >
      <div className="whats-new">
        {info?.notes ? <ReleaseNotes text={info.notes} /> : <p>Fixes and improvements.</p>}
        <div className="whats-new-actions">
          <button className="btn btn-primary" onClick={() => setOpen(false)}>
            Got it
          </button>
          <a className="whats-new-link" href={releaseUrl(info?.version)} onClick={openExternally}>
            Full release notes
          </a>
        </div>
      </div>
    </Sheet>
  );
}

function openExternally(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  void api.openExternal(e.currentTarget.href);
}

/** Just enough Markdown for release notes: headings, bullets, **bold** and `code`. */
export function ReleaseNotes({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = line.match(/^#+\s+(.*)/);
    blocks.push(heading ? <h3 key={blocks.length}>{inline(heading[1])}</h3> : <p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="release-notes">{blocks}</div>;
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    part.startsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function UpdateIcon() {
  return (
    <svg className="tv-prompt-icon update-icon" viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v8M8.5 12.5 12 16l3.5-3.5" />
    </svg>
  );
}
