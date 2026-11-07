import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Anime } from "../../lib/anime";
import {
  changeEntry,
  fitScore,
  LIST_STATUSES,
  listClient,
  liveLink,
  removeEntry,
  scoreScale,
  SignedOut,
  useListLink,
  useSeenEntry,
  type EntryChange,
  type ListEntry,
  type ListService,
  type ScoreScale,
} from "../../lib/lists";
import { Check, ChevronDown, Minus, Plus, Trash } from "../icons";
import { buttonClass, IconButton } from "../ui/Button";
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { TextField } from "../ui/TextField";

/** The anime's entries on each list service the profile has linked (#83 AniList, #84 MyAnimeList). */
export function AnimeListPanels({ anime }: { anime: Anime }) {
  const mal = anime.idMal;
  return (
    <>
      <AnimeListPanel service="anilist" mediaId={anime.id} anime={anime} />
      {mal != null && Number.isSafeInteger(mal) && mal > 0 && <AnimeListPanel service="mal" mediaId={mal} anime={anime} />}
    </>
  );
}

/**
 * The anime's entry on the profile's linked list on `service`: status, progress and score, read
 * fresh from the service each time the page opens and changed here (through the profile's queue,
 * so a change made offline goes out later). Nothing when the profile hasn't linked the service.
 */
function AnimeListPanel({ service, mediaId, anime }: { service: ListService; mediaId: number; anime: Anime }) {
  const { space, link, state } = useListLink(service);
  const client = listClient(service);
  const qc = useQueryClient();
  const key = [service, "entry", space, link?.userId, mediaId];
  const fresh = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const live = await liveLink(service, space);
      if (!live) throw new SignedOut(client.name);
      return client.entryFor(live.userId, mediaId, { token: live.token, signal });
    },
    enabled: state === "linked",
    staleTime: 0,
    gcTime: 0,
    retry: (n, e) => !(e instanceof SignedOut) && n < 1,
    refetchOnWindowFocus: false,
  });
  const seen = useSeenEntry(service, mediaId);
  if (!link || state === "none" || state === undefined) return null;

  const title = <h2 className="t-title2 anime-section-title">Your {client.name}</h2>;
  if (state !== "linked" || fresh.error instanceof SignedOut) {
    return (
      <>
        {title}
        <p className="anime-list-note t-caption">
          The sign-in to {client.name} has run out. Sign in again in Settings → Services → {client.name}.
        </p>
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
  const change = (c: EntryChange) => qc.setQueryData(key, changeEntry(service, space, mediaId, entry, c));
  const remove = () => {
    removeEntry(service, space, mediaId);
    qc.setQueryData(key, null);
  };

  return (
    <>
      {title}
      <section className="anime-list" aria-label={`Your ${client.name} entry`}>
        <StatusPick entry={entry} names={client.statusNames} service={client.name} onPick={(status) => change({ status })} onRemove={remove} />
        {entry && (
          <>
            <Progress value={entry.progress} total={anime.episodes ?? null} onChange={(progress) => change({ progress })} />
            <Score id={`anime-list-score-${service}`} value={entry.score} scale={scoreScale(link.scoreFormat)} onChange={(score) => change({ score })} />
          </>
        )}
      </section>
      {service === "mal" && <p className="anime-list-note t-caption">Uses the MyAnimeList API.</p>}
      {fresh.isError && <p className="anime-list-note t-caption">Couldn't reach {client.name}: this is what this device saw last.</p>}
    </>
  );
}

function StatusPick({
  entry,
  names,
  service,
  onPick,
  onRemove,
}: {
  entry: ListEntry | null;
  names: Record<ListEntry["status"], string>;
  service: string;
  onPick: (s: ListEntry["status"]) => void;
  onRemove: () => void;
}) {
  return (
    <MenuRoot>
      <MenuTrigger className={buttonClass(entry ? "glass" : "primary")}>
        {entry ? names[entry.status] : "Add to list"}
        <ChevronDown size={16} />
      </MenuTrigger>
      <MenuPopup aria-label={`Status on ${service}`} align="start">
        {LIST_STATUSES.map((s) => (
          <MenuItem key={s} icon={<span className="menu-check">{entry?.status === s && <Check />}</span>} onClick={() => onPick(s)}>
            {names[s]}
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
function Score({ id, value, scale, onChange }: { id: string; value: number; scale: ScoreScale; onChange: (n: number) => void }) {
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
      <label className="t-caption" htmlFor={id}>
        Score
      </label>
      <div className="anime-list-stepper">
        <TextField
          id={id}
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
