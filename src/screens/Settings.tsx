import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ToggleChip } from "../components/ui/Chip";
import { Switch } from "../components/ui/Switch";
import { TextField } from "../components/ui/TextField";
import {
  Edit,
  Reset,
  Settings as Cog,
  Download,
  Grid,
  Info,
  Picture,
  Plus,
  Puzzle,
  Star,
  Trash,
} from "../components/icons";
import { MarketplacePage } from "../components/Marketplace";
import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useAccount } from "../lib/account/AccountProvider";
import { Dropdown } from "../components/Dropdown";
import { AUTO_TAG_CHOICES, screenResolution, SORTS, TAG_LABELS } from "../lib/sources";
import { DEFAULT_SUBTITLE_STYLE, SubtitleSettings, subtitleCueVars } from "../components/player/SubtitleSettings";
import { api } from "../lib/api";
import tmdbLogo from "../assets/tmdb-short.svg";
import { CREDITS, TMDB_NOTICE } from "../lib/credits";
import { PREFERRED_LANGUAGES, languageName } from "../lib/languages";
import { keys, useAddons, useSettings, useUpdateSettings } from "../lib/queries";
import type { Settings as SettingsT } from "../lib/types";
import { ShortcutSettings } from "../components/ShortcutSettings";
import { ANIME_SHELVES, setShelfVisible, useShelfVisible } from "../lib/anime/shelves";
import { preferredGroups } from "../lib/anime/groups";
import { resetPrefs, setPrefs, usePrefs } from "../lib/prefs";
import { uiFontOf } from "../lib/fonts";
import { clearRecentSearches } from "../lib/recentSearches";
import { playSound, SOUND_PACKS } from "../tv/sounds";
import { setTvMode } from "../tv/tvMode";
import { isMac } from "../lib/platform";
import { useControllerDetected, useGamepadConnected, useLastPadPress } from "../tv/gamepad";
import {
  NAV_ACTIONS,
  PAD_BUTTONS,
  PLAYER_ACTIONS,
  canBind,
  padBindingsCustomized,
  resetPadBindings,
  setPadBinding,
  usePadBindings,
  type Layout,
  type PadButton,
} from "../tv/padBindings";
import { PadGlyph } from "../tv/TvChrome";
import { ReleaseNotes } from "../components/Updates";
import { appVersion, checkForUpdates, downloadUpdate, installUpdate, releaseUrl, useUpdate } from "../lib/updater";
import { Button } from "../components/ui/Button";
import { Card, ExpandRow, LinkRow, NumberRow, PickRow, RowText, ToggleRow, useExpanded, type Expandable } from "../components/settings/rows";
import { PAGES } from "../components/settings/pages";
import type { PageId } from "../lib/settings/pages";

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
    case "anime":
      return <AnimePage />;
    case "advanced":
      return <AdvancedPage />;
    case "controls":
      return <ControlsPage />;
    case "controller":
      return <ControllerPage />;
    case "marketplace":
      return <MarketplacePage />;
    case "addons":
      return <AddonsPage />;
    case "services":
      return <ServicesPage />;
    case "about":
      return <AboutPage />;
  }
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
          <Button variant="primary" onClick={account.showSignIn}>
            Sign In
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card footer="Your library, watch history, playlists, settings, shortcuts and addons sync automatically. Volume and TV mode stay on this device.">
        <div className="settings-row">
          <RowText title="Email" caption={account.user?.email} />
          <Button onClick={() => void account.signOut()}>
            Sign Out
          </Button>
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
        <TextField value={typed} onChange={setTyped} placeholder="delete" />
        <Button
          variant="danger"
          disabled={typed.trim().toLowerCase() !== "delete" || remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete Account
        </Button>
      </div>
      {remove.isError && <p className="settings-error">{String((remove.error as Error).message)}</p>}
    </ExpandRow>
  );
}

// --- Playback --------------------------------------------------------------

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
          <NumberRow
            title="Countdown"
            caption="How long Up Next waits before it starts the next episode"
            value={data.autoplayCountdown ?? 8}
            min={3}
            max={60}
            unit="sec"
            onChange={(n) => set({ autoplayCountdown: n })}
          />
        )}
        {data.autoplayNext && (
          <NumberRow
            title="Ask if you're still watching"
            caption="Stop after this many episodes in a row with no keys or clicks, so a show doesn't play all night"
            value={data.stillWatchingAfter ?? 0}
            min={0}
            max={12}
            unit="episodes"
            zero="Never"
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
          <NumberRow
            title="Back up when resuming"
            caption="Start a little before where you stopped, to pick up the thread"
            value={data.resumeRewind ?? 0}
            min={0}
            max={60}
            unit="sec"
            zero="Don't"
            onChange={(n) => set({ resumeRewind: n })}
          />
        )}
        <NumberRow
          title="Count as watched at"
          caption="How far into a video it moves out of Continue Watching and gets a tick"
          value={data.watchedThreshold ?? 92}
          min={50}
          max={100}
          unit="%"
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
        <NumberRow
          title="Skip forward and back"
          caption="How far the skip buttons and the left and right arrow keys jump"
          value={data.seekStep}
          min={1}
          max={120}
          unit="sec"
          onChange={(n) => set({ seekStep: n })}
        />
        <NumberRow
          title="Hide controls after"
          caption="Without moving the mouse"
          value={data.controlsHideSecs ?? 2}
          min={1}
          max={15}
          unit="sec"
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
  const autoTags = data.sourceAutoTags ?? [];
  const screen = screenResolution();
  const screenLabel = screen >= 2160 ? "4K" : `${screen}p`;

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
        <NumberRow
          title="Largest movie file"
          caption="Big files take longer to start and can stall on a slower connection"
          value={data.maxMovieSizeGb ?? 0}
          min={0}
          max={100}
          step={0.5}
          unit="GB"
          zero="Any size"
          onChange={(n) => set({ maxMovieSizeGb: n })}
        />
        <NumberRow
          title="Largest episode file"
          value={data.maxEpisodeSizeGb ?? 0}
          min={0}
          max={30}
          step={0.5}
          unit="GB"
          zero="Any size"
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
          <TextField
            placeholder="HC, 3D, KORSUB"
            value={words}
            onChange={setWords}
            spellCheck={false}
            aria-label="Words to hide"
          />
          <Button variant="primary" disabled={!wordsDirty || update.isPending}>
            Save
          </Button>
        </form>
      </Card>

      <Card title="Source List">
        <PickRow title="Sort by" caption="How the Sources list in the player is ordered when it opens">
          <Dropdown
            label="Sort by"
            value={data.sourceSort in SORTS ? data.sourceSort : "best"}
            onChange={(v) => set({ sourceSort: v })}
            options={[
              { value: "best", label: "Best match" },
              { value: "quality", label: "Highest quality" },
              { value: "sizeDesc", label: "Largest file" },
              { value: "sizeAsc", label: "Smallest file" },
            ]}
          />
        </PickRow>
        <ToggleRow
          title="Match my screen"
          caption={`This screen is ${screenLabel}. Best match puts sources it can show first, instead of bigger files it can't`}
          checked={data.preferScreenResolution ?? true}
          onChange={(v) => set({ preferScreenResolution: v })}
        />
        <ToggleRow
          title="Filters hide other sources"
          caption="Off: sources matching your filters come first and the rest stay below them, so a missing language or size never leaves you with nothing to pick"
          checked={data.sourceFiltersHide ?? false}
          onChange={(v) => set({ sourceFiltersHide: v })}
        />
      </Card>

      <Card
        title="Turn On When Available"
        footer="When a title has sources with these, the source list starts filtered to them, and autoplay picks from them first. Click one in the list to turn it off again."
      >
        <div className="settings-row settings-chip-row">
          <div className="srcf-tags" role="group" aria-label="Tags to turn on by themselves">
            {AUTO_TAG_CHOICES.map((t) => {
              const on = autoTags.includes(t);
              return (
                <ToggleChip
                  key={t}
                  on={on}
                  label={TAG_LABELS[t]}
                  onToggle={() => set({ sourceAutoTags: on ? autoTags.filter((x) => x !== t) : [...autoTags, t] })}
                />
              );
            })}
          </div>
        </div>
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
        <NumberRow
          title="Interface size"
          caption="Zoom everything in or out. On this device."
          value={Math.round((prefs.uiScale > 0 ? prefs.uiScale : 1) * 100)}
          min={70}
          max={175}
          step={5}
          unit="%"
          onChange={(n) => setPrefs({ uiScale: n / 100 })}
        />
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
            value={uiFontOf(data.uiFont)}
            onChange={(v) => set({ uiFont: v })}
            options={[
              { value: "inter", label: "Inter" },
              { value: "system", label: "System" },
              { value: "opendyslexic", label: "OpenDyslexic" },
            ]}
          />
        </PickRow>
        <PickRow title="Reduce motion" caption="Fades instead of slides and zooms, and no rotating carousel">
          <Dropdown
            label="Reduce motion"
            value={data.reduceMotion ?? "system"}
            onChange={(v) => set({ reduceMotion: v })}
            options={[
              { value: "system", label: isMac ? "Match macOS" : "Match Windows" },
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
            value={data.startPage === "anime" && !prefs.animeEnabled ? "home" : (data.startPage ?? "home")}
            onChange={(v) => update.mutate({ startPage: v })}
            options={[
              { value: "home", label: "Home" },
              { value: "movies", label: "Movies" },
              { value: "series", label: "Shows" },
              ...(prefs.animeEnabled ? [{ value: "anime" as const, label: "Anime" }] : []),
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
      <Card title="Title Pages">
        <ToggleRow
          title="Play trailers on title pages"
          caption="After a few seconds on a movie or show, its trailer plays behind the page"
          checked={data.trailerAutoplay ?? true}
          onChange={(v) => update.mutate({ trailerAutoplay: v })}
        />
        {(data.trailerAutoplay ?? true) && (
          <ToggleRow
            title="Automatic trailer sound"
            caption="When enabled, automatic trailer previews start with sound"
            checked={!!data.trailerSound}
            onChange={(v) => update.mutate({ trailerSound: v })}
          />
        )}
      </Card>
      <Card title="Calendar" footer="Like Stremio's calendar: built from the shows in your library and the ones you're watching.">
        <ToggleRow
          title="Show the Calendar"
          caption="A section listing new episodes of your shows by the day they air"
          checked={!!data.showCalendar}
          onChange={(v) => update.mutate({ showCalendar: v })}
        />
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
      <Card title="Family">
        <PickRow title="Mature content" caption="Ecchi anime: fan service, suggestive art. Explicit titles never show">
          <Dropdown
            label="Mature content"
            value={prefs.matureContent}
            onChange={(v) => setPrefs({ matureContent: v })}
            options={[
              { value: "show", label: "Show" },
              { value: "blur", label: "Blur posters" },
              { value: "hide", label: "Hide" },
            ]}
          />
        </PickRow>
      </Card>
      <Card title="Search">
        <ToggleRow
          title="Suggest genres"
          caption="A few genres under the search field before you type"
          checked={prefs.searchSuggestions}
          onChange={(v) => setPrefs({ searchSuggestions: v })}
        />
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
          caption="Add an IMDb rating badge to each poster"
          checked={data.showCardRatings ?? false}
          onChange={(v) => update.mutate({ showCardRatings: v })}
        />
        {(data.showCardRatings ?? false) && (
          <PickRow title="Rating position">
            <Dropdown
              label="Rating position"
              value={data.cardRatingPosition === "below" ? "below" : "poster"}
              onChange={(v) => update.mutate({ cardRatingPosition: v })}
              options={[
                { value: "poster", label: "On the poster" },
                { value: "below", label: "Under the poster" },
              ]}
            />
          </PickRow>
        )}
        <ToggleRow
          title="Colour-code IMDb ratings"
          caption="Green from 7, amber from 5, red below. Off: every score in IMDb yellow"
          checked={data.ratingColors ?? false}
          onChange={(v) => update.mutate({ ratingColors: v })}
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

// --- Anime -----------------------------------------------------------------

/** The Anime section's own preferences (kept in prefs, and follow the profile). With it off, there's only the switch. */
function AnimePage() {
  const prefs = usePrefs();
  const shelfVisible = useShelfVisible();
  const [groups, setGroups] = useState(prefs.animePreferredGroups);
  useEffect(() => setGroups(prefs.animePreferredGroups), [prefs.animePreferredGroups]);
  // Saved tidy: one ", " between groups, so the box shows what's in effect.
  const tidyGroups = preferredGroups(groups).join(", ");
  const section = (
    <Card footer={prefs.animeEnabled ? undefined : "Your watch history and saved titles stay as they are."}>
      <ToggleRow
        title="Show Anime"
        caption="The Anime section, in desktop and TV mode"
        checked={prefs.animeEnabled}
        onChange={(v) => setPrefs({ animeEnabled: v })}
      />
    </Card>
  );
  if (!prefs.animeEnabled) return section;
  return (
    <>
      {section}
      <Card title="Language">
        <PickRow title="Anime titles" caption="Tower of Glass, Garasu no Tou, or ガラスの塔. Episode titles follow when they can">
          <Dropdown
            label="Anime titles"
            value={prefs.animeTitles}
            onChange={(v) => setPrefs({ animeTitles: v })}
            options={[
              { value: "english", label: "English" },
              { value: "romaji", label: "Romaji" },
              { value: "native", label: "Japanese" },
            ]}
          />
        </PickRow>
        <PickRow title="Voice actors" caption="Whose voices to list beside the characters">
          <Dropdown
            label="Voice actors"
            value={prefs.animeVoices}
            onChange={(v) => setPrefs({ animeVoices: v })}
            options={[
              { value: "japanese", label: "Japanese" },
              { value: "english", label: "English" },
            ]}
          />
        </PickRow>
      </Card>
      <Card title="Shelves" footer="What the Anime page shows, top to bottom, in desktop and TV mode. Featured is the carousel at the top; Genres adds a shelf for each genre.">
        <div className="settings-row settings-chip-row">
          <div className="srcf-tags" role="group" aria-label="Shelves on the Anime page">
            {ANIME_SHELVES.map((s) => {
              const on = shelfVisible(s.id);
              return (
                <ToggleChip key={s.id} on={on} label={s.label} onToggle={() => setShelfVisible(s.id, !on)} />
              );
            })}
          </div>
        </div>
      </Card>
      <Card title="Cards">
        <ToggleRow title="Show scores" caption="The AniList score on each poster" checked={prefs.animeCardScores} onChange={(v) => setPrefs({ animeCardScores: v })} />
        <PickRow title="Score format">
          <Dropdown
            label="Score format"
            value={prefs.animeScoreFormat}
            onChange={(v) => setPrefs({ animeScoreFormat: v })}
            options={[
              { value: "ten", label: "Out of ten (8.6)" },
              { value: "percent", label: "Percentage (86%)" },
            ]}
          />
        </PickRow>
        <ToggleRow
          title="Show airing countdowns"
          caption="When the next episode lands, on shows that are on air"
          checked={prefs.animeCardCountdown}
          onChange={(v) => setPrefs({ animeCardCountdown: v })}
        />
      </Card>
      <Card title="Schedule">
        <ToggleRow
          title="List every show"
          caption="Include the shorts and regional shows most people aren't following"
          checked={prefs.animeScheduleAll}
          onChange={(v) => setPrefs({ animeScheduleAll: v })}
        />
      </Card>
      <Card title="Episodes" footer="Blurring unwatched pictures and hiding their descriptions are under Browsing → Spoilers, and apply here too.">
        <ToggleRow
          title="Skip filler episodes"
          caption="Next Episode and autoplay pass over episodes marked as filler. They stay in the list, marked Filler"
          checked={prefs.animeSkipFiller}
          onChange={(v) => setPrefs({ animeSkipFiller: v })}
        />
        <ToggleRow
          title="Hide recap episodes"
          caption="Leave episodes MyAnimeList marks as recaps out of the list"
          checked={prefs.animeHideRecaps}
          onChange={(v) => setPrefs({ animeHideRecaps: v })}
        />
        <ToggleRow
          title="Hide 4K sources"
          caption="Anime is almost never made in 4K: nearly all of those releases are AI upscales of the 1080p master"
          checked={prefs.animeNo4k}
          onChange={(v) => setPrefs({ animeNo4k: v })}
        />
        <ToggleRow
          title="Show spoiler tags"
          caption="Tags that give away the story, on an anime's Details"
          checked={prefs.animeSpoilerTags}
          onChange={(v) => setPrefs({ animeSpoilerTags: v })}
        />
      </Card>
      <Card
        title="Preferred Release Groups"
        footer="Their sources go to the top of an anime's source list and are what autoplay picks first, in the order you list them. Separate with commas. Filters and other sorts still apply."
      >
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            setPrefs({ animePreferredGroups: tidyGroups });
            setGroups(tidyGroups);
          }}
        >
          <TextField
            placeholder="Group A, Group B"
            value={groups}
            onChange={setGroups}
            spellCheck={false}
            aria-label="Preferred release groups"
          />
          <Button variant="primary" disabled={tidyGroups === prefs.animePreferredGroups}>
            Save
          </Button>
        </form>
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
        <ToggleRow
          title="Crop black bars"
          caption="Some files carry black bars inside the picture. This finds and trims them so the film fills a wide or ultrawide screen. Uses a little more CPU."
          checked={prefs.autocrop}
          disabled={hasMpv === false}
          onChange={(v) => setPrefs({ autocrop: v })}
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
        Your library, history, profiles, add-ons, keyboard shortcuts, and API keys stay as they are.
      </p>
      <div className="settings-expand-actions">
        <Button variant="danger" disabled={reset.isPending} onClick={() => reset.mutate()}>
          <Reset size={15} /> Reset Settings
        </Button>
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

// --- Controls & TV ---------------------------------------------------------

function ControlsPage() {
  const prefs = usePrefs();

  return (
    <>
      <Card title="TV Mode">
        <div className="settings-row">
          <RowText title="TV mode" caption="A fullscreen interface for the couch, made for a remote or controller." />
          <Button onClick={() => setTvMode(true)}>
            Open TV Mode
          </Button>
        </div>
        <ToggleRow
          title="TV mode button in the top bar"
          caption="Off hides it; TV mode stays one click away here"
          checked={prefs.showTvButton}
          onChange={(v) => setPrefs({ showTvButton: v })}
        />
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
          <NumberRow
            title="Sound volume"
            value={Math.round(prefs.uiSoundVolume * 100)}
            min={5}
            max={100}
            step={5}
            unit="%"
            onChange={(n) => {
              setPrefs({ uiSoundVolume: n / 100 });
              playSound("select", { force: true });
            }}
          />
        )}
      </Card>
      <ShortcutSettings />
    </>
  );
}

// --- Controller --------------------------------------------------------------

/** Where each button sits, the same on every maker's controller (the glyph says what it's called). */
const PAD_BUTTON_NAMES: Record<PadButton, string> = {
  a: "Bottom button",
  b: "Right button",
  x: "Left button",
  y: "Top button",
  lb: "Left bumper",
  rb: "Right bumper",
  menu: "Menu / Start",
  view: "View / Select",
};

/** The button just pressed on a controller, for a moment, so you can find its row by pressing it. */
function usePressedButton() {
  const last = useLastPadPress();
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    if (!last || performance.now() - last.at > 700) return;
    setLit(last.button);
    const t = window.setTimeout(() => setLit(null), 700);
    return () => window.clearTimeout(t);
  }, [last]);
  return lit;
}

function PadBindingRow({ layout, button, lit }: { layout: Layout; button: PadButton; lit: boolean }) {
  const bindings = usePadBindings();
  const actions: { id: string; label: string }[] = layout === "nav" ? NAV_ACTIONS : PLAYER_ACTIONS;
  // A button that's alone in doing Select or Back can only trade it for another button's job.
  const options = actions
    .filter((a) => canBind(bindings, layout, button, a.id as never))
    .map((a) => ({ value: a.id, label: a.label }));
  const name = PAD_BUTTON_NAMES[button];
  return (
    <div className="settings-row pad-binding-row" data-lit={lit || undefined}>
      <span className="pad-binding-button">
        <PadGlyph button={button} />
        <RowText title={name} />
      </span>
      <Dropdown
        label={`${name} ${layout === "nav" ? "while browsing" : "in the player"}`}
        value={bindings[layout][button] as string}
        options={options}
        onChange={(v) => setPadBinding(layout, button, v as never)}
      />
    </div>
  );
}

function PadBindingsCard({ layout, title, footer }: { layout: Layout; title: string; footer: string }) {
  const bindings = usePadBindings();
  const lit = usePressedButton();
  return (
    <Card title={title} footer={footer}>
      {PAD_BUTTONS.map((b) => (
        <PadBindingRow key={b} layout={layout} button={b} lit={lit === b} />
      ))}
      <div className="settings-row">
        <RowText title="Standard layout" caption="Put every button back as it came" />
        <Button disabled={!padBindingsCustomized(bindings, layout)} onClick={() => resetPadBindings(layout)}>
          <Reset size={15} />
          Reset
        </Button>
      </div>
    </Card>
  );
}

function ControllerPage() {
  const prefs = usePrefs();
  const connected = useGamepadConnected();
  const detected = useControllerDetected();

  return (
    <>
      <Card title="Controller">
        <div className="settings-row">
          <RowText
            title={connected ? "Controller connected" : detected ? "Controller found" : "No controller connected"}
            caption={
              connected
                ? "Press a button to find its row below"
                : detected
                  ? "Press any button on it to start using it"
                  : "Plug one in or switch it on. Xbox, PlayStation and most others work"
            }
          />
        </div>
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
        <PickRow title="Button labels" caption="The letters or shapes shown for each button">
          <Dropdown
            label="Button labels"
            value={prefs.padLabels}
            onChange={(v) => setPrefs({ padLabels: v })}
            options={[
              { value: "auto", label: "Match the controller" },
              { value: "xbox", label: "Xbox" },
              { value: "playstation", label: "PlayStation" },
              { value: "nintendo", label: "Nintendo" },
            ]}
          />
        </PickRow>
        <ToggleRow
          title="Button hints"
          caption="What each button does, along the bottom of TV mode"
          checked={prefs.padHints}
          onChange={(v) => setPrefs({ padHints: v })}
        />
      </Card>

      <Card title="D-pad & Stick">
        <PickRow title="Repeat speed" caption="How fast a held direction keeps moving">
          <Dropdown
            label="Repeat speed"
            value={prefs.padRepeat}
            onChange={(v) => setPrefs({ padRepeat: v })}
            options={[
              { value: "slow", label: "Slow" },
              { value: "normal", label: "Normal" },
              { value: "fast", label: "Fast" },
            ]}
          />
        </PickRow>
        <ToggleRow
          title="Left stick moves too"
          caption="Use the stick like the D-pad"
          checked={prefs.padStick}
          onChange={(v) => setPrefs({ padStick: v })}
        />
        {prefs.padStick && (
          <PickRow title="Stick sensitivity" caption="How far to tilt it before it moves">
            <Dropdown
              label="Stick sensitivity"
              value={prefs.padStickSensitivity}
              onChange={(v) => setPrefs({ padStickSensitivity: v })}
              options={[
                { value: "low", label: "Low (tilt further)" },
                { value: "normal", label: "Normal" },
                { value: "high", label: "High (a light touch)" },
              ]}
            />
          </PickRow>
        )}
        <ToggleRow
          title="Up and down change the volume"
          caption="In the player. Off: leave the volume to your TV or speakers"
          checked={prefs.padPlayerVolume}
          onChange={(v) => setPrefs({ padPlayerVolume: v })}
        />
      </Card>

      <PadBindingsCard
        layout="nav"
        title="Buttons while browsing"
        footer="Give a button a job another one has and the two swap. Select and Back always keep a button."
      />
      <PadBindingsCard
        layout="player"
        title="Buttons in the player"
        footer="Left and right skip by the seek step under Playback. In the menus over the video, your Select and Back buttons work as they do everywhere else."
      />
    </>
  );
}

// --- Add-ons ---------------------------------------------------------------

const hintsTried = new Set<string>();

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

  // Manifests saved before behaviour hints were kept: refetch them once so
  // the Configure button can show.
  useEffect(() => {
    const stale = addons?.filter((a) => a.manifest.behaviorHints == null && !hintsTried.has(a.manifestUrl)) ?? [];
    if (!stale.length) return;
    for (const a of stale) hintsTried.add(a.manifestUrl);
    void Promise.allSettled(stale.map((a) => api.installAddon(a.manifestUrl))).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons]);

  return (
    <>
      {!!addons?.length && (
        <Card title="Installed">
          {addons.map((a) => (
            <ExpandRow key={a.manifest.id} icon={Puzzle} title={a.manifest.name} {...expand(a.manifest.id)}>
              {a.manifest.description && <p className="settings-expand-text">{a.manifest.description}</p>}
              <p className="settings-expand-text settings-url">{a.manifestUrl}</p>
              <div className="settings-expand-actions">
                {a.manifest.behaviorHints?.configurable && (
                  <Button
                    onClick={() => void api.openExternal(a.manifestUrl.replace(/\/manifest\.json$/, "/configure"))}
                    title="Opens the addon's settings page. Install the new link it gives you to apply them."
                  >
                    <Cog size={15} /> Configure
                  </Button>
                )}
                <Button variant="danger" onClick={() => remove.mutate(a.manifest.id)} disabled={remove.isPending}>
                  <Trash size={15} /> Remove
                </Button>
              </div>
            </ExpandRow>
          ))}
        </Card>
      )}
      <Card
        title="Install from URL"
        footer="Looking for something to add? Browse the Marketplace."
      >
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) install.mutate(url.trim());
          }}
        >
          <TextField
            placeholder="https://…/manifest.json"
            value={url}
            onChange={setUrl}
            spellCheck={false}
          />
          <Button variant="primary" disabled={install.isPending || !url.trim()}>
            <Plus size={16} /> {install.isPending ? "Installing…" : "Install"}
          </Button>
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
  const save = useSaveSettings(() => qc.invalidateQueries({ queryKey: ["ratings"] }));
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
          save.mutate({ mdblistKey: mdb.trim() || null, omdbKey: omdb.trim() || null });
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
        <TextField
          type="password"
          placeholder="Paste your key"
          value={key}
          onChange={setKey}
          spellCheck={false}
          autoComplete="off"
        />
        <Button variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
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
