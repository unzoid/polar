import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { linkHasKey, sync } from "../../lib/account";
import { useKeyGate } from "./KeyWarning";
import { errorMessage } from "../../lib/errors";
import { needsMeta, parseStremioExport, planImport, watchedCount, type ImportChoice, type Skipped, type StremioExport } from "../../lib/library";
import { concurrency, keys, useAddons } from "../../lib/net";
import type { Meta } from "../../lib/types";
import { ActionRow, Card, RowText, ToggleRow } from "./rows";

/**
 * Settings → Account → Import from Stremio (#12): reads the JSON file Stremio exports, shows what it
 * holds, and imports what the user ticks. Add-ons are only listed; each is installed only if ticked.
 */

interface Preview {
  exp: StremioExport;
  library: number;
  libraryMovies: number;
  resume: number;
  movies: number;
  episodes: number;
}

interface Summary {
  library: number;
  progress: number;
  addons: number;
  addonsFailed: number;
  unmatched: number;
  skipped: Skipped;
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const and = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** Why titles in the file can't be imported, so a 0 can be explained ("2 titles from other catalogs"). */
export function skippedText(s: Skipped): string | undefined {
  const parts = [
    s.ids && `${count(s.ids, "title")} from other catalogs (not IMDb or Kitsu ids)`,
    s.types && `${count(s.types, "item")} that aren't movies or shows`,
    s.unreadable && `${count(s.unreadable, "entry", "entries")} without an id`,
  ].filter((p): p is string => !!p);
  return parts.length ? and(parts) : undefined;
}

/** What the Import button will do with the choices made: "Import 1 movie, 2 shows, 1 title in progress and 2 add-ons". */
export function planText(p: Omit<Preview, "exp">, choice: ImportChoice, addons: number): string {
  const shows = p.library - p.libraryMovies;
  const parts = [
    choice.library && p.libraryMovies && count(p.libraryMovies, "movie"),
    choice.library && shows && count(shows, "show"),
    choice.resume && p.resume && `${count(p.resume, "title")} in progress`,
    choice.watched && p.movies && count(p.movies, "watched movie"),
    choice.watched && p.episodes && count(p.episodes, "watched episode"),
    addons && count(addons, "add-on"),
  ].filter((x): x is string => !!x);
  return parts.length ? `Import ${and(parts)}` : "Nothing chosen to import";
}

async function preview(text: string, installed: string[]): Promise<Preview> {
  const exp = parseStremioExport(text, installed);
  const episodes = await Promise.all(exp.items.map((i) => (i.watched ? watchedCount(i.watched) : 0)));
  return {
    exp,
    library: exp.items.filter((i) => i.inLibrary).length,
    libraryMovies: exp.items.filter((i) => i.inLibrary && i.type === "movie").length,
    resume: exp.items.filter((i) => i.resume).length,
    movies: exp.items.filter((i) => i.watchedMovie).length,
    episodes: episodes.reduce((a, b) => a + b, 0),
  };
}

export function StremioImport() {
  const qc = useQueryClient();
  const { data: addons } = useAddons();
  const file = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ImportChoice>({ library: true, resume: true, watched: true });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const gate = useKeyGate();

  const read = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setSummary(null);
    setPicked(new Set());
    try {
      const installed = (addons ?? []).flatMap((a) => [a.manifest.id, a.manifestUrl]);
      setLoaded(await preview(await f.text(), installed));
    } catch (e) {
      setLoaded(null);
      setError(errorMessage(e));
    }
  };

  const run = async () => {
    if (!loaded) return;
    setError(null);
    try {
      const shows = needsMeta(loaded.exp.items, choice);
      const metas = new Map<string, Meta | null>();
      const lookup = concurrency(4);
      let done = 0;
      setStep(`Reading shows… 0 of ${shows.length}`);
      await Promise.all(
        shows.map((s) =>
          lookup(async () => {
            metas.set(s.id, await api.meta(s.type, s.id).catch(() => null));
            setStep(`Reading shows… ${++done} of ${shows.length}`);
          }),
        ),
      );
      setStep("Importing…");
      const plan = await planImport(loaded.exp, metas, choice);
      const added = await api.importLibrary(plan.library, plan.progress);
      let installed = 0;
      let failed = 0;
      for (const addon of loaded.exp.addons.filter((a) => picked.has(a.id))) {
        setStep(`Installing ${addon.name}…`);
        await api.installAddon(addon.url).then(
          () => installed++,
          () => failed++,
        );
      }
      for (const key of [keys.library, keys.progressAll, keys.continue, keys.history, keys.addons, keys.streamsAll]) qc.invalidateQueries({ queryKey: key });
      sync.schedule();
      setSummary({ ...added, addons: installed, addonsFailed: failed, unmatched: plan.unmatched, skipped: loaded.exp.skipped });
      setLoaded(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStep(null);
    }
  };

  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const busy = step != null;
  const nothing = loaded && !(choice.library && loaded.library) && !(choice.resume && loaded.resume) && !(choice.watched && (loaded.movies || loaded.episodes)) && !picked.size;
  const skipped = loaded && skippedText(loaded.exp.skipped);
  const offered = loaded?.exp.addons ?? [];
  const all = offered.length > 0 && offered.every((a) => picked.has(a.id));

  return (
    <>
      <Card
        title="Import from Stremio"
        footer="Your library, where you left off and what you've watched, from the file Stremio exports. Nothing newer here is replaced, and importing the same file again adds nothing."
      >
        <ActionRow
          setting="stremioImport"
          title={loaded ? "Export file read" : "Export file"}
          caption={loaded ? `${count(loaded.exp.items.length, "title")} Polarity can show` : "A .json file exported from Stremio"}
          label="Choose File…"
          disabled={busy}
          onClick={() => file.current?.click()}
        />
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {loaded && (
          <>
            <ToggleRow
              title="Library"
              caption={count(loaded.library, "title")}
              checked={choice.library && !!loaded.library}
              disabled={busy || !loaded.library}
              onChange={(v) => setChoice((c) => ({ ...c, library: v }))}
            />
            <ToggleRow
              title="Where you left off"
              caption={`${count(loaded.resume, "title")} in progress`}
              checked={choice.resume && !!loaded.resume}
              disabled={busy || !loaded.resume}
              onChange={(v) => setChoice((c) => ({ ...c, resume: v }))}
            />
            <ToggleRow
              title="Watched"
              caption={`${count(loaded.movies, "movie")} · ${count(loaded.episodes, "episode")}`}
              checked={choice.watched && !!(loaded.movies || loaded.episodes)}
              disabled={busy || !(loaded.movies || loaded.episodes)}
              onChange={(v) => setChoice((c) => ({ ...c, watched: v }))}
            />
            {skipped && (
              <div className="settings-row">
                <RowText title="Not imported" caption={`${skipped}: Polarity can't show these.`} />
              </div>
            )}
          </>
        )}
        {!loaded && error && <p className="settings-error">{error}</p>}
        {summary && (
          <div className="settings-row">
            <RowText title="Imported" caption={describe(summary)} />
          </div>
        )}
      </Card>

      {loaded && !!offered.length && (
        <Card
          title="Add-ons in the file"
          footer="Installed only if you turn them on. Their links can hold your own keys or settings: after installing, they sync like the add-ons you add yourself."
        >
          <ToggleRow title="All add-ons" caption={count(offered.length, "add-on")} checked={all} disabled={busy} onChange={(v) => setPicked(new Set(v ? offered.map((a) => a.id) : []))} />
          {offered.map((a) => (
            <ToggleRow
              key={a.id}
              title={a.name}
              caption={linkHasKey(a.url) ? `${a.description ? `${a.description} · ` : ""}This link contains a key` : a.description}
              checked={picked.has(a.id)} disabled={busy} onChange={(v) => toggle(a.id, v)} />
          ))}
        </Card>
      )}

      {loaded && (
        <Card footer="Shows are looked up one by one to match their episodes.">
          <ActionRow
            title={planText(loaded, choice, picked.size)}
            caption={step ?? undefined}
            label="Import"
            variant="primary"
            disabled={!!nothing}
            pending={busy}
            pendingLabel="Importing…"
            onClick={() => gate.guard(offered.some((a) => picked.has(a.id) && linkHasKey(a.url)) ? "link" : null, () => void run())}
          />
          {gate.warning}
          {error && <p className="settings-error">{error}</p>}
        </Card>
      )}
    </>
  );
}

function describe(s: Summary) {
  const added = [`Added ${count(s.library, "title")} to your library and ${count(s.progress, "progress entry", "progress entries")}`];
  if (s.addons) added.push(`installed ${count(s.addons, "add-on")}`);
  const skipped = [
    skippedText(s.skipped),
    s.unmatched && `the watched episodes of ${count(s.unmatched, "show")} that couldn't be matched`,
    s.addonsFailed && `${count(s.addonsFailed, "add-on")} that didn't answer`,
  ].filter(Boolean);
  return `${added.join(", ")}.${skipped.length ? ` Skipped ${skipped.join(", ")}.` : ""}`;
}
