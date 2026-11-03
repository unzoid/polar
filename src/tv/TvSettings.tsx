import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "../components/icons";
import { ANIME_SHELVES, setShelfVisible, useShelfVisible } from "../lib/anime/shelves";
import { PREFERRED_LANGUAGES, languageName } from "../lib/languages";
import { setPrefs, usePrefs, type Prefs } from "../lib/prefs";
import { useSettings, useUpdateSettings } from "../lib/queries";
import type { Settings, SourceSort } from "../lib/types";
import { useBack, usePageActive } from "./shell";
import { playSound } from "./sounds";
import { focusWhenReady } from "./spatial";

/**
 * Settings in TV mode: the ones you'd change from the couch, grouped into
 * categories, each setting a row you change with left and right (or Enter to step through). No text fields, so
 * no on-screen keyboard; keys, add-ons and the rest stay in desktop mode.
 */

type Choice<T> = { value: T; label: string };

const onOff: Choice<boolean>[] = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
];

const range = (min: number, max: number, step: number, label: (n: number) => string): Choice<number>[] => {
  const out: Choice<number>[] = [];
  for (let n = min; n <= max + 1e-9; n += step) out.push({ value: Math.round(n * 100) / 100, label: label(Math.round(n * 100) / 100) });
  return out;
};

const RESOLUTIONS: Choice<number>[] = [
  { value: 0, label: "Any" },
  { value: 2160, label: "4K" },
  { value: 1440, label: "1440p" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
];

const SORTS: Choice<SourceSort>[] = [
  { value: "best", label: "Best Match" },
  { value: "quality", label: "Quality" },
  { value: "sizeDesc", label: "Largest First" },
  { value: "sizeAsc", label: "Smallest First" },
  { value: "peers", label: "Most Peers" },
];

const RATING_POSITIONS: Choice<"poster" | "below">[] = [
  { value: "poster", label: "On the Poster" },
  { value: "below", label: "Below the Poster" },
];

const languages =(none: string): Choice<string>[] => [
  { value: "", label: none },
  ...PREFERRED_LANGUAGES.map((code) => ({ value: code, label: languageName(code) ?? code })),
];

const ANIME_TITLES: Choice<Prefs["animeTitles"]>[] = [
  { value: "english", label: "English" },
  { value: "romaji", label: "Romaji" },
  { value: "native", label: "Japanese" },
];

const SCORE_FORMATS: Choice<Prefs["animeScoreFormat"]>[] = [
  { value: "ten", label: "Out of Ten" },
  { value: "percent", label: "Percentage" },
];

type CategoryId = "playback" | "sources" | "browsing" | "anime" | "tv";

const CATEGORIES: { id: CategoryId; title: string }[] = [
  { id: "playback", title: "Playback" },
  { id: "sources", title: "Sources" },
  { id: "browsing", title: "Browsing" },
  { id: "anime", title: "Anime" },
  { id: "tv", title: "Remote and Controller" },
];

/** A list of categories; Enter opens one, Back returns to the list on the one you left. */
export function TvSettings() {
  const active = usePageActive();
  const [open, setOpen] = useState<CategoryId | null>(null);
  const [focused, setFocused] = useState<CategoryId>("playback");
  const listRef = useRef<HTMLDivElement>(null);

  const go = (next: CategoryId | null) => {
    setOpen(next);
    // The row you pressed is gone: land in the new list once it's in.
    requestAnimationFrame(() => focusWhenReady(listRef.current));
  };
  useBack(active && !!open, () => go(null));

  const category = open ? CATEGORIES.find((c) => c.id === open)! : null;

  return (
    <div className="tv-settings">
      <div className="tv-settings-list" ref={listRef} key={open ?? "root"} data-nav-scroll>
        {category ? (
          <>
            <p className="tv-settings-eyebrow">Settings</p>
            <h1 className="tv-heading">{category.title}</h1>
            <CategoryRows id={category.id} />
          </>
        ) : (
          <>
            <h1 className="tv-heading">Settings</h1>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="tv-settings-row"
                data-nav-default={c.id === focused || undefined}
                onFocus={() => setFocused(c.id)}
                onClick={() => go(c.id)}
              >
                <span className="tv-settings-label">{c.title}</span>
                <ChevronRight size={24} className="tv-settings-chevron" />
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function CategoryRows({ id }: { id: CategoryId }) {
  const { data: s } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  const shelfVisible = useShelfVisible();
  if (!s) return null;

  const set = (patch: Partial<Settings>) => update.mutate(patch);
  const pref = (patch: Partial<Prefs>) => setPrefs(patch);

  switch (id) {
    case "playback":
      return (
        <>
          <Row label="Play Next Episode Automatically" choices={onOff} value={s.autoplayNext} onChange={(v) => set({ autoplayNext: v })} first />
          <Row
            label="Up Next Countdown"
            choices={range(3, 60, 1, (n) => `${n} sec`)}
            value={s.autoplayCountdown}
            onChange={(v) => set({ autoplayCountdown: v })}
          />
          <Row
            label="Ask “Still Watching?”"
            choices={range(0, 12, 1, (n) => (n === 0 ? "Never" : `After ${n} episode${n === 1 ? "" : "s"}`))}
            value={s.stillWatchingAfter}
            onChange={(v) => set({ stillWatchingAfter: v })}
          />
          <Row label="Skip Intros" choices={onOff} value={s.autoSkip} onChange={(v) => set({ autoSkip: v })} />
          <Row label="Resume Where You Left Off" choices={onOff} value={s.resumePlayback} onChange={(v) => set({ resumePlayback: v })} />
          <Row
            label="Seek Step"
            choices={range(5, 120, 5, (n) => `${n} sec`)}
            value={s.seekStep}
            onChange={(v) => set({ seekStep: v })}
          />
          <Row label="Audio Language" choices={languages("File Default")} value={s.audioLanguage} onChange={(v) => set({ audioLanguage: v })} />
          <Row label="Subtitles" choices={languages("Off")} value={s.subtitleLanguage} onChange={(v) => set({ subtitleLanguage: v })} />
        </>
      );
    case "sources":
      return (
        <>
          <Row label="Play the Best Source Right Away" choices={onOff} value={s.autoPickSource} onChange={(v) => set({ autoPickSource: v })} first />
          <Row label="Highest Quality" choices={RESOLUTIONS} value={s.maxResolution} onChange={(v) => set({ maxResolution: v })} />
          <Row
            label="Match My Screen"
            choices={onOff}
            value={s.preferScreenResolution ?? true}
            onChange={(v) => set({ preferScreenResolution: v })}
          />
          <Row label="Hide CAM Recordings" choices={onOff} value={s.hideCam} onChange={(v) => set({ hideCam: v })} />
          <Row label="Sort Sources By" choices={SORTS} value={s.sourceSort} onChange={(v) => set({ sourceSort: v })} />
        </>
      );
    case "browsing":
      return (
        <>
          <Row label="Play Trailers on Title Pages" choices={onOff} value={s.trailerAutoplay ?? true} onChange={(v) => set({ trailerAutoplay: v })} first />
          <Row label="Automatic Trailer Sound" choices={onOff} value={s.trailerSound ?? false} onChange={(v) => set({ trailerSound: v })} />
          <Row label="IMDb Ratings on Cards" choices={onOff} value={s.showCardRatings ?? false} onChange={(v) => set({ showCardRatings: v })} />
          <Row
            label="Rating Position"
            choices={RATING_POSITIONS}
            value={s.cardRatingPosition ?? "poster"}
            onChange={(v) => set({ cardRatingPosition: v })}
          />
          <Row label="Calendar" choices={onOff} value={s.showCalendar ?? false} onChange={(v) => set({ showCalendar: v })} />
          <Row label="Continue Watching" choices={onOff} value={s.showContinueWatching} onChange={(v) => set({ showContinueWatching: v })} />
        </>
      );
    case "anime":
      return (
        <>
          <Row label="Show Anime" choices={onOff} value={prefs.animeEnabled} onChange={(v) => pref({ animeEnabled: v })} first />
          {prefs.animeEnabled && (
            <>
              <Row label="Titles" choices={ANIME_TITLES} value={prefs.animeTitles} onChange={(v) => pref({ animeTitles: v })} />
              <Row label="Scores" choices={onOff} value={prefs.animeCardScores} onChange={(v) => pref({ animeCardScores: v })} />
              <Row label="Score Format" choices={SCORE_FORMATS} value={prefs.animeScoreFormat} onChange={(v) => pref({ animeScoreFormat: v })} />
              <Row label="Airing Countdowns" choices={onOff} value={prefs.animeCardCountdown} onChange={(v) => pref({ animeCardCountdown: v })} />
              {ANIME_SHELVES.filter((s) => s.id !== "hero").map((s) => (
                <Row key={s.id} label={s.label} choices={onOff} value={shelfVisible(s.id)} onChange={(v) => setShelfVisible(s.id, v)} />
              ))}
            </>
          )}
        </>
      );
    case "tv":
      return (
        <>
          <Row label="Interface Sounds" choices={onOff} value={prefs.uiSounds} onChange={(v) => pref({ uiSounds: v })} first />
          <Row
            label="Sound Volume"
            choices={range(0.1, 1, 0.1, (n) => `${Math.round(n * 100)}%`)}
            value={Math.round(prefs.uiSoundVolume * 10) / 10}
            onChange={(v) => pref({ uiSoundVolume: v })}
          />
          <Row label="Button Hints" choices={onOff} value={prefs.padHints} onChange={(v) => pref({ padHints: v })} />
          <Row label="Move With the Left Stick" choices={onOff} value={prefs.padStick} onChange={(v) => pref({ padStick: v })} />
          <Row
            label="Up and Down Change Volume in the Player"
            choices={onOff}
            value={prefs.padPlayerVolume}
            onChange={(v) => pref({ padPlayerVolume: v })}
          />
          <Row label="Controller Notices" choices={onOff} value={prefs.controllerAlerts} onChange={(v) => pref({ controllerAlerts: v })} />
        </>
      );
  }
}

function Row<T>({
  label,
  choices,
  value,
  onChange,
  first,
}: {
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  first?: boolean;
}) {
  const found = choices.findIndex((c) => c.value === value);
  const i = found < 0 ? 0 : found;
  const current = found < 0 ? String(value) : choices[i].label;
  const isToggle = choices === onOff;

  const step = (by: number, wrap: boolean) => {
    let j = i + by;
    if (wrap) j = (j + choices.length) % choices.length;
    if (j < 0 || j >= choices.length) {
      playSound("edge");
      return;
    }
    playSound("move");
    onChange(choices[j].value);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      step(e.key === "ArrowLeft" ? -1 : 1, isToggle);
    }
  };

  return (
    <button
      className="tv-settings-row"
      data-nav-default={first || undefined}
      onKeyDown={onKeyDown}
      onClick={() => step(1, true)}
      aria-label={`${label}: ${current}`}
    >
      <span className="tv-settings-label">{label}</span>
      <span className="tv-settings-value" data-on={isToggle ? (value as boolean) : undefined}>
        <ChevronLeft size={22} data-dim={!isToggle && i === 0} />
        <span>{current}</span>
        <ChevronRight size={22} data-dim={!isToggle && i === choices.length - 1} />
      </span>
    </button>
  );
}
