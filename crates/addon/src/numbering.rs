//! One episode numbering for every `tt…` show: IMDb's, as Cinemeta lists it.
//!
//! TMDB numbers seasons its own way for many shows (anime above all), so
//! `tt…:2:5` from TMDB and from Cinemeta can be different episodes. Stream
//! addons look episodes up by IMDb numbering, and progress is stored under the
//! video id, so the index keeps TMDB's titles, stills and overviews but gives
//! each episode the id IMDb has for it (docs/anime-identity.md, step 6).
//!
//! Episodes are matched by air date, which survives every numbering scheme;
//! the season/episode numbers only decide between episodes of the same day,
//! or stand in when one side has no date or the dates are a few days apart.

use std::collections::HashSet;

use crate::Video;

/// How far apart the same season and episode may be dated and still match;
/// under half a week, so a weekly show's neighbours never do.
const EARLY_DAYS: i64 = 3;

/// TMDB's `videos` renumbered onto IMDb's (`imdb`, from Cinemeta).
///
/// * A TMDB episode aired within a day of an IMDb one takes that one's id,
///   season and episode; its own title, still, overview and rating stay.
/// * Failing that, the same season and episode up to [`EARLY_DAYS`] apart
///   match: one side often has the streaming release, the other the later TV
///   date. The merged episode carries the earlier of the two dates.
/// * Without a usable date on either side, the same season and episode match.
/// * IMDb episodes nothing matched are added as Cinemeta has them, so every
///   episode an addon can resolve is listed.
/// * A TMDB episode nothing matched stays under its own numbers, unless IMDb
///   uses that id for another episode: then it is left out rather than shown
///   under an id that plays something else.
///
/// The result is ordered by season and episode.
pub fn renumber(videos: Vec<Video>, imdb: &[Video]) -> Vec<Video> {
    if imdb.is_empty() {
        return videos;
    }
    let mut used = vec![false; imdb.len()];
    let mut out = Vec::with_capacity(imdb.len().max(videos.len()));
    let mut unmatched = Vec::new();

    for v in videos {
        match pick(&v, imdb, &used) {
            Some(i) => {
                used[i] = true;
                let r = &imdb[i];
                out.push(Video {
                    id: r.id.clone(),
                    season: r.season,
                    episode: r.episode,
                    released: earliest(v.released, r.released.clone()),
                    thumbnail: v.thumbnail.or_else(|| r.thumbnail.clone()),
                    overview: v.overview.or_else(|| r.overview.clone()),
                    rating: v.rating.or_else(|| r.rating.clone()),
                    title: v.title,
                });
            }
            None => unmatched.push(v),
        }
    }

    out.extend(imdb.iter().zip(&used).filter(|(_, u)| !**u).map(|(r, _)| r.clone()));
    let taken: HashSet<String> = imdb.iter().map(|r| r.id.clone()).collect();
    out.extend(unmatched.into_iter().filter(|v| !taken.contains(&v.id)));
    out.sort_by_key(|v| (v.season, v.episode));
    out
}

/// Which unused IMDb episode is `v`?
fn pick(v: &Video, imdb: &[Video], used: &[bool]) -> Option<usize> {
    let free = || imdb.iter().enumerate().filter(|(i, _)| !used[*i]);
    let same_number = |r: &Video| r.season == v.season && r.episode == v.episode;

    if let Some(day) = v.released.as_deref().and_then(day_number) {
        let near: Vec<(usize, &Video, i64)> = free()
            .filter_map(|(i, r)| {
                let gap = (r.released.as_deref().and_then(day_number)? - day).abs();
                (gap <= 1).then_some((i, r, gap))
            })
            .collect();
        if let Some((i, ..)) = near.iter().find(|(_, r, _)| same_number(r)) {
            return Some(*i);
        }
        // Several on one day (double episodes): the closest date, then the
        // first in IMDb's order, so a day's episodes pair up in order.
        if let Some((i, ..)) = near.iter().min_by_key(|(_, r, gap)| (*gap, r.season, r.episode)) {
            return Some(*i);
        }
        // Dated here; only the same numbers a few days off, or undated, can still be it.
        return free()
            .find(|(_, r)| {
                same_number(r)
                    && r.released.as_deref().and_then(day_number).is_none_or(|d| (d - day).abs() <= EARLY_DAYS)
            })
            .map(|(i, _)| i);
    }
    free().find(|(_, r)| same_number(r)).map(|(i, _)| i)
}

/// The earlier of two air dates; a date that doesn't parse loses to one that does.
fn earliest(a: Option<String>, b: Option<String>) -> Option<String> {
    match (a.as_deref().and_then(day_number), b.as_deref().and_then(day_number)) {
        (Some(x), Some(y)) if y < x => b,
        (Some(_), _) => a,
        (None, Some(_)) => b,
        (None, None) => a.or(b),
    }
}

/// Days since 1970-01-01 of an ISO date or date-time (`2008-01-20`,
/// `2008-01-20T00:00:00.000Z`); only the date part counts.
fn day_number(iso: &str) -> Option<i64> {
    let date = iso.get(..10)?;
    let mut parts = date.split('-');
    let (y, m, d) =
        (parts.next()?.parse::<i64>().ok()?, parts.next()?.parse::<i64>().ok()?, parts.next()?.parse::<i64>().ok()?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // Howard Hinnant's days_from_civil.
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(season: u32, episode: u32, released: Option<&str>, title: &str) -> Video {
        Video {
            id: format!("tt1:{season}:{episode}"),
            title: title.into(),
            season,
            episode,
            released: released.map(Into::into),
            thumbnail: None,
            overview: None,
            rating: None,
        }
    }

    fn ids(list: &[Video]) -> Vec<(&str, &str)> {
        list.iter().map(|v| (v.id.as_str(), v.title.as_str())).collect()
    }

    #[test]
    fn days() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2000-03-01T00:00:00.000Z"), Some(11_017));
        assert_eq!(day_number("2024-02-29"), Some(19_782));
        assert_eq!(day_number("soon"), None);
        assert_eq!(day_number("2024-13-01"), None);
    }

    #[test]
    fn same_numbering_changes_nothing_but_keeps_tmdb_text() {
        let tmdb = vec![ep(1, 1, Some("2020-01-01"), "Pilot"), ep(1, 2, Some("2020-01-08"), "Two")];
        let mut imdb = vec![
            ep(1, 1, Some("2020-01-01T00:00:00.000Z"), "Episode 1"),
            ep(1, 2, Some("2020-01-08T00:00:00.000Z"), "Episode 2"),
        ];
        imdb[0].thumbnail = Some("imdb.jpg".into());
        let out = renumber(tmdb, &imdb);
        assert_eq!(ids(&out), [("tt1:1:1", "Pilot"), ("tt1:1:2", "Two")]);
        assert_eq!(out[0].thumbnail.as_deref(), Some("imdb.jpg"), "fills what TMDB lacks");
    }

    #[test]
    fn tmdb_seasons_split_onto_imdb_one_long_season() {
        // TMDB: two seasons of two; IMDb: one season of four.
        let tmdb = vec![
            ep(1, 1, Some("2020-01-01"), "A"),
            ep(1, 2, Some("2020-01-08"), "B"),
            ep(2, 1, Some("2020-07-01"), "C"),
            ep(2, 2, Some("2020-07-08"), "D"),
        ];
        let imdb = vec![
            ep(1, 1, Some("2020-01-01"), "1"),
            ep(1, 2, Some("2020-01-08"), "2"),
            ep(1, 3, Some("2020-07-02"), "3"), // a day later: time zones
            ep(1, 4, Some("2020-07-08"), "4"),
        ];
        let out = renumber(tmdb, &imdb);
        assert_eq!(ids(&out), [("tt1:1:1", "A"), ("tt1:1:2", "B"), ("tt1:1:3", "C"), ("tt1:1:4", "D")]);
        assert_eq!((out[2].season, out[2].episode), (1, 3));
    }

    #[test]
    fn double_episode_days_pair_up_in_order() {
        let tmdb = vec![ep(1, 1, Some("2020-01-01"), "A"), ep(1, 2, Some("2020-01-01"), "B")];
        let imdb = vec![ep(3, 7, Some("2020-01-01"), "x"), ep(3, 8, Some("2020-01-01"), "y")];
        assert_eq!(ids(&renumber(tmdb, &imdb)), [("tt1:3:7", "A"), ("tt1:3:8", "B")]);
    }

    #[test]
    fn undated_falls_back_to_numbers_but_dates_that_disagree_do_not() {
        let tmdb = vec![ep(1, 1, None, "A"), ep(1, 2, Some("2020-05-01"), "B"), ep(1, 3, Some("2020-05-08"), "C")];
        let imdb = vec![ep(1, 1, Some("2020-04-24"), "1"), ep(1, 2, Some("2020-02-01"), "2"), ep(1, 3, None, "3")];
        let out = renumber(tmdb, &imdb);
        // A has no date: same numbers. B's date matches nothing and IMDb's 1:2
        // is another episode: B is left out, 1:2 listed as IMDb has it. C: IMDb's
        // 1:3 has no date, so the numbers decide.
        assert_eq!(ids(&out), [("tt1:1:1", "A"), ("tt1:1:2", "2"), ("tt1:1:3", "C")]);
    }

    #[test]
    fn released_early_on_streaming_matches_the_later_tv_date_and_keeps_the_earlier() {
        // TMDB has the Friday streaming release, IMDb the Sunday broadcast; and the other way round.
        let tmdb = vec![ep(1, 1, Some("2020-01-03"), "A"), ep(1, 2, Some("2020-01-12"), "B")];
        let imdb =
            vec![ep(1, 1, Some("2020-01-05T00:00:00.000Z"), "1"), ep(1, 2, Some("2020-01-09T00:00:00.000Z"), "2")];
        let out = renumber(tmdb, &imdb);
        assert_eq!(ids(&out), [("tt1:1:1", "A"), ("tt1:1:2", "B")]);
        assert_eq!(out[0].released.as_deref(), Some("2020-01-03"));
        assert_eq!(out[1].released.as_deref(), Some("2020-01-09T00:00:00.000Z"));
    }

    #[test]
    fn same_numbers_a_week_apart_are_different_episodes() {
        let tmdb = vec![ep(1, 2, Some("2020-01-01"), "B")];
        let imdb = vec![ep(1, 2, Some("2020-01-08"), "2")];
        assert_eq!(ids(&renumber(tmdb, &imdb)), [("tt1:1:2", "2")]);
    }

    #[test]
    fn the_earlier_date_wins() {
        let s = |d: &str| Some(d.to_owned());
        assert_eq!(earliest(s("2020-01-05"), s("2020-01-03T00:00:00.000Z")), s("2020-01-03T00:00:00.000Z"));
        assert_eq!(earliest(s("2020-01-03"), s("2020-01-05")), s("2020-01-03"));
        assert_eq!(earliest(s("soon"), s("2020-01-05")), s("2020-01-05"));
        assert_eq!(earliest(None, s("soon")), s("soon"));
    }

    #[test]
    fn episodes_only_one_side_has_are_kept() {
        let tmdb = vec![ep(1, 1, Some("2020-01-01"), "A"), ep(1, 2, Some("2030-01-01"), "New")];
        let imdb = vec![ep(0, 1, Some("2019-06-01"), "Special"), ep(1, 1, Some("2020-01-01"), "1")];
        assert_eq!(ids(&renumber(tmdb, &imdb)), [("tt1:0:1", "Special"), ("tt1:1:1", "A"), ("tt1:1:2", "New")]);
    }

    #[test]
    fn nothing_from_imdb_keeps_tmdb() {
        let tmdb = vec![ep(2, 1, Some("2020-01-01"), "A")];
        assert_eq!(ids(&renumber(tmdb, &[])), [("tt1:2:1", "A")]);
    }
}
