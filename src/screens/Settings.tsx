import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { keys, useAddons, useSettings } from "../lib/queries";
import type { Settings as SettingsT } from "../lib/types";

export function Settings() {
  return (
    <div className="scroll">
      <div className="settings">
        <h1 className="t-title1 settings-title">Settings</h1>
        <AddonsSection />
        <GeneralSection />
        <SeekPreviewSection />
      </div>
    </div>
  );
}

function Section({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="t-micro faint">{title}</h2>
      <div className="settings-group">{children}</div>
      {footer && <p className="t-caption faint settings-footer">{footer}</p>}
    </section>
  );
}

function AddonsSection() {
  const qc = useQueryClient();
  const { data: addons } = useAddons();
  const [url, setUrl] = useState("");

  const install = useMutation({
    mutationFn: api.installAddon,
    onSuccess: () => {
      setUrl("");
      qc.invalidateQueries({ queryKey: keys.addons });
      qc.invalidateQueries({ queryKey: ["streams"] });
    },
  });
  const remove = useMutation({
    mutationFn: api.removeAddon,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.addons });
      qc.invalidateQueries({ queryKey: ["streams"] });
    },
  });

  return (
    <Section
      title="Stream addons"
      footer="Any Stremio-compatible addon works. Paste its manifest URL (https://… or stremio://…)."
    >
      {addons?.map((a) => (
        <div className="settings-row" key={a.manifest.id}>
          <div className="settings-row-text">
            <span className="t-headline">{a.manifest.name}</span>
            <span className="t-caption faint">{a.manifest.description ?? a.manifestUrl}</span>
          </div>
          <button
            className="btn btn-glass btn-icon pressable"
            aria-label={`Remove ${a.manifest.name}`}
            onClick={() => remove.mutate(a.manifest.id)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <form
        className="settings-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) install.mutate(url);
        }}
      >
        <input
          className="settings-input"
          placeholder="https://addon.example/manifest.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
        />
        <button className="btn btn-primary" disabled={install.isPending}>
          <Plus size={16} /> {install.isPending ? "Installing…" : "Install"}
        </button>
      </form>
      {install.isError && <p className="settings-error t-caption">{String(install.error)}</p>}
    </Section>
  );
}

function GeneralSection() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [draft, setDraft] = useState<SettingsT | null>(null);
  useEffect(() => setDraft(data ?? null), [data]);

  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (s) => {
      qc.setQueryData(keys.settings, s);
      // A new metadata source means every cached catalog is stale.
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["discover"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
    },
  });

  if (!draft) return null;
  const set = (patch: Partial<SettingsT>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);

  return (
    <Section
      title="Metadata & playback"
      footer={`Metadata source: ${data?.metadataSource}. Add a free TMDB key for richer artwork and faster episode data.`}
    >
      <label className="settings-row">
        <span className="t-headline">TMDB API key</span>
        <input
          className="settings-input"
          type="password"
          placeholder="Optional"
          value={draft.tmdbKey ?? ""}
          onChange={(e) => set({ tmdbKey: e.target.value || null })}
        />
      </label>
      <label className="settings-row">
        <span className="t-headline">bridge</span>
        <input
          className="settings-input"
          value={draft.bridge}
          onChange={(e) => set({ bridge: e.target.value })}
        />
      </label>
      <label className="settings-row">
        <span className="t-headline">Autoplay next episode</span>
        <input
          type="checkbox"
          className="switch"
          checked={draft.autoplayNext}
          onChange={(e) => set({ autoplayNext: e.target.checked })}
        />
      </label>
      {dirty && (
        <div className="settings-row settings-actions">
          <button className="btn btn-glass" onClick={() => setDraft(data ?? null)}>
            Discard
          </button>
          <button className="btn btn-primary" onClick={() => save.mutate(draft)}>
            Save
          </button>
        </div>
      )}
    </Section>
  );
}

/** Optional: seek-bar thumbnails from Seekr. Saves on its own, independent of the section above. */
function SeekPreviewSection() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const [key, setKey] = useState("");
  useEffect(() => setKey(data?.seekrKey ?? ""), [data?.seekrKey]);

  const verify = useMutation({ mutationFn: (k: string) => api.seekrValidate(k) });
  const save = useMutation({
    mutationFn: (patch: Partial<SettingsT>) => api.saveSettings({ ...data!, ...patch }),
    onSuccess: (s) => {
      qc.setQueryData(keys.settings, s);
      qc.invalidateQueries({ queryKey: ["seekr"] });
    },
  });
  if (!data) return null;

  const saved = (data.seekrKey ?? "") === key.trim();
  const status = verify.isPending
    ? "Checking…"
    : verify.data
      ? `Key valid · ${verify.data.replace(/_/g, " ")}`
      : verify.isSuccess
        ? "Seekr didn't accept this key."
        : verify.isError
          ? `Couldn't reach Seekr: ${String(verify.error)}`
          : null;

  return (
    <Section
      title="Seek previews"
      footer="Thumbnails while you scrub the timeline, from seekr.tv. Optional — needs a Seekr API key. Titles without previews just show the time."
    >
      <label className="settings-row">
        <span className="t-headline">Show previews</span>
        <input
          type="checkbox"
          className="switch"
          checked={data.seekPreviews}
          disabled={!data.seekrKey}
          onChange={(e) => save.mutate({ seekPreviews: e.target.checked })}
        />
      </label>
      <form
        className="settings-row"
        onSubmit={(e) => {
          e.preventDefault();
          const k = key.trim();
          verify.mutate(k);
          save.mutate({ seekrKey: k || null, seekPreviews: k ? true : data.seekPreviews });
        }}
      >
        <input
          className="settings-input"
          type="password"
          placeholder="sk_live_…"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            verify.reset();
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn btn-primary" disabled={saved && !key}>
          {saved && key ? "Verify" : "Save"}
        </button>
      </form>
      {status && (
        <p className={`settings-status t-caption${(verify.isSuccess && !verify.data) || verify.isError ? " settings-error" : ""}`}>{status}</p>
      )}
    </Section>
  );
}
