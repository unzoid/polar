import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { sync } from "../../lib/account";
import { errorMessage } from "../../lib/errors";
import {
  matchFilm,
  planLetterboxdImport,
  readLetterboxdFiles,
  yearOf,
  type LetterboxdChoice,
  type LetterboxdExport,
  type LetterboxdFilm,
} from "../../lib/library";
import { concurrency, keys } from "../../lib/net";
import type { MetaPreview } from "../../lib/types";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { ActionRow, Card, RowText, ToggleRow } from "./rows";

/**
 * Settings → Account → Import from Letterboxd (#87): reads the ZIP Letterboxd exports (or its CSV
 * files) on this device, finds each film by title and year in Polarity's catalog, imports the ones
 * found, and lists the rest for the user to pick or skip. Nothing is fetched from Letterboxd.
 */

interface Preview {
  exp: LetterboxdExport;
  watchlist: number;
  watched: number;
  ratings: number;
}

interface Summary {
  library: number;
  progress: number;
  /** Films found without asking. */
  found: number;
  ratings: number;
  unreadable: number;
}

/** A film the catalog couldn't settle, with what it offered. */
interface ToPick {
  film: LetterboxdFilm;
  choices: MetaPreview[];
}

/** Searches running at once: a few a second, as Cinemeta publishes no limit. */
const SEARCHES = 2;
/** Films to pick shown at a time. */
const PAGE = 20;

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const titled = (name: string, year?: number) => (year ? `${name} (${year})` : name);

export const RATINGS_NOTE = "Ratings aren't imported: Polarity has no ratings of its own.";

/** The films the choices bring in: on the watchlist, or watched. */
export function chosenFilms(films: LetterboxdFilm[], choice: LetterboxdChoice): LetterboxdFilm[] {
  return films.filter((f) => (choice.watchlist && f.watchlistAt !== undefined) || (choice.watched && f.watchedAt !== undefined));
}

function preview(exp: LetterboxdExport): Preview {
  return {
    exp,
    watchlist: exp.films.filter((f) => f.watchlistAt !== undefined).length,
    watched: exp.films.filter((f) => f.watchedAt !== undefined).length,
    ratings: exp.films.filter((f) => f.rating !== undefined).length,
  };
}

export function LetterboxdImport() {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<LetterboxdChoice>({ watchlist: true, watched: true });
  const [step, setStep] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [toPick, setToPick] = useState<ToPick[]>([]);
  const [shown, setShown] = useState(PAGE);
  // The choices the import ran with, which picks made afterwards follow.
  const [ran, setRan] = useState<LetterboxdChoice>(choice);

  const refresh = () => {
    for (const key of [keys.library, keys.progressAll, keys.continue, keys.history]) qc.invalidateQueries({ queryKey: key });
    sync.schedule();
  };

  const read = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setError(null);
    setSummary(null);
    setToPick([]);
    try {
      setLoaded(preview(await readLetterboxdFiles(files.map((f) => ({ name: f.name, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) })))));
    } catch (e) {
      setLoaded(null);
      setError(errorMessage(e));
    }
  };

  const run = async () => {
    if (!loaded) return;
    setError(null);
    try {
      const films = chosenFilms(loaded.exp.films, choice);
      const matched = new Map<string, MetaPreview>();
      const rest: ToPick[] = [];
      const search = concurrency(SEARCHES);
      let done = 0;
      setStep(`Finding films… 0 of ${films.length.toLocaleString()}`);
      await Promise.all(
        films.map((film) =>
          search(async () => {
            const m = await matchFilm(film, api.searchMovies).catch(() => ({ choose: [] }));
            if ("found" in m) matched.set(film.key, m.found);
            else rest.push({ film, choices: m.choose });
            setStep(`Finding films… ${(++done).toLocaleString()} of ${films.length.toLocaleString()}`);
          }),
        ),
      );
      setStep("Importing…");
      const plan = planLetterboxdImport(films, matched, choice);
      const added = await api.importLibrary(plan.library, plan.progress);
      refresh();
      const order = new Map(films.map((f, i) => [f.key, i]));
      setToPick(rest.sort((a, b) => order.get(a.film.key)! - order.get(b.film.key)!));
      setShown(PAGE);
      setRan(choice);
      setSummary({ ...added, found: matched.size, ratings: loaded.ratings, unreadable: loaded.exp.unreadable });
      setLoaded(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStep(null);
    }
  };

  /** Imports one film the user picked, and takes it off the list. */
  const pick = async (item: ToPick, film: MetaPreview) => {
    const plan = planLetterboxdImport([item.film], new Map([[item.film.key, film]]), ran);
    const added = await api.importLibrary(plan.library, plan.progress);
    refresh();
    setSummary((s) => s && { ...s, library: s.library + added.library, progress: s.progress + added.progress });
    setToPick((list) => list.filter((x) => x !== item));
  };
  const skip = (item: ToPick) => setToPick((list) => list.filter((x) => x !== item));

  const busy = step != null;
  const films = loaded ? chosenFilms(loaded.exp.films, choice).length : 0;

  return (
    <>
      <Card
        title="Import from Letterboxd"
        footer="Your watchlist and the films you've watched, from the ZIP Letterboxd lets you export in its settings. It's read on this device and films are found by title and year; nothing is sent to Letterboxd. Nothing newer here is replaced, and importing the same file again adds nothing."
      >
        <ActionRow
          setting="letterboxdImport"
          title={loaded ? "Export read" : "Export file"}
          caption={loaded ? count(loaded.exp.films.length, "film") : "The .zip from Letterboxd, or its .csv files"}
          label="Choose File…"
          disabled={busy}
          onClick={() => file.current?.click()}
        />
        <input
          ref={file}
          type="file"
          accept=".zip,.csv,application/zip,text/csv"
          multiple
          hidden
          onChange={(e) => {
            void read(e.target.files);
            e.target.value = "";
          }}
        />
        {loaded && (
          <>
            <ToggleRow
              title="Watchlist"
              caption={`${count(loaded.watchlist, "film")}, added to your library`}
              checked={choice.watchlist && !!loaded.watchlist}
              disabled={busy || !loaded.watchlist}
              onChange={(v) => setChoice((c) => ({ ...c, watchlist: v }))}
            />
            <ToggleRow
              title="Watched"
              caption={`${count(loaded.watched, "film")}, marked watched`}
              checked={choice.watched && !!loaded.watched}
              disabled={busy || !loaded.watched}
              onChange={(v) => setChoice((c) => ({ ...c, watched: v }))}
            />
            {!!loaded.ratings && (
              <div className="settings-row">
                <RowText title="Ratings" caption={`${count(loaded.ratings, "film")}. ${RATINGS_NOTE}`} />
              </div>
            )}
            <ActionRow
              title={films ? `Find and import ${count(films, "film")}` : "Nothing chosen to import"}
              caption={step ?? "Films are looked up one by one; a large export takes a while."}
              label="Import"
              variant="primary"
              disabled={!films}
              pending={busy}
              pendingLabel="Importing…"
              onClick={() => void run()}
            />
          </>
        )}
        {error && <p className="settings-error settings-card-pad">{error}</p>}
        {summary && (
          <div className="settings-row">
            <RowText title="Imported" caption={describe(summary, toPick.length)} />
          </div>
        )}
      </Card>

      {toPick.length > 0 && (
        <Card
          title="Films to pick"
          footer="These matched no film, or more than one, by title and year. Pick the right one, search again, or skip it."
        >
          {toPick.slice(0, shown).map((item) => (
            <PickRow key={item.film.key} item={item} onPick={(m) => pick(item, m)} onSkip={() => skip(item)} />
          ))}
          {toPick.length > shown && (
            <ActionRow title={`${count(toPick.length - shown, "more film")}`} label="Show More" onClick={() => setShown((n) => n + PAGE)} />
          )}
        </Card>
      )}
    </>
  );
}

/** One film to pick: what the catalog offered, a search of its own, and Skip. */
function PickRow({ item, onPick, onSkip }: { item: ToPick; onPick: (m: MetaPreview) => Promise<void>; onSkip: () => void }) {
  const [choices, setChoices] = useState(item.choices);
  const [query, setQuery] = useState(item.film.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const caption = [
    item.film.watchlistAt !== undefined && "On your watchlist",
    item.film.watchedAt !== undefined && "Watched",
    choices.length ? count(choices.length, "possible film") : "No film found",
  ].filter((x): x is string => !!x);
  return (
    <div className="settings-row settings-pick">
      <RowText title={titled(item.film.name, item.film.year)} caption={caption.join(" · ")} />
      {choices.length > 0 && (
        <div className="settings-expand-actions settings-pick-choices">
          {choices.map((m) => (
            <Button key={m.id} variant="outline" size="sm" disabled={busy} onClick={() => void act(() => onPick(m))}>
              {titled(m.name, yearOf(m.releaseInfo))}
            </Button>
          ))}
        </div>
      )}
      <form
        className="settings-expand-form"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim();
          if (q && !busy) void act(async () => setChoices((await api.searchMovies(q)).filter((m) => /^tt\d+$/.test(m.id)).slice(0, 5)));
        }}
      >
        <TextField value={query} onChange={setQuery} aria-label={`Search for ${item.film.name}`} spellCheck={false} />
        <Button variant="outline" size="sm" disabled={busy || !query.trim()}>
          Search
        </Button>
        <Button type="button" variant="plain" size="sm" disabled={busy} onClick={onSkip}>
          Skip
        </Button>
      </form>
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}

function describe(s: Summary, left: number) {
  const parts = [`Found ${count(s.found, "film")}: added ${count(s.library, "film")} to your library and marked ${count(s.progress, "film")} watched.`];
  if (left) parts.push(`${count(left, "film")} to pick below.`);
  if (s.unreadable) parts.push(`Skipped ${count(s.unreadable, "row")} without a title.`);
  if (s.ratings) parts.push(RATINGS_NOTE);
  return parts.join(" ");
}
