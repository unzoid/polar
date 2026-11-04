import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Reset, Download, Info, Trash } from "../../components/icons";
import { api } from "../../lib/api";
import tmdbLogo from "../../assets/tmdb-short.svg";
import { CREDITS, TMDB_NOTICE } from "../../lib/credits";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { ReleaseNotes } from "../../components/Updates";
import { appVersion, checkForUpdates, downloadUpdate, installUpdate, releaseUrl, useUpdate } from "../../lib/updater";
import { Button } from "../../components/ui/Button";
import { Card, ExpandRow, LinkRow, PickRow, RowText, ToggleRow, useExpanded } from "../../components/settings/rows";

export function AboutPage() {
  const prefs = usePrefs();
  const s = useUpdate();
  const expand = useExpanded();
  const { data: version } = useQuery({ queryKey: ["app-version"], queryFn: appVersion, staleTime: Infinity });

  const status = (() => {
    switch (s.phase) {
      case "checking":
        return "Checking…";
      case "current":
        return "You're on the latest version";
      case "available":
        return `Polarity ${s.version} is available`;
      case "downloading":
        return `Downloading Polarity ${s.version}${s.progress == null ? "…" : ` · ${Math.round(s.progress * 100)}%`}`;
      case "ready":
        return `Polarity ${s.version} is downloaded. Restart to finish.`;
      case "installing":
        return `Installing Polarity ${s.version}…`;
      case "error":
        return s.message;
      default:
        return "Checks automatically every few hours";
    }
  })();

  return (
    <>
      <Card title="Polarity" footer="Updates are signed and come straight from Polarity's GitHub releases. Your library, settings and profiles are kept.">
        <PickRow title="Version" caption={status}>
          <span className="settings-row-value settings-version">{version ?? "…"}</span>
        </PickRow>
        <div className="settings-row">
          <RowText title="Software update" caption={s.phase === "ready" ? "Takes a few seconds; Polarity reopens by itself" : undefined} />
          <div className="settings-expand-actions">
            {s.phase === "available" ? (
              <Button variant="primary" onClick={() => void downloadUpdate()}>
                <Download size={15} /> Download {s.version}
              </Button>
            ) : s.phase === "ready" ? (
              <Button variant="primary" onClick={() => void installUpdate()}>
                <Reset size={15} /> Restart to Update
              </Button>
            ) : (
              <Button
                disabled={s.phase === "checking" || s.phase === "downloading" || s.phase === "installing"}
                onClick={() => void checkForUpdates()}
              >
                Check for Updates
              </Button>
            )}
          </div>
        </div>
        <ToggleRow
          title="Download updates automatically"
          caption="New versions download in the background. Nothing installs until you restart."
          checked={prefs.autoDownloadUpdates}
          onChange={(v) => {
            setPrefs({ autoDownloadUpdates: v });
            if (v && s.phase === "available") void downloadUpdate();
          }}
        />
        {"notes" in s && s.notes && (
          <ExpandRow icon={Info} title={`What's new in ${s.version}`} {...expand("notes")}>
            <div className="whats-new">
              <ReleaseNotes text={s.notes} />
            </div>
          </ExpandRow>
        )}
        <LinkRow icon={Info} title="Release notes" caption="Every version and what changed" onClick={() => void api.openExternal(releaseUrl())} />
      </Card>
      <CacheCard />
      <CreditsCard />
    </>
  );
}

/**
 * Where the data comes from. TMDB's notice and logo are required to be shown,
 * so they aren't folded away; its rules keep the logo smaller than Polar's own
 * (the 38px navbar mark) and without any hint of endorsement.
 */
function CreditsCard() {
  const expand = useExpanded();
  return (
    <Card
      title="Credits"
      footer={
        <>
          <img className="settings-credits-tmdb" src={tmdbLogo} alt="TMDB" draggable={false} />
          {TMDB_NOTICE}
        </>
      }
    >
      <ExpandRow icon={Info} title="Data sources" caption="Where titles, episodes, ratings and subtitles come from" {...expand("credits")}>
        <ul className="settings-credits">
          {CREDITS.map((c) => (
            <li key={c.name}>
              {c.url ? (
                <button className="settings-credit-name" onClick={() => void api.openExternal(c.url!)}>
                  {c.name}
                </button>
              ) : (
                <span className="settings-credit-name">{c.name}</span>
              )}
              <span className="settings-expand-text">{c.use}</span>
            </li>
          ))}
        </ul>
      </ExpandRow>
    </Card>
  );
}

/** What the app keeps in its cache folder, and a way to empty it. */
function CacheCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["anime-cache"], queryFn: api.animeCache });
  const clear = useMutation({
    mutationFn: api.animeCacheClear,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["anime-cache"] });
      void qc.removeQueries({ queryKey: ["anime", "episodeFlags"] });
    },
  });
  const size = !data ? "…" : !data.bytes ? "empty" : data.bytes >= 1e6 ? `${(data.bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(data.bytes / 1000))} KB`;
  return (
    <Card title="Cache" footer={data ? <>Kept in {data.path}</> : undefined}>
      <div className="settings-row">
        <RowText title="Anime data" caption={`Filler and recap episodes, kept a day; the anime id list used when ani.zip is down, kept a week · ${size}`} />
        <Button disabled={!data?.bytes || clear.isPending} onClick={() => clear.mutate()}>
          <Trash size={15} /> Clear
        </Button>
      </div>
    </Card>
  );
}
