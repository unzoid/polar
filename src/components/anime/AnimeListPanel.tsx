import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Anime } from "../../lib/anime";
import {
  changeEntry,
  entryFor,
  fitScore,
  LIST_STATUSES,
  removeEntry,
  scoreScale,
  SignedOut,
  STATUS_NAMES,
  useAniListLink,
  useSeenEntry,
  type EntryChange,
  type ListEntry,
  type ScoreScale,
} from "../../lib/lists";
import { Check, ChevronDown, Minus, Plus, Trash } from "../icons";
import { buttonClass, IconButton } from "../ui/Button";
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { TextField } from "../ui/TextField";

/**
 * The anime's entry on the profile's linked AniList list (#83): status, progress and score, read
 * fresh from AniList each time the page opens and changed here (through the profile's queue, so a
 * change made offline goes out later). Nothing when the profile hasn't linked AniList.
 */
export function AnimeListPanel({ anime }: { anime: Anime }) {
  const { space, link, state } = useAniListLink();
  const qc = useQueryClient();
  const key = ["anilist", "entry", space, link?.userId, anime.id];
  const fresh = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => entryFor(link!.userId, anime.id, { token: link!.token, signal }),
    enabled: state === "linked",
    staleTime: 0,
    gcTime: 0,
    retry: (n, e) => !(e instanceof SignedOut) && n < 1,
    refetchOnWindowFocus: false,
  });
  const seen = useSeenEntry(anime.id);
  if (!link || state === "none" || state === undefined) return null;

  const title = <h2 className="t-title2 anime-section-title">Your AniList</h2>;
  if (state !== "linked" || fresh.error instanceof SignedOut) {
    return (
      <>
        {title}
        <p className="anime-list-note t-caption">The sign-in to AniList has run out. Sign in again in Settings → Services → AniList.</p>
      </>
    );
  }
  if (fresh.isPending && !seen) {
    return (
      <>
        {title}
        <p className="anime-list-note t-caption">Reading your list…</p>
      </>
    );
  }
  const entry: ListEntry | null = fresh.isSuccess ? fresh.data : (seen ?? null);
  const change = (c: EntryChange) => qc.setQueryData(key, changeEntry(space, anime.id, entry, c));
  const remove = () => {
    removeEntry(space, anime.id);
    qc.setQueryData(key, null);
  };

  return (
    <>
      {title}
      <section className="anime-list" aria-label="Your AniList entry">
        <StatusPick entry={entry} onPick={(status) => change({ status })} onRemove={remove} />
        {entry && (
          <>
            <Progress value={entry.progress} total={anime.episodes ?? null} onChange={(progress) => change({ progress })} />
            <Score value={entry.score} scale={scoreScale(link.scoreFormat)} onChange={(score) => change({ score })} />
          </>
        )}
      </section>
      {fresh.isError && <p className="anime-list-note t-caption">Couldn't reach AniList: this is what this device saw last.</p>}
    </>
  );
}

function StatusPick({ entry, onPick, onRemove }: { entry: ListEntry | null; onPick: (s: ListEntry["status"]) => void; onRemove: () => void }) {
  return (
    <MenuRoot>
      <MenuTrigger className={buttonClass(entry ? "glass" : "primary")}>
        {entry ? STATUS_NAMES[entry.status] : "Add to list"}
        <ChevronDown size={16} />
      </MenuTrigger>
      <MenuPopup aria-label="Status on AniList" align="start">
        {LIST_STATUSES.map((s) => (
          <MenuItem key={s} icon={<span className="menu-check">{entry?.status === s && <Check />}</span>} onClick={() => onPick(s)}>
            {STATUS_NAMES[s]}
          </MenuItem>
        ))}
        {entry && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Trash size={15} />} onClick={onRemove}>
              Remove from list
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </MenuRoot>
  );
}

function Progress({ value, total, onChange }: { value: number; total: number | null; onChange: (n: number) => void }) {
  return (
    <div className="anime-list-field">
      <span className="t-caption">Episodes</span>
      <div className="anime-list-stepper">
        <IconButton label="One episode fewer" disabled={value <= 0} onClick={() => onChange(value - 1)}>
          <Minus size={16} />
        </IconButton>
        <span className="tabular">
          {value}
          {total ? ` / ${total}` : ""}
        </span>
        <IconButton label="One episode more" disabled={total != null && total > 0 && value >= total} onClick={() => onChange(value + 1)}>
          <Plus size={16} />
        </IconButton>
      </div>
    </div>
  );
}

/** The score in the account's own format: a pick for symbols (stars, smileys), else a number. */
function Score({ value, scale, onChange }: { value: number; scale: ScoreScale; onChange: (n: number) => void }) {
  const [typed, setTyped] = useState(value ? String(value) : "");
  useEffect(() => setTyped(value ? String(value) : ""), [value]);
  const { labels } = scale;
  if (labels) {
    return (
      <div className="anime-list-field">
        <span className="t-caption">Score</span>
        <MenuRoot>
          <MenuTrigger className={buttonClass("glass")}>
            {value ? labels[value - 1] : "Not scored"}
            <ChevronDown size={16} />
          </MenuTrigger>
          <MenuPopup aria-label="Score" align="start">
            {[0, ...labels.map((_, i) => i + 1)].map((n) => (
              <MenuItem key={n} icon={<span className="menu-check">{value === n && <Check />}</span>} onClick={() => onChange(n)}>
                {n ? labels[n - 1] : "Not scored"}
              </MenuItem>
            ))}
          </MenuPopup>
        </MenuRoot>
      </div>
    );
  }
  // Enter or leaving the field saves it.
  const commit = () => {
    const n = typed.trim() ? fitScore(Number(typed), scale) : 0;
    if (n === null || n === value) return setTyped(value ? String(value) : "");
    onChange(n);
  };
  return (
    <form
      className="anime-list-field"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <label className="t-caption" htmlFor="anime-list-score">
        Score
      </label>
      <div className="anime-list-stepper">
        <TextField
          id="anime-list-score"
          className="anime-list-score"
          inputMode="decimal"
          placeholder="–"
          value={typed}
          onChange={setTyped}
          onBlur={commit}
          autoComplete="off"
        />
        <span className="t-caption tabular">/ {scale.max}</span>
      </div>
    </form>
  );
}
