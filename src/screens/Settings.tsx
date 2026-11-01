import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Captions,
  ChevronRight,
  ImageIcon,
  Pencil,
  LayoutGrid,
  Play,
  Plug,
  Plus,
  Puzzle,
  Trash2,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { useAccount } from "../lib/account/AccountProvider";
import { isDemo } from "../lib/account/demo";
import { sync, useSyncStatus } from "../lib/account/sync";
import { Dropdown } from "../components/Dropdown";
import { DEFAULT_SUBTITLE_STYLE, SubtitleSettings, subtitleCueVars } from "../components/player/SubtitleSettings";
import { api } from "../lib/api";
import { PREFERRED_LANGUAGES, languageName } from "../lib/languages";
import { keys, useAddons, useSettings, useUpdateSettings } from "../lib/queries";
import type { Settings as SettingsT } from "../lib/types";

type PageId = "account" | "playback" | "subtitles" | "browsing" | "addons" | "services";

const PAGES: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "playback", label: "Playback", icon: Play },
  { id: "subtitles", label: "Subtitles & Audio", icon: Captions },
  { id: "browsing", label: "Browsing", icon: LayoutGrid },
  { id: "addons", label: "Add-ons", icon: Puzzle },
  { id: "services", label: "Services", icon: Plug },
];

/**
 * Sections in a sidebar, one page at a time on the right, options grouped
 * into cards. Everything saves the moment it changes, except typed values
 * (keys, addresses), which save on their own button.
 */
export function Settings({ initialPage }: { initialPage?: string }) {
  const { enabled: accounts } = useAccount();
  const pages = accounts ? PAGES : PAGES.filter((p) => p.id !== "account");
  const [page, setPage] = useState<PageId>(() =>
    pages.some((p) => p.id === initialPage) ? (initialPage as PageId) : pages[0].id,
  );
  const current = pages.find((p) => p.id === page) ?? pages[0];

  return (
    <div className="scroll">
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {pages.map((p) => (
            <button
              key={p.id}
              className="settings-nav-item"
              aria-current={p.id === page ? "page" : undefined}
              onClick={() => setPage(p.id)}
            >
              <p.icon size={20} strokeWidth={p.id === page ? 2.4 : 2} />
              {p.label}
            </button>
          ))}
        </nav>

        <div className="settings-main" key={page}>
          <header className="settings-head">
            <h1 className="settings-title">{current.label}</h1>
          </header>
          {page === "account" && <AccountPage />}
          {page === "playback" && <PlaybackPage />}
          {page === "subtitles" && <SubtitlesPage />}
          {page === "browsing" && <BrowsingPage />}
          {page === "addons" && <AddonsPage />}
          {page === "services" && <ServicesPage />}
        </div>
      </div>
    </div>
  );
}

// --- Building blocks -------------------------------------------------------

function Card({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-group">
      {title && <h2 className="settings-group-title">{title}</h2>}
      <div className="settings-card">{children}</div>
      {footer && <p className="settings-footer">{footer}</p>}
    </section>
  );
}

function RowText({ title, caption }: { title: string; caption?: ReactNode }) {
  return (
    <span className="settings-row-text">
      <span className="settings-row-title">{title}</span>
      {caption && <span className="settings-row-caption">{caption}</span>}
    </span>
  );
}

function ToggleRow({
  title,
  caption,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  caption?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="settings-row">
      <RowText title={title} caption={caption} />
      <input
        type="checkbox"
        className="switch"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function PickRow({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <RowText title={title} caption={caption} />
      {children}
    </div>
  );
}

/** A row that opens in place to show its controls. */
function ExpandRow({
  icon: Icon,
  title,
  caption,
  value,
  open,
  onToggle,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  caption?: ReactNode;
  /** Short current state on the right ("On", a server address…). */
  value?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="settings-expand" data-open={open}>
      <button className="settings-row settings-row-button" aria-expanded={open} onClick={onToggle}>
        {Icon && <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />}
        <RowText title={title} caption={caption} />
        {value != null && <span className="settings-row-value">{value}</span>}
        <ChevronRight className="settings-chevron" size={18} strokeWidth={2.25} />
      </button>
      {open && <div className="settings-expand-body">{children}</div>}
    </div>
  );
}

/** A row that leads somewhere else. */
function LinkRow({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return (
    <button className="settings-row settings-row-button" onClick={onClick}>
      <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />
      <RowText title={title} />
      <ChevronRight className="settings-chevron" size={18} strokeWidth={2.25} />
    </button>
  );
}

/** One open row per card; clicking it again closes it. */
function useExpanded() {
  const [open, setOpen] = useState<string | null>(null);
  return (id: string) => ({ open: open === id, onToggle: () => setOpen((o) => (o === id ? null : id)) });
}

// --- Account ---------------------------------------------------------------

function AccountPage() {
  const account = useAccount();
  const syncStatus = useSyncStatus();
  const expand = useExpanded();

  if (account.status === "guest") {
    return (
      <Card footer="My List and watch history move into your first profile.">
        <div className="settings-row">
          <RowText title="Not signed in" caption="Sign in to sync profiles, My List and watch history." />
          <button className="btn btn-primary" onClick={account.showSignIn}>
            Sign In
          </button>
        </div>
      </Card>
    );
  }

  const synced =
    syncStatus.state === "syncing"
      ? "Syncing…"
      : syncStatus.state === "error"
        ? `Couldn't sync: ${syncStatus.error}`
        : syncStatus.lastSyncedAt
          ? `Last synced ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "Not synced yet";

  return (
    <>
      <Card>
        <div className="settings-row">
          <RowText title="Email" caption={account.user?.email} />
          <button className="btn" onClick={() => void account.signOut()}>
            {isDemo() ? "Exit Demo" : "Sign Out"}
          </button>
        </div>
      </Card>

      <Card title="Profiles">
        {account.profiles.map((p) => (
          <div className="settings-row" key={p.id}>
            <Avatar id={p.avatar} style={{ width: 32, borderRadius: 7 }} />
            <RowText title={p.name} caption={p.id === account.profile?.id ? "Current profile" : undefined} />
          </div>
        ))}
        <LinkRow icon={Pencil} title="Manage profiles" onClick={() => account.switchProfile("manage")} />
      </Card>

      <Card title="Sync" footer="Settings stay on this device.">
        <div className="settings-row">
          <RowText title="My List and watch history" caption={synced} />
          <button className="btn" disabled={syncStatus.state === "syncing"} onClick={() => void sync.now()}>
            Sync Now
          </button>
        </div>
      </Card>

      <Card title="Danger Zone">
        <DeleteAccountRow {...expand("delete")} />
      </Card>
    </>
  );
}

function DeleteAccountRow(props: Expandable) {
  const account = useAccount();
  const [typed, setTyped] = useState("");
  const remove = useMutation({ mutationFn: () => account.deleteAccount() });
  return (
    <ExpandRow icon={Trash2} title="Delete account" caption="Removes all profiles and synced data" {...props}>
      <p className="settings-expand-text">
        This can't be undone. Type <strong>delete</strong> to confirm.
      </p>
      <div className="settings-expand-form">
        <input className="settings-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="delete" />
        <button
          className="btn btn-danger"
          disabled={typed.trim().toLowerCase() !== "delete" || remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete Account
        </button>
      </div>
      {remove.isError && <p className="settings-error">{String((remove.error as Error).message)}</p>}
    </ExpandRow>
  );
}

// --- Playback --------------------------------------------------------------

const SEEK_STEPS = [5, 10, 15, 30];

function PlaybackPage() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  if (!data) return null;
  const set = (patch: Partial<SettingsT>) => update.mutate(patch);
  const steps = SEEK_STEPS.includes(data.seekStep) ? SEEK_STEPS : [data.seekStep, ...SEEK_STEPS];

  return (
    <>
      <Card title="Autoplay">
        <ToggleRow
          title="Play the best source automatically"
          checked={data.autoPickSource}
          onChange={(v) => set({ autoPickSource: v })}
        />
        <ToggleRow
          title="Play the next episode automatically"
          checked={data.autoplayNext}
          onChange={(v) => set({ autoplayNext: v })}
        />
        <ToggleRow
          title="Skip intros and recaps"
          checked={data.autoSkip}
          onChange={(v) => set({ autoSkip: v })}
        />
      </Card>
      <Card title="Controls">
        <PickRow title="Skip forward and back" caption="Buttons and arrow keys">
          <Dropdown
            label="Skip amount"
            value={String(data.seekStep)}
            onChange={(v) => set({ seekStep: Number(v) })}
            options={steps.map((n) => ({ value: String(n), label: n + " seconds" }))}
          />
        </PickRow>
      </Card>
    </>
  );
}

// --- Subtitles & audio -----------------------------------------------------

/** "Default"/"Off" first, then languages (plus the current one if it isn't in the list). */
function languageOptions(current: string, none: string) {
  const codes = current && !PREFERRED_LANGUAGES.includes(current) ? [current, ...PREFERRED_LANGUAGES] : PREFERRED_LANGUAGES;
  return [{ value: "", label: none }, ...codes.map((c) => ({ value: c, label: languageName(c) ?? c }))];
}

function SubtitlesPage() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  if (!data) return null;
  const style = data.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;

  return (
    <>
      <Card title="Languages">
        <PickRow title="Audio">
          <Dropdown
            label="Audio language"
            value={data.audioLanguage}
            onChange={(v) => update.mutate({ audioLanguage: v })}
            options={languageOptions(data.audioLanguage, "Default")}
          />
        </PickRow>
        <PickRow title="Subtitles">
          <Dropdown
            label="Subtitle language"
            value={data.subtitleLanguage}
            onChange={(v) => update.mutate({ subtitleLanguage: v })}
            options={languageOptions(data.subtitleLanguage, "Off")}
          />
        </PickRow>
      </Card>
      <Card title="Subtitle Style">
        <div className="settings-sub-sample" style={subtitleCueVars(style)} aria-hidden>
          <span>This is how your subtitles will look.</span>
        </div>
        <div className="settings-card-pad">
          <SubtitleSettings
            style={style}
            onChange={(patch) => update.mutate({ subtitleStyle: { ...style, ...patch } })}
            canPosition
          />
        </div>
      </Card>
    </>
  );
}

// --- Browsing --------------------------------------------------------------

function BrowsingPage() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  if (!data) return null;
  return (
    <>
      <Card title="Cards">
        <ToggleRow title="Show titles" checked={data.showCardTitles} onChange={(v) => update.mutate({ showCardTitles: v })} />
        <ToggleRow
          title="Show details"
          caption="Type, genre and year"
          checked={data.showCardTitles && data.showCardDetails}
          disabled={!data.showCardTitles}
          onChange={(v) => update.mutate({ showCardDetails: v })}
        />
      </Card>
      <Card title="Episodes">
        <PickRow title="Default layout">
          <Dropdown
            label="Episode layout"
            value={data.episodeLayout ?? "row"}
            onChange={(v) => update.mutate({ episodeLayout: v })}
            options={[
              { value: "row", label: "Row" },
              { value: "list", label: "List" },
            ]}
          />
        </PickRow>
      </Card>
      <Card title="Text">
        <PickRow title="Font">
          <Dropdown
            label="Font"
            value={data.uiFont ?? "inter"}
            onChange={(v) => update.mutate({ uiFont: v })}
            options={[
              { value: "inter", label: "Inter" },
              { value: "system", label: "System" },
              // Test only: hotlinked and unlicensed, so dev builds only.
              ...(import.meta.env.DEV ? [{ value: "netflix" as const, label: "Netflix Sans (test)" }] : []),
            ]}
          />
        </PickRow>
      </Card>
    </>
  );
}

// --- Add-ons ---------------------------------------------------------------

function AddonsPage() {
  const qc = useQueryClient();
  const { data: addons } = useAddons();
  const [url, setUrl] = useState("");
  const expand = useExpanded();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.addons });
    qc.invalidateQueries({ queryKey: ["streams"] });
  };
  const install = useMutation({
    mutationFn: api.installAddon,
    onSuccess: () => {
      setUrl("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: api.removeAddon, onSuccess: refresh });

  return (
    <>
      {!!addons?.length && (
        <Card title="Installed">
          {addons.map((a) => (
            <ExpandRow key={a.manifest.id} icon={Puzzle} title={a.manifest.name} {...expand(a.manifest.id)}>
              {a.manifest.description && <p className="settings-expand-text">{a.manifest.description}</p>}
              <p className="settings-expand-text settings-url">{a.manifestUrl}</p>
              <div className="settings-expand-actions">
                <button className="btn btn-danger" onClick={() => remove.mutate(a.manifest.id)} disabled={remove.isPending}>
                  <Trash2 size={15} /> Remove
                </button>
              </div>
            </ExpandRow>
          ))}
        </Card>
      )}
      <Card title="Install from URL">
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) install.mutate(url.trim());
          }}
        >
          <input
            className="settings-input"
            placeholder="https://…/manifest.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
          <button className="btn btn-primary" disabled={install.isPending || !url.trim()}>
            <Plus size={16} /> {install.isPending ? "Installing…" : "Install"}
          </button>
        </form>
        {install.isError && <p className="settings-error settings-card-pad">{String(install.error)}</p>}
      </Card>
    </>
  );
}

// --- Services --------------------------------------------------------------

function ServicesPage() {
  const expand = useExpanded();
  return (
    <Card>
      <ArtworkRow {...expand("artwork")} />
      <p2pRow {...expand("p2p")} />
      <PreviewsRow {...expand("previews")} />
    </Card>
  );
}

type Expandable = { open: boolean; onToggle: () => void };

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
    for (const k of ["catalog", "discover", "meta", "featured"]) qc.invalidateQueries({ queryKey: [k] });
  });
  if (!data) return null;
  const on = !!data.tmdbKey;
  const dirty = key.trim() !== (data.tmdbKey ?? "");

  return (
    <ExpandRow
      icon={ImageIcon}
      title="Artwork and episode info"
      caption="TMDB key"
      value={on ? "On" : "Off"}
      {...props}
    >
      <p className="settings-expand-text">
        Free key from themoviedb.org (Settings → API). Adds logos, better posters and episode details.
      </p>
      <form
        className="settings-expand-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ tmdbKey: key.trim() || null });
        }}
      >
        <input
          className="settings-input"
          type="password"
          placeholder="Paste your key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn btn-primary" disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </form>
    </ExpandRow>
  );
}

function p2pRow(props: Expandable) {
  const { data } = useSettings();
  const [address, setAddress] = useState("");
  useEffect(() => setAddress(data?.bridge ?? ""), [data?.bridge]);
  const save = useSaveSettings();
  if (!data) return null;
  const dirty = address.trim() !== data.bridge;

  return (
    <ExpandRow
      icon={Zap}
      title="p2p playback"
      caption="bridge address"
      value={data.bridge.replace(/^https?:\/\//, "")}
      {...props}
    >
      <form
        className="settings-expand-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ bridge: address.trim() });
        }}
      >
        <input className="settings-input" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
        <button className="btn btn-primary" disabled={!dirty || !address.trim() || save.isPending}>
          Save
        </button>
      </form>
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
  const save = useSaveSettings(() => qc.invalidateQueries({ queryKey: ["seekr"] }));
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
      icon={LayoutGrid}
      title="Timeline previews"
      caption="Seekr key"
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
          save.mutate({ seekrKey: k || null, seekPreviews: k ? true : data.seekPreviews });
        }}
      >
        <input
          className="settings-input"
          type="password"
          placeholder="Paste your key"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            verify.reset();
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn btn-primary" disabled={saved && !key}>
          {saved && key ? "Check" : "Save"}
        </button>
      </form>
      {status && (
        <p className={`settings-expand-text${(verify.isSuccess && !verify.data) || verify.isError ? " settings-error" : ""}`}>
          {status}
        </p>
      )}
      <label className="settings-expand-toggle">
        <span>Show previews</span>
        <input
          type="checkbox"
          className="switch"
          role="switch"
          checked={hasKey && data.seekPreviews}
          disabled={!hasKey}
          onChange={(e) => save.mutate({ seekPreviews: e.target.checked })}
        />
      </label>
    </ExpandRow>
  );
}
