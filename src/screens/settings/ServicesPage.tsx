import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "../../components/ui/Switch";
import { TextField } from "../../components/ui/TextField";
import { Grid, Picture, Star } from "../../components/icons";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { keys, useSettings } from "../../lib/net";
import type { Settings as SettingsT } from "../../lib/types";
import { Button } from "../../components/ui/Button";
import { Card, ExpandRow, FormRow, useExpanded, type Expandable } from "../../components/settings/rows";
import { useSecretsNote } from "../../components/settings/secretsNote";
import { useKeyGate, type KeyKind } from "../../components/settings/KeyWarning";

/** Which warning a save needs: one for each key it sets that wasn't set to that before. */
function added(pairs: [next: string, before: string | null | undefined][]): KeyKind | null {
  const n = pairs.filter(([next, before]) => next && next !== (before ?? "")).length;
  return n === 0 ? null : n === 1 ? "key" : "keys";
}

export function ServicesPage() {
  const expand = useExpanded();
  const note = useSecretsNote();
  return (
    <Card footer={note}>
      <ArtworkRow {...expand("artwork")} />
      <RatingsRow {...expand("ratings")} />
      <PreviewsRow {...expand("previews")} />
    </Card>
  );
}

/** Rotten Tomatoes, Metacritic and Letterboxd scores, from MDBList and/or OMDb. */
function RatingsRow(props: Expandable) {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [mdb, setMdb] = useState("");
  const [omdb, setOmdb] = useState("");
  useEffect(() => setMdb(data?.mdblistKey ?? ""), [data?.mdblistKey]);
  useEffect(() => setOmdb(data?.omdbKey ?? ""), [data?.omdbKey]);
  const save = useSaveSettings(() => qc.invalidateQueries({ queryKey: keys.ratingsAll }));
  const gate = useKeyGate();
  if (!data) return null;
  const on = !!(data.mdblistKey || data.omdbKey);
  const dirty = mdb.trim() !== (data.mdblistKey ?? "") || omdb.trim() !== (data.omdbKey ?? "");

  return (
    <ExpandRow
      icon={Star}
      title="Critic and audience scores"
      caption="Rotten Tomatoes, Metacritic and Letterboxd scores on title pages, with a free key"
      value={on ? "On" : "Off"}
      {...props}
    >
      <p className="settings-expand-text">
        A free key from <strong>mdblist.com</strong> (Preferences → API) adds Rotten Tomatoes, its audience score,
        Metacritic, Letterboxd and Trakt. A free key from <strong>omdbapi.com</strong> adds Rotten Tomatoes and
        Metacritic. Either works; with both, OMDb fills any gaps.
      </p>
      <form
        className="settings-expand-form settings-expand-form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const [m, o] = [mdb.trim(), omdb.trim()];
          gate.guard(
            added([
              [m, data.mdblistKey],
              [o, data.omdbKey],
            ]),
            () => save.mutate({ mdblistKey: m || null, omdbKey: o || null }),
          );
        }}
      >
        <TextField
          type="password"
          placeholder="MDBList key"
          aria-label="MDBList key"
          value={mdb}
          onChange={setMdb}
          spellCheck={false}
          autoComplete="off"
        />
        <TextField
          type="password"
          placeholder="OMDb key"
          aria-label="OMDb key"
          value={omdb}
          onChange={setOmdb}
          spellCheck={false}
          autoComplete="off"
        />
        <Button variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </form>
      {gate.warning}
    </ExpandRow>
  );
}

/** Saves typed settings and refreshes whatever depends on them. */
function useSaveSettings(after?: () => void) {
  const qc = useQueryClient();
  const { data } = useSettings();
  return useMutation({
    mutationFn: (patch: Partial<SettingsT>) => api.saveSettings({ ...data!, ...patch }),
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      after?.();
    },
  });
}

function ArtworkRow(props: Expandable) {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [key, setKey] = useState("");
  useEffect(() => setKey(data?.tmdbKey ?? ""), [data?.tmdbKey]);
  // A new data source means every cached catalog is stale.
  const save = useSaveSettings(() => {
    for (const k of [keys.catalogAll, keys.discoverAll, keys.metaAll, keys.featured]) qc.invalidateQueries({ queryKey: k });
  });
  const gate = useKeyGate();
  if (!data) return null;
  const on = !!data.tmdbKey;

  return (
    <ExpandRow
      icon={Picture}
      title="Artwork and episode info"
      caption="Adds logos, sharper posters and episode details using your free TMDB key"
      value={on ? "On" : "Off"}
      {...props}
    >
      <p className="settings-expand-text">
        Free key from themoviedb.org (Settings → API). Adds logos, better posters and episode details.
      </p>
      <FormRow
        look="expand"
        type="password"
        placeholder="Paste your key"
        autoComplete="off"
        value={key}
        onChange={setKey}
        saved={data.tmdbKey ?? ""}
        pending={save.isPending}
        pendingLabel="Saving…"
        onSubmit={(k) => gate.guard(added([[k, data.tmdbKey]]), () => save.mutate({ tmdbKey: k || null }))}
      />
      {gate.warning}
    </ExpandRow>
  );
}

/** Seek-bar thumbnails from Seekr. */
function PreviewsRow(props: Expandable) {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [key, setKey] = useState("");
  useEffect(() => setKey(data?.seekrKey ?? ""), [data?.seekrKey]);
  const verify = useMutation({ mutationFn: (k: string) => api.seekrValidate(k) });
  const save = useSaveSettings(() => qc.invalidateQueries({ queryKey: keys.seekrAll }));
  const gate = useKeyGate();
  if (!data) return null;

  const hasKey = !!data.seekrKey;
  const saved = (data.seekrKey ?? "") === key.trim();
  const status = verify.isPending
    ? "Checking…"
    : verify.data
      ? "Key accepted."
      : verify.isSuccess
        ? "That key wasn't accepted."
        : verify.isError
          ? "Couldn't reach Seekr. Check your connection."
          : null;

  return (
    <ExpandRow
      icon={Grid}
      title="Timeline previews"
      caption="Small preview pictures when you hover over the seek bar, from Seekr"
      value={hasKey && data.seekPreviews ? "On" : "Off"}
      {...props}
    >
      <p className="settings-expand-text">Key from seekr.tv.</p>
      <form
        className="settings-expand-form"
        onSubmit={(e) => {
          e.preventDefault();
          const k = key.trim();
          if (k) verify.mutate(k);
          gate.guard(added([[k, data.seekrKey]]), () => save.mutate({ seekrKey: k || null, seekPreviews: k ? true : data.seekPreviews }));
        }}
      >
        <TextField
          type="password"
          placeholder="Paste your key"
          value={key}
          onChange={(v) => {
            setKey(v);
            verify.reset();
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <Button variant="primary" disabled={saved && !key}>
          {saved && key ? "Check" : "Save"}
        </Button>
      </form>
      {gate.warning}
      {status && (
        <p className={`settings-expand-text${(verify.isSuccess && !verify.data) || verify.isError ? " settings-error" : ""}`}>
          {status}
        </p>
      )}
      <label className="settings-expand-toggle">
        <span>Show previews</span>
        <Switch checked={hasKey && data.seekPreviews} disabled={!hasKey} onChange={(on) => save.mutate({ seekPreviews: on })} />
      </label>
    </ExpandRow>
  );
}
