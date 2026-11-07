import { useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "../components/icons";
import { Img } from "../components/Img";
import { Spinner } from "../components/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { byDay, dayLabel, monthWeeks, useCalendar, weekDays, weekStart, type CalendarEntry } from "../lib/catalog";
import { useRouter } from "../lib/router";
import { useBack, useFocusTrap } from "./shell";
import { focusWhenReady } from "./spatial";

const dayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayNum = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const monthDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const yearOnly = new Intl.DateTimeFormat(undefined, { year: "numeric" });

/** "9 – 15 November", "30 November – 6 December", with the year when it isn't this one. */
function weekRange(days: number[]) {
  const a = new Date(days[0]);
  const b = new Date(days[6]);
  const range = a.getMonth() === b.getMonth() ? `${dayNum.format(a)} – ${monthDay.format(b)}` : `${monthDay.format(a)} – ${monthDay.format(b)}`;
  return b.getFullYear() === new Date().getFullYear() ? range : `${range} ${yearOnly.format(b)}`;
}

/** A week, near enough: rounding absorbs a DST hour. */
const WEEK = 7 * 86_400_000;
const aired = (v: { released?: string }) => !!v.released && Date.parse(v.released) <= Date.now();
const episodeTitle = (title?: string) => (title && !/^Episode \d+$/.test(title) ? title : undefined);

/**
 * The Calendar in TV mode: a week at a time, a column per day like a TV guide,
 * today marked. The focused episode is told about along the bottom. The week
 * pages from the arrows up top, or the calendar button picks one from a month grid.
 */
export function TvCalendar() {
  const { entries, loading, showCount } = useCalendar(true, true);
  const byDate = useMemo(() => new Map(byDay(entries).map((d) => [d.day, d.entries])), [entries]);
  const thisWeekStart = weekStart(Date.now());
  const [offset, setOffset] = useState(0);
  const start = weekStart(Date.now(), offset);
  const days = weekDays(start);
  const [focused, setFocused] = useState<CalendarEntry | null>(null);
  const [picking, setPicking] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLButtonElement>(null);
  const { navigate } = useRouter();

  if (!loading && !entries.length) {
    return (
      <div className="tv-note">
        <h1 className="tv-heading">Calendar</h1>
        <EmptyState variant="tv">
          {showCount === 0
            ? "Add shows to your library, or start watching one, and their new episodes show up here."
            : "None of your shows have air dates yet."}
        </EmptyState>
      </div>
    );
  }

  const hasEpisodes = (weekFrom: number) => weekDays(weekFrom).some((d) => byDate.has(d));
  /**
   * To the week starting `to`. With `land`, focus goes into it (the button pressed is gone, or the
   * picker closed); a week with nothing in it keeps focus on the calendar button instead.
   */
  const show = (to: number, land: boolean) => {
    setOffset(Math.round((to - thisWeekStart) / WEEK));
    setFocused(null);
    if (!land) return;
    if (hasEpisodes(to)) requestAnimationFrame(() => focusWhenReady(grid.current));
    else requestAnimationFrame(() => chooser.current?.focus());
  };
  const thisWeek = offset === 0;
  const todayIndex = days.findIndex((d) => dayLabel(d).today);
  const firstWithEpisodes = days.findIndex((d) => byDate.has(d));
  const empty = !loading && firstWithEpisodes < 0;

  return (
    <div className="tv-cal">
      <header className="tv-cal-head">
        <div>
          <h1 className="tv-heading">Calendar</h1>
          <p className="tv-cal-range">
            {thisWeek ? "This week" : weekRange(days)}
            {thisWeek && <span> · {weekRange(days)}</span>}
            {loading && <Spinner size={18} label="Loading" />}
          </p>
        </div>
        <div className="tv-cal-pager">
          {!thisWeek && (
            <button className="tv-cal-page" onClick={() => show(thisWeekStart, true)}>
              This Week
            </button>
          )}
          <button className="tv-cal-page tv-cal-icon" aria-label="Previous week" onClick={() => show(weekStart(start, -1), false)}>
            <ChevronLeft size={26} />
          </button>
          <button className="tv-cal-page tv-cal-icon" aria-label="Choose a week" ref={chooser} onClick={() => setPicking(true)}>
            <Calendar size={24} />
          </button>
          <button className="tv-cal-page tv-cal-icon" aria-label="Next week" onClick={() => show(weekStart(start, 1), false)}>
            <ChevronRight size={26} />
          </button>
        </div>
      </header>

      <div className="tv-cal-grid" ref={grid} data-nav-memory>
        {days.map((day, i) => {
          const label = dayLabel(day);
          const items = byDate.get(day) ?? [];
          return (
            <section key={day} className="tv-cal-day" data-past={label.past} data-today={label.today} aria-label={longDay.format(day)}>
              <h2 className="tv-cal-date">
                <span className="tv-cal-weekday">{label.today ? "Today" : dayName.format(day)}</span>
                <span className="tv-cal-num tabular">{dayNum.format(day)}</span>
              </h2>
              <div className="tv-cal-items">
                {items.map((e, j) => (
                  <button
                    key={e.video.id}
                    className="tv-cal-item"
                    // First focus: today's first episode (or the week's first, on another week).
                    data-nav-default={(todayIndex >= 0 && byDate.has(days[todayIndex]) ? i === todayIndex : i === firstWithEpisodes) && j === 0 ? "" : undefined}
                    onFocus={() => setFocused(e)}
                    onClick={() => navigate({ name: "detail", type: "series", id: e.show.id, preview: e.show })}
                  >
                    <span className="tv-cal-art">
                      {/* An episode still to air has no still yet: the show's art instead. */}
                      <Img src={aired(e.video) ? e.video.thumbnail : undefined} fallbacks={[e.show.background, e.show.poster]} alt="" />
                      <span className="tv-cal-code tabular">
                        S{e.video.season} E{e.video.episode}
                      </span>
                    </span>
                    <span className="tv-cal-show">{e.show.name}</span>
                    {episodeTitle(e.video.title) && <span className="tv-cal-title">{episodeTitle(e.video.title)}</span>}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {empty && <p className="tv-cal-none">No episodes of your shows this week.</p>}

      <footer className="tv-cal-detail" aria-live="polite">
        {focused ? (
          <>
            <span className="tv-cal-detail-kicker">
              {dayLabel(focused.day).past ? "Aired" : "Airs"} {longDay.format(focused.day)} · S{focused.video.season} E{focused.video.episode}
            </span>
            <strong className="tv-cal-detail-title">
              {focused.show.name}
              {episodeTitle(focused.video.title) && <span> · {episodeTitle(focused.video.title)}</span>}
            </strong>
            {focused.video.overview && <p className="tv-cal-detail-text">{focused.video.overview}</p>}
          </>
        ) : (
          <span className="tv-cal-detail-kicker">New episodes of the shows in your library and the ones you watch.</span>
        )}
      </footer>

      {picking && (
        <TvWeekPicker
          selected={start}
          hasEpisodes={(d) => byDate.has(d)}
          onClose={() => setPicking(false)}
          onPick={(week) => {
            setPicking(false);
            show(week, true);
          }}
        />
      )}
    </div>
  );
}

/**
 * Choose Week: a month at a time, a row per week (the whole row is one choice,
 * so the remote moves a week per press), a dot under days with episodes. The
 * arrows beside the month's name turn it. Back closes it.
 */
function TvWeekPicker({
  selected,
  hasEpisodes,
  onPick,
  onClose,
}: {
  selected: number;
  hasEpisodes: (day: number) => boolean;
  onPick: (weekStart: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  useBack(true, onClose);
  // Open on the month most of the chosen week is in (its 4th day).
  const [month, setMonth] = useState(() => {
    const mid = new Date(weekDays(selected)[3]);
    return { year: mid.getFullYear(), month: mid.getMonth() };
  });
  const weeks = monthWeeks(month.year, month.month);
  const turn = (by: number) => {
    const d = new Date(month.year, month.month + by, 1);
    setMonth({ year: d.getFullYear(), month: d.getMonth() });
  };
  const current = weekStart(Date.now());
  const names = weekDays(weeks[0]).map((d) => dayName.format(d));

  return (
    <div className="tv-week-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tv-week" ref={ref} data-nav-scope role="dialog" aria-label="Choose a week">
        <header className="tv-week-head">
          <button className="tv-week-turn" onClick={() => turn(-1)} aria-label="Previous month">
            <ChevronLeft size={26} />
          </button>
          <h2 className="tv-week-month">{monthYear.format(new Date(month.year, month.month, 1))}</h2>
          <button className="tv-week-turn" onClick={() => turn(1)} aria-label="Next month">
            <ChevronRight size={26} />
          </button>
        </header>
        <div className="tv-week-names" aria-hidden>
          {names.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
        <div className="tv-week-rows">
          {weeks.map((w) => {
            const days = weekDays(w);
            return (
              <button
                key={w}
                className="tv-week-row"
                data-selected={w === selected || undefined}
                data-current={w === current || undefined}
                data-nav-default={w === selected || (!weeks.includes(selected) && w === weeks[0]) ? "" : undefined}
                aria-label={weekRange(days)}
                onClick={() => onPick(w)}
              >
                {days.map((d) => {
                  const date = new Date(d);
                  return (
                    <span
                      key={d}
                      className="tv-week-day tabular"
                      data-out={date.getMonth() !== month.month || undefined}
                      data-today={dayLabel(d).today || undefined}
                      data-episodes={hasEpisodes(d) || undefined}
                    >
                      {date.getDate()}
                    </span>
                  );
                })}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
