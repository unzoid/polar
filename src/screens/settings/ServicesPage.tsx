import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "../../components/ui/Switch";
import { TextField } from "../../components/ui/TextField";
import { Bookmark, Grid, LayoutList, Picture, Star, Tv } from "../../components/icons";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { keys, useSettings } from "../../lib/net";
import type { Settings as SettingsT } from "../../lib/types";
import { Button } from "../../components/ui/Button";
import { Card, ExpandRow, FormRow, useExpanded, type Expandable } from "../../components/settings/rows";
import { useSecretsNote } from "../../components/settings/secretsNote";
import { useKeyGate, type KeyKind } from "../../components/settings/KeyWarning";
import { ListImport } from "../../components/settings/ListImport";
import { TraktImport } from "../../components/settings/TraktImport";
import { TraktSignIn } from "../../components/settings/TraktSignIn";
import { SimklImport } from "../../components/settings/SimklImport";
import { SimklSignIn } from "../../components/settings/SimklSignIn";
import {
  anilistAuthorizeUrl,
  linkAniList,
  linkMal,
  malSignInReady,
  NoPendingSignIn,
  NotASignIn,
  SignedOut,
  startMalSignIn,
  unlinkList,
  useListLink,
} from "../../lib/lists";
import { onTraktFull, setTraktWatchlist, traktReady, unlinkTrakt, useTraktLink } from "../../lib/trakt";
import { setSimklWatchlist, simklReady, unlinkSimkl, useSimklLink } from "../../lib/simkl";
import { TRAKT_NOTICE } from "../../lib/settings";

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
      <AniListRow {...expand("anilist")} />
      <MalRow {...expand("mal")} />
      <TraktRow {...expand("trakt")} />
      <SimklRow {...expand("simkl")} />
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

/**
 * The profile's AniList account (#83): signed in through AniList's page, whose code is pasted back
 * here. The link stays on this device, in the system's keychain, and is never synced.
 */
function AniListRow(props: Expandable) {
  const { space, link, state } = useListLink("anilist");
  const [code, setCode] = useState("");
  const url = anilistAuthorizeUrl();
  const signIn = useMutation({
    mutationFn: (text: string) => linkAniList(space, text),
    onSuccess: () => setCode(""),
  });
  const unlink = useMutation({ mutationFn: () => unlinkList("anilist", space) });
  if (state === undefined) return null;
  const error = signIn.error
    ? signIn.error instanceof NotASignIn
      ? "That isn't the code AniList shows. Copy the whole code and paste it again."
      : signIn.error instanceof SignedOut
        ? "AniList didn't accept that code. Open AniList and sign in again."
        : "Couldn't reach AniList. Check your connection."
    : null;

  return (
    <ExpandRow
      icon={LayoutList}
      title="AniList"
      setting="anilist"
      caption="Episodes you watch update this profile's AniList list, and you can change it from an anime's page"
      value={state === "linked" ? "Linked" : state === "none" ? "Off" : "Sign in again"}
      {...props}
    >
      {state === "linked" && link ? (
        <>
          <p className="settings-expand-text">
            Linked as <strong>{link.userName || "your AniList account"}</strong>. The sign-in stays on this device and lasts a year.
          </p>
          <div className="settings-expand-form">
            <Button variant="danger" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              {unlink.isPending ? "Unlinking…" : "Unlink"}
            </Button>
          </div>
          <ListImport service="anilist" space={space} />
        </>
      ) : !url ? (
        <p className="settings-expand-text">Not set up in this build: signing in to AniList needs Polarity registered with AniList first.</p>
      ) : (
        <>
          <p className="settings-expand-text">
            {state === "expired"
              ? "The sign-in to AniList has run out. "
              : state === "refused"
                ? "AniList no longer accepts this sign-in. "
                : ""}
            Open AniList, allow Polarity, then copy the code AniList shows and paste it here. The sign-in stays on this device.
          </p>
          <div className="settings-expand-form">
            <Button variant="glass" onClick={() => void api.openExternal(url)}>
              Open AniList
            </Button>
          </div>
          <FormRow
            look="expand"
            type="password"
            placeholder="Paste the code"
            aria-label="AniList code"
            autoComplete="off"
            value={code}
            onChange={(v) => {
              setCode(v);
              signIn.reset();
            }}
            submit="Link"
            pending={signIn.isPending}
            pendingLabel="Linking…"
            onSubmit={(text) => signIn.mutate(text)}
          />
          {error && <p className="settings-expand-text settings-error">{error}</p>}
        </>
      )}
      {unlink.isError && <p className="settings-expand-text settings-error">Couldn't unlink. Try again.</p>}
    </ExpandRow>
  );
}

/**
 * The profile's MyAnimeList account (#84): signed in on MAL's page, which then sends the browser to
 * an address that doesn't load; that address, with its code, is pasted back here. The link stays
 * on this device, in the system's keychain, is never synced, and renews itself while it is used.
 */
function MalRow(props: Expandable) {
  const { space, link, state } = useListLink("mal");
  const [pasted, setPasted] = useState("");
  const signIn = useMutation({
    mutationFn: (text: string) => linkMal(space, text),
    onSuccess: () => setPasted(""),
  });
  const unlink = useMutation({ mutationFn: () => unlinkList("mal", space) });
  if (state === undefined) return null;
  const open = () => {
    const url = startMalSignIn(space);
    if (url) void api.openExternal(url);
  };
  const error = signIn.error
    ? signIn.error instanceof NoPendingSignIn
      ? "Open MyAnimeList first, then paste the address here within half an hour."
      : signIn.error instanceof NotASignIn
        ? "That isn't the address MyAnimeList sent you to. Copy the whole address and paste it again."
        : signIn.error instanceof SignedOut
          ? "MyAnimeList didn't accept that sign-in. Open MyAnimeList and sign in again."
          : "Couldn't reach MyAnimeList. Check your connection."
    : null;

  return (
    <ExpandRow
      icon={LayoutList}
      title="MyAnimeList"
      setting="mal"
      caption="Episodes you watch update this profile's MyAnimeList list, and you can change it from an anime's page"
      value={state === "linked" ? "Linked" : state === "none" ? "Off" : "Sign in again"}
      {...props}
    >
      {state === "linked" && link ? (
        <>
          <p className="settings-expand-text">
            Linked as <strong>{link.userName || "your MyAnimeList account"}</strong>. The sign-in stays on this device and renews itself while you use
            Polarity at least once a month.
          </p>
          <div className="settings-expand-form">
            <Button variant="danger" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              {unlink.isPending ? "Unlinking…" : "Unlink"}
            </Button>
          </div>
          <ListImport service="mal" space={space} />
        </>
      ) : !malSignInReady() ? (
        <p className="settings-expand-text">Not set up in this build: signing in to MyAnimeList needs Polarity registered with MyAnimeList first.</p>
      ) : (
        <>
          <p className="settings-expand-text">
            {state === "expired"
              ? "The sign-in to MyAnimeList has run out. "
              : state === "refused"
                ? "MyAnimeList no longer accepts this sign-in. "
                : ""}
            Open MyAnimeList and allow Polarity. Your browser then goes to a page that doesn't load: copy its whole address and paste it here. The
            sign-in stays on this device.
          </p>
          <div className="settings-expand-form">
            <Button variant="glass" onClick={open}>
              Open MyAnimeList
            </Button>
          </div>
          <FormRow
            look="expand"
            type="password"
            placeholder="Paste the address"
            aria-label="MyAnimeList address"
            autoComplete="off"
            value={pasted}
            onChange={(v) => {
              setPasted(v);
              signIn.reset();
            }}
            submit="Link"
            pending={signIn.isPending}
            pendingLabel="Linking…"
            onSubmit={(text) => signIn.mutate(text)}
          />
          {error && <p className="settings-expand-text settings-error">{error}</p>}
        </>
      )}
      <p className="settings-expand-text t-caption">Uses the MyAnimeList API.</p>
      {unlink.isError && <p className="settings-expand-text settings-error">Couldn't unlink. Try again.</p>}
    </ExpandRow>
  );
}

/**
 * The profile's Trakt account (#85): signed in with a code entered on Trakt's site. The link stays
 * on this device, in the system's keychain, is never synced, and renews itself while it is used.
 */
function TraktRow(props: Expandable) {
  const { space, link, state } = useTraktLink();
  const unlink = useMutation({ mutationFn: () => unlinkTrakt(space) });
  const watchlist = useMutation({ mutationFn: (on: boolean) => setTraktWatchlist(space, on) });
  const [full, setFull] = useState(false);
  useEffect(() => onTraktFull((list) => list === "watchlist" && setFull(true)), []);
  if (state === undefined) return null;

  return (
    <ExpandRow
      icon={Tv}
      title="Trakt"
      setting="trakt"
      caption="What you watch goes to this profile's Trakt history, with its watchlist and ratings kept in step"
      value={state === "linked" ? "Linked" : state === "none" ? "Off" : "Sign in again"}
      {...props}
    >
      {state === "linked" && link ? (
        <>
          <p className="settings-expand-text">
            Linked as <strong>{link.name}</strong>. The sign-in stays on this device and renews itself while you use Polarity at least once every few
            months.
          </p>
          <div className="settings-expand-form">
            <Button variant="danger" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              {unlink.isPending ? "Unlinking…" : "Unlink"}
            </Button>
          </div>
          <label className="settings-expand-toggle">
            <span>Keep the library and the Trakt watchlist in step</span>
            <Switch checked={!!link.watchlist} disabled={watchlist.isPending} onChange={(on) => watchlist.mutate(on)} />
          </label>
          {full && (
            <p className="settings-expand-text settings-error" role="alert">
              Your Trakt watchlist is full, so some titles weren't added. Trakt's free accounts hold a limited number of titles.
            </p>
          )}
          <TraktImport space={space} />
        </>
      ) : !traktReady() ? (
        <p className="settings-expand-text">Not set up in this build: signing in to Trakt needs Polarity registered with Trakt first.</p>
      ) : (
        <>
          {state === "refused" && <p className="settings-expand-text">Trakt no longer accepts this sign-in.</p>}
          <TraktSignIn space={space} />
        </>
      )}
      <p className="settings-expand-text t-caption">{TRAKT_NOTICE}</p>
      {unlink.isError && <p className="settings-expand-text settings-error">Couldn't unlink. Try again.</p>}
    </ExpandRow>
  );
}

/**
 * The profile's Simkl account (#86): signed in with a code entered on Simkl's site. The link stays
 * on this device, in the system's keychain, is never synced, and renews itself while it is used.
 */
function SimklRow(props: Expandable) {
  const { space, link, state } = useSimklLink();
  const unlink = useMutation({ mutationFn: () => unlinkSimkl(space) });
  const watchlist = useMutation({ mutationFn: (on: boolean) => setSimklWatchlist(space, on) });
  if (state === undefined) return null;

  return (
    <ExpandRow
      icon={Bookmark}
      title="Simkl"
      setting="simkl"
      caption="What you watch goes to this profile's Simkl lists, films, shows and anime alike"
      value={state === "linked" ? "Linked" : state === "none" ? "Off" : "Sign in again"}
      {...props}
    >
      {state === "linked" && link ? (
        <>
          <p className="settings-expand-text">
            Linked as <strong>{link.name}</strong>. The sign-in stays on this device and renews itself while you use Polarity at least once every few
            months.
          </p>
          <div className="settings-expand-form">
            <Button variant="danger" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
              {unlink.isPending ? "Unlinking…" : "Unlink"}
            </Button>
          </div>
          <label className="settings-expand-toggle">
            <span>Keep the library and Simkl's Plan to Watch in step</span>
            <Switch checked={!!link.watchlist} disabled={watchlist.isPending} onChange={(on) => watchlist.mutate(on)} />
          </label>
          <SimklImport space={space} />
        </>
      ) : !simklReady() ? (
        <p className="settings-expand-text">Not set up in this build: signing in to Simkl needs Polarity registered with Simkl first.</p>
      ) : (
        <>
          {state === "refused" && <p className="settings-expand-text">Simkl no longer accepts this sign-in.</p>}
          <SimklSignIn space={space} />
        </>
      )}
      {unlink.isError && <p className="settings-expand-text settings-error">Couldn't unlink. Try again.</p>}
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
