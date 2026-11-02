import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Captions,
  ChevronRight,
  Controls,
  Desktop,
  Edit,
  Reset,
  Settings as Cog,
  Sources,
  Download,
  Grid,
  Info,
  Instant,
  Picture,
  Play,
  Plus,
  Profile,
  Puzzle,
  Services,
  Trash,
  type Icon as IconT,
} from "../components/icons";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { useAccount } from "../lib/account/AccountProvider";
import { Dropdown } from "../components/Dropdown";
import { DEFAULT_SUBTITLE_STYLE, SubtitleSettings, subtitleCueVars } from "../components/player/SubtitleSettings";
import { api } from "../lib/api";
import { PREFERRED_LANGUAGES, languageName } from "../lib/languages";
import { keys, useAddons, useSettings, useUpdateSettings } from "../lib/queries";
import type { Settings as SettingsT } from "../lib/types";
import { ShortcutSettings } from "../components/ShortcutSettings";
import { resetPrefs, setPrefs, usePrefs } from "../lib/prefs";
import { clearRecentSearches } from "../lib/recentSearches";
import { playSound, SOUND_PACKS } from "../tv/sounds";
import { setTvMode } from "../tv/tvMode";
import { ReleaseNotes } from "../components/Updates";
import { appVersion, checkForUpdates, downloadUpdate, installUpdate, releaseUrl, useUpdate } from "../lib/updater";

export type PageId =
  | "account"
  | "playback"
  | "sources"
  | "subtitles"
  | "appearance"
  | "browsing"
  | "controls"
  | "addons"
  | "services"
  | "advanced"
  | "about";

export const PAGES: { id: PageId; label: string; icon: IconT }[] = [
  { id: "account", label: "Account", icon: Profile },
  { id: "playback", label: "Playback", icon: Play },
  { id: "sources", label: "Sources", icon: Sources },
  { id: "subtitles", label: "Subtitles & Audio", icon: Captions },
  { id: "appearance", label: "Appearance", icon: Desktop },
  { id: "browsing", label: "Browsing", icon: Grid },
  { id: "controls", label: "Controls & TV", icon: Controls },
  { id: "addons", label: "Add-ons", icon: Puzzle },
  { id: "services", label: "Services", icon: Services },
  { id: "advanced", label: "Advanced", icon: Cog },
  { id: "about", label: "About & Updates", icon: Info },
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
          <SettingsPageBody page={page} />
        </div>
      </div>
    </div>
  );
}

/** One page's content on its own, for the settings overlay. */
export function SettingsPageBody({ page }: { page: PageId }) {
  switch (page) {
    case "account":
      return <AccountPage />;
    case "playback":
      return <PlaybackPage />;
    case "sources":
      return <SourcesPage />;
    case "subtitles":
      return <SubtitlesPage />;
    case "appearance":
      return <AppearancePage />;
    case "browsing":
      return <BrowsingPage />;
    case "advanced":
      return <AdvancedPage />;
    case "controls":
      return <ControlsPage />;
    case "addons":
      return <AddonsPage />;
    case "services":
      return <ServicesPage />;
    case "about":
      return <AboutPage />;
  }
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
  icon?: IconT;
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
function LinkRow({ icon: Icon, title, caption, onClick }: { icon: IconT; title: string; caption?: string; onClick: () => void }) {
  return (
    <button className="settings-row settings-row-button" onClick={onClick}>
      <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />
      <RowText title={title} caption={caption} />
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
  const expand = useExpanded();

  if (account.status === "guest") {
    return (
      <Card footer="Your library and watch history move into your first profile.">
        <div className="settings-row">
          <RowText title="Not signed in" caption="Sign in to keep profiles, your library, history and settings on every device." />
          <button className="btn btn-primary" onClick={account.showSignIn}>
            Sign In
          </button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card footer="Your library, watch history, playlists, settings, shortcuts and addons sync automatically. The bridge, volume and TV mode stay on this device.">
        <div className="settings-row">
          <RowText title="Email" caption={account.user?.email} />
          <button className="btn" onClick={() => void account.signOut()}>
            Sign Out
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
        <LinkRow icon={Edit} title="Manage profiles" onClick={() => account.switchProfile("manage")} />
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
    <ExpandRow icon={Trash} title="Delete account" caption="Removes all profiles and synced data" {...props}>
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

/**
 * A dropdown row over numbers. Keeps a saved value that isn't one of the
 * choices (set by an older version, or synced) instead of showing it wrong.
 */
function NumberPickRow({
  title,
  caption,
  value,
  choices,
  label,
  onChange,
}: {
  title: string;
  caption?: string;
  value: number;
  choices: number[];
  label: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const all = choices.includes(value) ? choices : [...choices, value].sort((a, b) => a - b);
  return (
    <PickRow title={title} caption={caption}>
      <Dropdown
        label={title}
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        options={all.map((n) => ({ value: String(n), label: label(n) }))}
      />
    </PickRow>
  );
}

const seconds = (n: number) => (n === 1 ? "1 second" : `${n} seconds`);

function PlaybackPage() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  if (!data) return null;
  const set = (patch: Partial<SettingsT>) => update.mutate(patch);
  const recapsOn = data.autoSkipRecaps ?? data.autoSkip;

  return (
    <>
      <Card title="Autoplay">
        <ToggleRow
          title="Play the best source automatically"
          caption="Start playing as soon as a good source is found, without asking you to pick one"
          checked={data.autoPickSource}
          onChange={(v) => set({ autoPickSource: v })}
        />
        <ToggleRow
          title="Play the next episode automatically"
          checked={data.autoplayNext}
          onChange={(v) => set({ autoplayNext: v })}
        />
        {data.autoplayNext && (
          <NumberPickRow
            title="Countdown"
            caption="How long Up Next waits before it starts the next episode"
            value={data.autoplayCountdown ?? 8}
            choices={[5, 8, 10, 15, 30]}
            label={seconds}
            onChange={(n) => set({ autoplayCountdown: n })}
          />
        )}
        {data.autoplayNext && (
          <NumberPickRow
            title="Ask if you're still watching"
            caption="Stop after this many episodes in a row with no keys or clicks, so a show doesn't play all night"
            value={data.stillWatchingAfter ?? 0}
            choices={[0, 2, 3, 4, 6]}
            label={(n) => (n ? `After ${n} episodes` : "Never")}
            onChange={(n) => set({ stillWatchingAfter: n })}
          />
        )}
        <PickRow title="Show Up Next" caption="When the next-episode card appears near the end of an episode">
          <Dropdown
            label="Show Up Next"
            value={data.nextUpTiming === "end" ? "end" : "credits"}
            onChange={(v) => set({ nextUpTiming: v })}
            options={[
              { value: "credits", label: "When the credits start" },
              { value: "end", label: "At the very end" },
            ]}
          />
        </PickRow>
      </Card>

      <Card title="Skipping" footer="Timings come from the IntroDB community database, or from the file's own chapters.">
        <ToggleRow
          title="Skip intros"
          caption="Jump past the opening titles on their own"
          checked={data.autoSkip}
          onChange={(v) => set({ autoSkip: v })}
        />
        <ToggleRow
          title="Skip recaps"
          caption="Jump past the “previously on” part on its own"
          checked={recapsOn}
          onChange={(v) => set({ autoSkipRecaps: v })}
        />
        <ToggleRow
          title="Use the file's own chapters for intros"
          caption="If the video has chapters named Intro, Recap or Credits, use those. Otherwise the online intro database fills in."
          checked={prefs.preferFileChapters}
          onChange={(v) => setPrefs({ preferFileChapters: v })}
        />
      </Card>

      <Card title="Resuming">
        <ToggleRow
          title="Resume where you left off"
          caption="Off: every video starts from the beginning"
          checked={data.resumePlayback ?? true}
          onChange={(v) => set({ resumePlayback: v })}
        />
        {(data.resumePlayback ?? true) && (
          <NumberPickRow
            title="Back up when resuming"
            caption="Start a little before where you stopped, to pick up the thread"
            value={data.resumeRewind ?? 0}
            choices={[0, 5, 10, 30]}
            label={(n) => (n ? seconds(n) : "Don't")}
            onChange={(n) => set({ resumeRewind: n })}
          />
        )}
        <NumberPickRow
          title="Count as watched at"
          caption="How far into a video it moves out of Continue Watching and gets a tick"
          value={data.watchedThreshold ?? 92}
          choices={[80, 85, 90, 92, 95, 98]}
          label={(n) => `${n}%`}
          onChange={(n) =>
            update.mutate(
              { watchedThreshold: n },
              {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: keys.continue });
                  qc.invalidateQueries({ queryKey: keys.history });
                },
              },
            )
          }
        />
      </Card>

      <Card title="Player">
        <ToggleRow
          title="Start in fullscreen"
          checked={!!data.startFullscreen}
          onChange={(v) => set({ startFullscreen: v })}
        />
        <ToggleRow
          title="Pause when minimized"
          caption="On this device"
          checked={prefs.pauseOnMinimize}
          onChange={(v) => setPrefs({ pauseOnMinimize: v })}
        />
        <ToggleRow
          title="Remember playback speed"
          caption="Keep the speed you last chose for the next video, instead of going back to normal"
          checked={!!data.rememberSpeed}
          onChange={(v) => set({ rememberSpeed: v, playbackSpeed: 1 })}
        />
        <PickRow title="Clock" caption="What the time next to the timeline shows. Clicking it there switches too.">
          <Dropdown
            label="Clock"
            value={data.timeDisplay ?? "remaining"}
            onChange={(v) => set({ timeDisplay: v })}
            options={[
              { value: "remaining", label: "Time left" },
              { value: "elapsed", label: "Elapsed / total" },
              { value: "endsAt", label: "Ends at" },
            ]}
          />
        </PickRow>
        <NumberPickRow
          title="Skip forward and back"
          caption="How far the skip buttons and the left and right arrow keys jump"
          value={data.seekStep}
          choices={SEEK_STEPS}
          label={seconds}
          onChange={(n) => set({ seekStep: n })}
        />
        <NumberPickRow
          title="Hide controls after"
          caption="Without moving the mouse"
          value={data.controlsHideSecs ?? 2}
          choices={[2, 3, 5, 8]}
          label={seconds}
          onChange={(n) => set({ controlsHideSecs: n })}
        />
        <PickRow title="Clicking the video">
          <Dropdown
            label="Clicking the video"
            value={data.clickAction === "controls" ? "controls" : "toggle"}
            onChange={(v) => set({ clickAction: v })}
            options={[
              { value: "toggle", label: "Plays or pauses" },
              { value: "controls", label: "Shows the controls" },
            ]}
          />
        </PickRow>
        <PickRow title="Scrolling over the video">
          <Dropdown
            label="Scrolling over the video"
            value={data.wheelAction ?? "volume"}
            onChange={(v) => set({ wheelAction: v })}
            options={[
              { value: "volume", label: "Changes volume" },
              { value: "seek", label: "Skips back and forward" },
              { value: "none", label: "Does nothing" },
            ]}
          />
        </PickRow>
      </Card>
    </>
  );
}

// --- Sources ---------------------------------------------------------------

const SIZE_CHOICES = [0, 1, 2, 4, 8, 15, 30, 60];
const sizeLabel = (n: number) => (n ? `${n} GB` : "Any size");

function SourcesPage() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const [words, setWords] = useState("");
  useEffect(() => setWords(data?.excludeKeywords ?? ""), [data?.excludeKeywords]);
  if (!data) return null;
  // Filters run in Rust when sources are fetched, so cached lists are stale.
  const set = (patch: Partial<SettingsT>) =>
    update.mutate(patch, { onSuccess: () => qc.invalidateQueries({ queryKey: ["streams"] }) });
  const wordsDirty = words.trim() !== (data.excludeKeywords ?? "").trim();

  return (
    <>
      <Card
        title="Filters"
        footer="Hidden sources never play automatically and don't show in the source list. A source that doesn't say its quality or size is always kept."
      >
        <PickRow title="Highest quality" caption="Leave out anything sharper, for a slow connection or an older screen">
          <Dropdown
            label="Highest quality"
            value={String(data.maxResolution ?? 0)}
            onChange={(v) => set({ maxResolution: Number(v) })}
            options={[
              { value: "0", label: "Any" },
              { value: "2160", label: "4K" },
              { value: "1080", label: "1080p" },
              { value: "720", label: "720p" },
              { value: "480", label: "480p" },
            ]}
          />
        </PickRow>
        <NumberPickRow
          title="Largest movie file"
          caption="Big files take longer to start and can stall on a slower connection"
          value={data.maxMovieSizeGb ?? 0}
          choices={SIZE_CHOICES}
          label={sizeLabel}
          onChange={(n) => set({ maxMovieSizeGb: n })}
        />
        <NumberPickRow
          title="Largest episode file"
          value={data.maxEpisodeSizeGb ?? 0}
          choices={SIZE_CHOICES}
          label={sizeLabel}
          onChange={(n) => set({ maxEpisodeSizeGb: n })}
        />
        <ToggleRow
          title="Hide cinema recordings"
          caption="CAM and telesync copies, filmed in a cinema"
          checked={data.hideCam ?? true}
          onChange={(v) => set({ hideCam: v })}
        />
      </Card>

      <Card
        title="Hide Sources Containing"
        footer="Separate words with commas, e.g. HC, 3D, KORSUB. Whole words only, upper or lower case."
      >
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            set({ excludeKeywords: words.trim() });
          }}
        >
          <input
            className="settings-input"
            placeholder="HC, 3D, KORSUB"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            spellCheck={false}
            aria-label="Words to hide"
          />
          <button className="btn btn-primary" disabled={!wordsDirty || update.isPending}>
            Save
          </button>
        </form>
      </Card>

      <Card title="Source List">
        <PickRow title="Sort by" caption="How the Sources list in the player is ordered when it opens">
          <Dropdown
            label="Sort by"
            value={data.sourceSort ?? "best"}
            onChange={(v) => set({ sourceSort: v })}
            options={[
              { value: "best", label: "Best match" },
              { value: "quality", label: "Highest quality" },
              { value: "sizeDesc", label: "Largest file" },
              { value: "sizeAsc", label: "Smallest file" },
              { value: "peers", label: "Most peers" },
            ]}
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
        {!!data.subtitleLanguage && (
          <PickRow
            title="Show subtitles"
            caption="Only for foreign audio: turn them on when the audio isn't already in your subtitle language"
          >
            <Dropdown
              label="Show subtitles"
              value={data.subtitleMode === "foreign" ? "foreign" : "always"}
              onChange={(v) => update.mutate({ subtitleMode: v })}
              options={[
                { value: "always", label: "Always" },
                { value: "foreign", label: "Only for foreign audio" },
              ]}
            />
          </PickRow>
        )}
      </Card>
      <SoundCard />
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

/** mpv's audio options. They suit this device's speakers, so they stay on it. */
function SoundCard() {
  const prefs = usePrefs();
  const { data: hasMpv } = useQuery({ queryKey: ["mpv"], queryFn: api.mpvAvailable, staleTime: Infinity });
  return (
    <Card
      title="Sound"
      footer={
        hasMpv === false
          ? "These need mpv, which plays most files. Install mpv to use them."
          : "Saved on this device, so headphones and a home cinema can each have their own."
      }
    >
      <ToggleRow
        title="Boost dialogue"
        caption="Makes voices clearer on surround (5.1 and 7.1) audio by turning the centre channel up and the rest down"
        checked={prefs.dialogueBoost}
        disabled={hasMpv === false}
        onChange={(v) => setPrefs({ dialogueBoost: v })}
      />
      <ToggleRow
        title="Even out volume"
        caption="Night mode: quieter explosions, louder whispers"
        checked={prefs.volumeLeveling}
        disabled={hasMpv === false}
        onChange={(v) => setPrefs({ volumeLeveling: v })}
      />
    </Card>
  );
}

// --- Appearance ------------------------------------------------------------

const ACCENTS = [
  { value: "#0A84FF", label: "Blue" },
  { value: "#5E5CE6", label: "Indigo" },
  { value: "#BF5AF2", label: "Purple" },
  { value: "#FF375F", label: "Pink" },
  { value: "#FF453A", label: "Red" },
  { value: "#FF9F0A", label: "Orange" },
  { value: "#FFD60A", label: "Yellow" },
  { value: "#30D158", label: "Green" },
  { value: "#64D2FF", label: "Teal" },
  { value: "#8E8E93", label: "Graphite" },
];

const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

function AppearancePage() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  if (!data) return null;
  const set = (patch: Partial<SettingsT>) => update.mutate(patch);
  const accent = (data.accentColor ?? "#0A84FF").toUpperCase();

  return (
    <>
      <Card title="Colour">
        <PickRow title="Accent colour" caption="Switches, selections and highlights">
          <div className="settings-swatches" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                className="settings-swatch"
                role="radio"
                aria-checked={accent === a.value}
                aria-label={a.label}
                title={a.label}
                style={{ "--swatch": a.value } as React.CSSProperties}
                onClick={() => set({ accentColor: a.value })}
              />
            ))}
          </div>
        </PickRow>
        <PickRow title="Background">
          <Dropdown
            label="Background"
            value={data.theme === "black" ? "black" : "dark"}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: "dark", label: "Dark" },
              { value: "black", label: "Black (OLED)" },
            ]}
          />
        </PickRow>
      </Card>

      <Card title="Size">
        <PickRow title="Interface size" caption="Zoom everything in or out. On this device.">
          <Dropdown
            label="Interface size"
            value={String(UI_SCALES.includes(prefs.uiScale) ? prefs.uiScale : 1)}
            onChange={(v) => setPrefs({ uiScale: Number(v) })}
            options={UI_SCALES.map((s) => ({ value: String(s), label: s === 1 ? "100% (Default)" : `${Math.round(s * 100)}%` }))}
          />
        </PickRow>
        <PickRow title="Card size" caption="Posters and thumbnails in rows and grids">
          <Dropdown
            label="Card size"
            value={data.cardSize ?? "medium"}
            onChange={(v) => set({ cardSize: v })}
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
          />
        </PickRow>
      </Card>

      <Card title="Text and Motion">
        <PickRow title="Font">
          <Dropdown
            label="Font"
            value={data.uiFont === "system" ? "system" : "inter"}
            onChange={(v) => set({ uiFont: v })}
            options={[
              { value: "inter", label: "Inter" },
              { value: "system", label: "System" },
            ]}
          />
        </PickRow>
        <PickRow title="Reduce motion" caption="Fades instead of slides and zooms, and no rotating carousel">
          <Dropdown
            label="Reduce motion"
            value={data.reduceMotion ?? "system"}
            onChange={(v) => set({ reduceMotion: v })}
            options={[
              { value: "system", label: "Match Windows" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </PickRow>
      </Card>
    </>
  );
}

// --- Browsing --------------------------------------------------------------

const METADATA_LANGUAGES = [
  "en-US", "en-GB", "es-ES", "es-MX", "fr-FR", "de-DE", "it-IT", "pt-PT", "pt-BR", "nl-NL", "sv-SE", "da-DK", "nb-NO",
  "fi-FI", "pl-PL", "cs-CZ", "hu-HU", "ro-RO", "el-GR", "tr-TR", "ru-RU", "uk-UA", "ar-SA", "he-IL", "hi-IN", "th-TH",
  "vi-VN", "id-ID", "ja-JP", "ko-KR", "zh-CN", "zh-TW",
];
const regionNames = new Intl.DisplayNames(undefined, { type: "language" });
const localeLabel = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

function BrowsingPage() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  if (!data) return null;
  const languages = METADATA_LANGUAGES.includes(data.language) ? METADATA_LANGUAGES : [data.language, ...METADATA_LANGUAGES];
  return (
    <>
      <Card title="General">
        <PickRow title="Open the app on">
          <Dropdown
            label="Open the app on"
            value={data.startPage ?? "home"}
            onChange={(v) => update.mutate({ startPage: v })}
            options={[
              { value: "home", label: "Home" },
              { value: "movies", label: "Movies" },
              { value: "series", label: "Shows" },
              { value: "library", label: "Library" },
            ]}
          />
        </PickRow>
        <PickRow
          title="Titles and descriptions"
          caption={data.tmdbKey ? "The language of names, synopses and artwork" : "Needs a TMDB key (Services → Artwork and episode info)"}
        >
          <Dropdown
            label="Titles and descriptions"
            value={data.language}
            onChange={(v) =>
              update.mutate(
                { language: v },
                {
                  // A new language rebuilds the catalog source; cached pages are in the old one.
                  onSuccess: () => {
                    for (const k of ["catalog", "discover", "meta", "featured", "recommend"]) qc.invalidateQueries({ queryKey: [k] });
                  },
                },
              )
            }
            options={languages.map((c) => ({ value: c, label: localeLabel(c) }))}
          />
        </PickRow>
      </Card>
      <Card title="Home">
        <ToggleRow
          title="Rotate the featured titles"
          caption="Move to the next featured title every few seconds"
          checked={data.heroAutoplay ?? true}
          onChange={(v) => update.mutate({ heroAutoplay: v })}
        />
        <ToggleRow
          title="Show Continue Watching"
          checked={data.showContinueWatching ?? true}
          onChange={(v) => update.mutate({ showContinueWatching: v })}
        />
      </Card>
      <Card title="Spoilers" footer="Episodes you've finished show as normal.">
        <ToggleRow
          title="Blur unwatched episode pictures"
          caption="A still can give away who's in the episode, or what happens"
          checked={!!data.hideEpisodeThumbs}
          onChange={(v) => update.mutate({ hideEpisodeThumbs: v })}
        />
        <ToggleRow
          title="Hide unwatched episode descriptions"
          checked={!!data.hideEpisodeDescriptions}
          onChange={(v) => update.mutate({ hideEpisodeDescriptions: v })}
        />
      </Card>
      <Card title="Search">
        <ToggleRow
          title="Remember recent searches"
          checked={prefs.saveRecentSearches}
          onChange={(v) => {
            setPrefs({ saveRecentSearches: v });
            if (!v) clearRecentSearches();
          }}
        />
      </Card>
      <Card title="Cards">
        <ToggleRow
          title="Show titles"
         
          checked={data.showCardTitles}
          onChange={(v) => update.mutate({ showCardTitles: v })}
        />
        <ToggleRow
          title="Show details"
          caption="Add the type, genre and year under the name"
          checked={data.showCardTitles && data.showCardDetails}
          disabled={!data.showCardTitles}
          onChange={(v) => update.mutate({ showCardDetails: v })}
        />
        <ToggleRow
          title="Show IMDb ratings"
          caption="Add an IMDb rating badge under each poster"
          checked={data.showCardRatings ?? false}
          onChange={(v) => update.mutate({ showCardRatings: v })}
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
    </>
  );
}

// --- Advanced --------------------------------------------------------------

function AdvancedPage() {
  const prefs = usePrefs();
  const expand = useExpanded();
  const { data: hasMpv } = useQuery({ queryKey: ["mpv"], queryFn: api.mpvAvailable, staleTime: Infinity });
  return (
    <>
      <Card
        title="Video"
        footer={hasMpv === false ? "These need mpv." : "Saved on this device. Changes apply straight away, even mid-video."}
      >
        <ToggleRow
          title="Hardware decoding"
          caption="Lets the graphics card decode video. Turn off only if you see green frames, glitches or a black picture."
          checked={prefs.hwdec}
          disabled={hasMpv === false}
          onChange={(v) => setPrefs({ hwdec: v })}
        />
        <ToggleRow
          title="Smooth colour banding"
          caption="Removes visible steps in dark scenes and skies, at a small cost in GPU power"
          checked={prefs.deband}
          disabled={hasMpv === false}
          onChange={(v) => setPrefs({ deband: v })}
        />
        <PickRow title="Buffer" caption="How far ahead to load. Larger rides out a patchy connection but uses more memory.">
          <Dropdown
            label="Buffer"
            value={prefs.buffer}
            onChange={(v) => setPrefs({ buffer: v })}
            options={[
              { value: "small", label: "Small (30 s)" },
              { value: "normal", label: "Normal (90 s)" },
              { value: "large", label: "Large (5 min)" },
            ]}
          />
        </PickRow>
      </Card>
      <Card title="Reset">
        <ResetRow {...expand("reset")} />
      </Card>
    </>
  );
}

function ResetRow(props: Expandable) {
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: api.resetSettings,
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      resetPrefs();
      for (const k of ["streams", "continue", "history"]) qc.invalidateQueries({ queryKey: [k] });
      props.onToggle();
    },
  });
  return (
    <ExpandRow icon={Reset} title="Reset all settings" caption="Put every option back to how it started" {...props}>
      <p className="settings-expand-text">
        Your library, history, profiles, add-ons, keyboard shortcuts, API keys and bridge stay as they are.
      </p>
      <div className="settings-expand-actions">
        <button className="btn btn-danger" disabled={reset.isPending} onClick={() => reset.mutate()}>
          <Reset size={15} /> Reset Settings
        </button>
      </div>
      {reset.isError && <p className="settings-error">{String(reset.error)}</p>}
    </ExpandRow>
  );
}

// --- About & Updates -------------------------------------------------------

function AboutPage() {
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
        return `Polar ${s.version} is available`;
      case "downloading":
        return `Downloading Polar ${s.version}${s.progress == null ? "…" : ` · ${Math.round(s.progress * 100)}%`}`;
      case "ready":
        return `Polar ${s.version} is downloaded. Restart to finish.`;
      case "installing":
        return `Installing Polar ${s.version}…`;
      case "error":
        return s.message;
      default:
        return "Checks automatically every few hours";
    }
  })();

  return (
    <>
      <Card title="Polar" footer="Updates are signed and come straight from Polar's GitHub releases. Your library, settings and profiles are kept.">
        <PickRow title="Version" caption={status}>
          <span className="settings-row-value settings-version">{version ?? "…"}</span>
        </PickRow>
        <div className="settings-row">
          <RowText title="Software update" caption={s.phase === "ready" ? "Takes a few seconds; Polar reopens by itself" : undefined} />
          <div className="settings-expand-actions">
            {s.phase === "available" ? (
              <button className="btn btn-primary" onClick={() => void downloadUpdate()}>
                <Download size={15} /> Download {s.version}
              </button>
            ) : s.phase === "ready" ? (
              <button className="btn btn-primary" onClick={() => void installUpdate()}>
                <Reset size={15} /> Restart to Update
              </button>
            ) : (
              <button
                className="btn"
                disabled={s.phase === "checking" || s.phase === "downloading" || s.phase === "installing"}
                onClick={() => void checkForUpdates()}
              >
                Check for Updates
              </button>
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
    </>
  );
}

// --- Controls & TV ---------------------------------------------------------

const SOUND_LEVELS = [
  { value: "0.25", label: "Low" },
  { value: "0.5", label: "Medium" },
  { value: "0.9", label: "High" },
];

function ControlsPage() {
  const prefs = usePrefs();
  const level = SOUND_LEVELS.reduce((best, l) =>
    Math.abs(Number(l.value) - prefs.uiSoundVolume) < Math.abs(Number(best.value) - prefs.uiSoundVolume) ? l : best,
  );

  return (
    <>
      <Card title="TV Mode">
        <div className="settings-row">
          <RowText title="TV mode" caption="A fullscreen interface for the couch, made for a remote or controller." />
          <button className="btn" onClick={() => setTvMode(true)}>
            Open TV Mode
          </button>
        </div>
        <ToggleRow
          title="Interface sounds"
          caption="Soft clicks as you move, select and go back"
          checked={prefs.uiSounds}
          onChange={(v) => {
            setPrefs({ uiSounds: v });
            if (v) playSound("select", { force: true });
          }}
        />
        {prefs.uiSounds && (
          <PickRow title="Sound pack">
            <Dropdown
              label="Sound pack"
              value={prefs.uiSoundPack}
              onChange={(v) => {
                setPrefs({ uiSoundPack: v });
                playSound("select", { force: true });
              }}
              options={SOUND_PACKS}
            />
          </PickRow>
        )}
        {prefs.uiSounds && (
          <PickRow title="Sound volume">
            <Dropdown
              label="Sound volume"
              value={level.value}
              onChange={(v) => {
                setPrefs({ uiSoundVolume: Number(v) });
                playSound("select", { force: true });
              }}
              options={SOUND_LEVELS}
            />
          </PickRow>
        )}
      </Card>
      <Card title="Controllers">
        <ToggleRow
          title="Connection notices"
          caption="When a controller connects or disconnects"
          checked={prefs.controllerAlerts}
          onChange={(v) => setPrefs({ controllerAlerts: v })}
        />
        <ToggleRow
          title="Suggest TV mode"
          caption="Offer TV mode when a controller connects in desktop mode"
          checked={prefs.suggestTvMode}
          onChange={(v) => setPrefs({ suggestTvMode: v })}
        />
      </Card>
      <ShortcutSettings />
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
                  <Trash size={15} /> Remove
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
      icon={Picture}
      title="Artwork and episode info"
      caption="Adds logos, sharper posters and episode details using your free TMDB key"
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
      icon={Instant}
      title="p2p playback"
      caption="The address of the server that turns p2ps into video you can watch"
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
