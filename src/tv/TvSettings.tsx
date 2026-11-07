import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "../components/icons";
import { ANIME_SHELVES, setShelfVisible, useShelfVisible } from "../lib/anime";
import { choicesOf, numberLabel, shownNumber, storedNumber, tvNumberSteps, usePrefs, useSetting } from "../lib/settings";
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

type CategoryId = "playback" | "sources" | "browsing" | "anime" | "tv";

const CATEGORIES: { id: CategoryId; title: string }[] = [
  { id: "playback", title: "Playback" },
  { id: "sources", title: "Sources" },
  { id: "browsing", title: "Browsing" },
  { id: "anime", title: "Anime" },
  { id: "tv", title: "Remote and Controller" },
];

/** A list of categories; Enter opens one, Back returns to the list on the one you left. `page` opens one at the start. */
export function TvSettings({ page }: { page?: string }) {
  const active = usePageActive();
  const asked = CATEGORIES.find((c) => c.id === page)?.id ?? null;
  const [open, setOpen] = useState<CategoryId | null>(asked);
  const [focused, setFocused] = useState<CategoryId>(asked ?? "playback");
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

/** Each category's settings, by schema id (lib/settings/schema.ts); the first row takes focus. */
const ROWS: Record<Exclude<CategoryId, "anime">, string[]> = {
  playback: [
    "autoplayNext",
    "autoplayCountdown",
    "stillWatchingAfter",
    "autoSkip",
    "autoSkipDelay",
    "autocrop",
    "resumePlayback",
    "seekStep",
    "audioLanguage",
    "subtitleLanguage",
  ],
  sources: ["autoPickSource", "maxResolution", "preferScreenResolution", "hideCam", "sourceSort", "sourceFiltersHide"],
  browsing: ["trailerAutoplay", "trailerSound", "showCardRatings", "cardRatingPosition", "matureContent", "showCalendar", "showContinueWatching"],
  tv: ["uiSounds", "uiSoundVolume", "padHints", "padStick", "padPlayerVolume", "controllerAlerts"],
};

const ANIME_ROWS = ["animeTitles", "animeAudioLanguage", "animeSubtitleLanguage", "animeCardScores", "animeScoreFormat", "animeCardCountdown", "animeSeparateEntries"];

function CategoryRows({ id }: { id: CategoryId }) {
  const prefs = usePrefs();
  const shelfVisible = useShelfVisible();

  if (id !== "anime") return ROWS[id].map((setting, i) => <SettingRow key={setting} id={setting} first={i === 0} />);
  return (
    <>
      <SettingRow id="animeEnabled" first />
      {prefs.animeEnabled && (
        <>
          {ANIME_ROWS.map((setting) => (
            <SettingRow key={setting} id={setting} />
          ))}
          {ANIME_SHELVES.filter((s) => s.id !== "hero").map((s) => (
            <Row key={s.id} label={s.label} choices={onOff} value={shelfVisible(s.id)} onChange={(v) => setShelfVisible(s.id, v)} />
          ))}
        </>
      )}
    </>
  );
}

/** A schema setting as a TV row: its TV label, and its choices or the number steps to move through. */
function SettingRow({ id, first }: { id: string; first?: boolean }) {
  const { def, value, set } = useSetting(id);
  const control = def.control;
  if (value === undefined || !control) return null;
  const label = def.tv ?? def.title;

  switch (control.kind) {
    case "toggle":
      return <Row label={label} choices={onOff} value={!!value} onChange={set} first={first} />;
    case "choice":
      return <Row label={label} choices={choicesOf(control, value)} value={value} onChange={set} first={first} />;
    case "number": {
      const shown = shownNumber(control, Number(value));
      const choices = tvNumberSteps(control, shown).map((n) => ({ value: n, label: numberLabel(control, n) }));
      return <Row label={label} choices={choices} value={shown} onChange={(n) => set(storedNumber(control, n))} first={first} />;
    }
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
