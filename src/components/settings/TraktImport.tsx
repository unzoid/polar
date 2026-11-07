import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { sync } from "../../lib/account";
import { api } from "../../lib/api";
import { keys } from "../../lib/net";
import { liveTraktLink, planTraktImport, readTraktImport, TraktSignedOut, type TraktImportChoice, type TraktImportPreview } from "../../lib/trakt";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";

/**
 * Settings → Services → Trakt → Import (#85): reads the linked account's watchlist and what was
 * watched there, says what it holds, and adds what the user picks to the profile's library. Run as
 * often as wanted: it only adds, never removes, and what is already in the library stays as it is.
 */

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What the account holds: "4 films and 2 shows on your watchlist. 12 films and 140 episodes watched." */
export function traktPreviewText(p: Pick<TraktImportPreview, "listedFilms" | "listedShows" | "watchedFilms" | "watchedEpisodes" | "unlinked">) {
  const listed = [p.listedFilms && count(p.listedFilms, "film"), p.listedShows && count(p.listedShows, "show")].filter(Boolean);
  const watched = [p.watchedFilms && count(p.watchedFilms, "film"), p.watchedEpisodes && count(p.watchedEpisodes, "episode")].filter(Boolean);
  const parts = [
    listed.length ? `${listed.join(" and ")} on your watchlist.` : "Your watchlist is empty.",
    watched.length ? `${watched.join(" and ")} watched.` : "Nothing watched yet.",
  ];
  if (p.unlinked) parts.push(`${count(p.unlinked, "title")} without an IMDb page left out.`);
  return parts.join(" ");
}

export function traktSummaryText(added: { library: number; progress: number }) {
  return `Added ${count(added.library, "title")} to your library and ${count(added.progress, "watched film or episode", "watched films and episodes")}.`;
}

export function TraktImport({ space }: { space: string | null }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<TraktImportPreview | null>(null);
  const [choice, setChoice] = useState<TraktImportChoice>({ library: true, watched: true });
  const [step, setStep] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null;

  const read = async () => {
    setError(null);
    setSummary(null);
    setStep("Reading your Trakt account…");
    try {
      const live = await liveTraktLink(space);
      if (!live) throw new TraktSignedOut();
      setPreview(await readTraktImport(live.token));
    } catch (e) {
      setError(e instanceof TraktSignedOut ? "Trakt no longer accepts this sign-in. Unlink, then sign in again." : "Couldn't read your Trakt account. Check your connection.");
    } finally {
      setStep(null);
    }
  };

  const run = async () => {
    if (!preview) return;
    setError(null);
    setStep("Importing…");
    try {
      const plan = planTraktImport(preview, choice);
      const added = await api.importLibrary(plan.library, plan.progress);
      for (const key of [keys.library, keys.progressAll, keys.continue, keys.history]) void qc.invalidateQueries({ queryKey: key });
      sync.schedule();
      setSummary(traktSummaryText(added));
      setPreview(null);
    } catch {
      setError("Couldn't import from Trakt. Try again.");
    } finally {
      setStep(null);
    }
  };

  const listed = preview ? preview.library.length : 0;
  const watched = preview ? preview.progress.length : 0;
  const empty = preview && !listed && !watched;
  const nothing = !(choice.library && listed) && !(choice.watched && watched);
  return (
    <>
      <p className="settings-expand-text">
        {preview
          ? traktPreviewText(preview)
          : "Add your Trakt watchlist to your library, and mark the films and episodes you've watched on Trakt. Nothing is removed, and importing again adds only what's new."}
      </p>
      {preview && !empty && (
        <>
          <label className="settings-expand-toggle">
            <span>Add the watchlist to the library</span>
            <Switch checked={choice.library && !!listed} disabled={busy || !listed} onChange={(on) => setChoice((c) => ({ ...c, library: on }))} />
          </label>
          <label className="settings-expand-toggle">
            <span>Mark watched films and episodes</span>
            <Switch checked={choice.watched && !!watched} disabled={busy || !watched} onChange={(on) => setChoice((c) => ({ ...c, watched: on }))} />
          </label>
        </>
      )}
      <div className="settings-expand-form">
        {preview && !empty ? (
          <Button variant="primary" disabled={busy || nothing} onClick={() => void run()}>
            {busy ? "Importing…" : "Import"}
          </Button>
        ) : (
          <Button variant="glass" disabled={busy} onClick={() => void read()}>
            {busy ? "Reading…" : "Import from Trakt…"}
          </Button>
        )}
      </div>
      {step && (
        <p className="settings-expand-text" role="status">
          {step}
        </p>
      )}
      {summary && (
        <p className="settings-expand-text" role="status">
          {summary}
        </p>
      )}
      {error && <p className="settings-expand-text settings-error">{error}</p>}
    </>
  );
}
