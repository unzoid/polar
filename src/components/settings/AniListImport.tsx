import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { sync } from "../../lib/account";
import { api } from "../../lib/api";
import { listImportDeps, planListImport, previewList, SignedOut, wholeList, type Link, type ListChoice, type ListPreview } from "../../lib/lists";
import { keys } from "../../lib/net";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";

/**
 * Settings → Services → AniList → Import (#83): reads the linked account's anime list, says what it
 * holds, and adds what the user picks to the profile's library. Run as often as wanted: it only
 * adds, never removes, and what is already in the library stays as it is.
 */

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What the list holds: "12 shows and 3 films on your list, 140 episodes and films watched" and the adult entries left out. */
export function previewText(p: Pick<ListPreview, "shows" | "films" | "watched" | "adult">) {
  const parts = [p.shows && count(p.shows, "show"), p.films && count(p.films, "film")].filter(Boolean);
  const watched = p.films ? count(p.watched, "episode or film", "episodes and films") : count(p.watched, "episode");
  const what = parts.length ? `${parts.join(" and ")} on your list, ${watched} watched` : "Your list is empty";
  return p.adult ? `${what}. ${count(p.adult, "adult entry", "adult entries")} left out: your AniList account hides them.` : `${what}.`;
}

export interface ImportSummary {
  library: number;
  progress: number;
  unlinked: number;
  unmatched: number;
}

export function summaryText(s: ImportSummary) {
  const added = `Added ${count(s.library, "title")} to your library and ${count(s.progress, "watched episode")}.`;
  const skipped = [
    s.unlinked && `${count(s.unlinked, "entry", "entries")} Polarity can't play from`,
    s.unmatched && `the watched episodes of ${count(s.unmatched, "entry", "entries")} that couldn't all be matched`,
  ].filter(Boolean);
  return skipped.length ? `${added} Skipped ${skipped.join(" and ")}.` : added;
}

export function AniListImport({ link }: { link: Link }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ListPreview | null>(null);
  const [choice, setChoice] = useState<ListChoice>({ library: true, watched: true });
  const [step, setStep] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null;

  const fail = (e: unknown) =>
    setError(
      e instanceof SignedOut
        ? "AniList no longer accepts this sign-in. Unlink, then sign in again."
        : "Couldn't read your AniList list. Check your connection.",
    );

  const read = async () => {
    setError(null);
    setSummary(null);
    setStep("Reading your list…");
    try {
      setPreview(previewList(await wholeList(link.userId, { token: link.token }), link.adult));
    } catch (e) {
      fail(e);
    } finally {
      setStep(null);
    }
  };

  const run = async () => {
    if (!preview) return;
    setError(null);
    setStep(`Matching… 0 of ${preview.entries.length}`);
    try {
      const plan = await planListImport(
        preview.entries,
        choice,
        listImportDeps((n, of) => setStep(`Matching… ${n} of ${of}`)),
      );
      setStep("Importing…");
      const added = await api.importLibrary(plan.library, plan.progress);
      for (const key of [keys.library, keys.progressAll, keys.continue, keys.history]) void qc.invalidateQueries({ queryKey: key });
      sync.schedule();
      setSummary(summaryText({ ...added, unlinked: plan.unlinked, unmatched: plan.unmatched }));
      setPreview(null);
    } catch {
      setError("Couldn't import the list. Try again.");
    } finally {
      setStep(null);
    }
  };

  const empty = preview && !preview.entries.length;
  const nothing = !choice.library && !(choice.watched && preview?.watched);
  return (
    <>
      <p className="settings-expand-text">
        {preview
          ? previewText(preview)
          : "Add the anime on your AniList list to your library, and mark the episodes you've watched. Nothing is removed, and importing again adds only what's new."}
      </p>
      {preview && !empty && (
        <>
          <label className="settings-expand-toggle">
            <span>Add to library</span>
            <Switch checked={choice.library} disabled={busy} onChange={(on) => setChoice((c) => ({ ...c, library: on }))} />
          </label>
          <label className="settings-expand-toggle">
            <span>Mark watched episodes</span>
            <Switch
              checked={choice.watched && !!preview.watched}
              disabled={busy || !preview.watched}
              onChange={(on) => setChoice((c) => ({ ...c, watched: on }))}
            />
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
            {busy ? "Reading…" : "Import List…"}
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
