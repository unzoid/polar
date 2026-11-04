import { useMemo } from "react";
import { cardMenu } from "../components/CardMenu";
import { Img } from "../components/Img";
import { byDay, dayLabel, useCalendar, type CalendarEntry } from "../lib/calendar";
import { useRouter } from "../lib/router";
import { episodeEntry } from "../lib/watched";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";

/**
 * Episodes of your shows by the day they air (Settings → Browsing → Show the
 * Calendar): the last week, then what's coming. Each opens its show.
 */
export function Calendar() {
  const { entries, loading, showCount } = useCalendar();
  const days = useMemo(() => byDay(entries), [entries]);
  const firstUpcoming = days.findIndex((d) => !dayLabel(d.day).past);

  return (
    <div className="scroll">
      <header className="screen-header">
        <div>
          <h1 className="t-title1">Calendar</h1>
          <p className="calendar-sub t-callout muted">New episodes of the shows in your library and the ones you watch.</p>
        </div>
      </header>
      {showCount === 0 && !loading && (
        <EmptyState className="calendar-empty">Add shows to your library, or start watching one, and their new episodes show up here.</EmptyState>
      )}
      {showCount > 0 && !loading && !days.length && (
        <EmptyState className="calendar-empty">Nothing aired in the last week, and nothing's scheduled yet for your shows.</EmptyState>
      )}
      {loading && !days.length && (
        <div className="calendar">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="calendar-day">
              <Skeleton shape="line" width={120} />
              <div className="calendar-items">
                <Skeleton className="calendar-item" height={96} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="calendar">
        {days.map((d, i) => {
          const label = dayLabel(d.day);
          return (
            <section key={d.day} className="calendar-day" data-past={label.past} data-today={label.today}>
              {i === firstUpcoming && i > 0 && <div className="calendar-now t-micro">Coming up</div>}
              <h2 className="calendar-date">
                <span className="calendar-date-name">{label.name}</span>
                <span className="calendar-date-day">{label.date}</span>
              </h2>
              <div className="calendar-items">
                {d.entries.map((e) => (
                  <CalendarItem key={e.video.id} entry={e} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CalendarItem({ entry: { show, video } }: { entry: CalendarEntry }) {
  const { navigate } = useRouter();
  return (
    <button
      className="calendar-item"
      onClick={() => navigate({ name: "detail", type: "series", id: show.id, preview: show })}
      {...cardMenu(show, episodeEntry(show, video), { episode: true })}
    >
      <span className="calendar-art">
        <Img src={video.thumbnail ?? show.background ?? show.poster} alt="" />
      </span>
      <span className="calendar-text">
        <span className="calendar-show">{show.name}</span>
        <span className="calendar-episode t-callout">
          S{video.season} E{video.episode}
          {video.title && !/^Episode \d+$/.test(video.title) ? ` · ${video.title}` : ""}
        </span>
      </span>
    </button>
  );
}
