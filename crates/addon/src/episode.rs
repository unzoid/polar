//! Which episode a stream's file is, read from its name, checked against the
//! episode that was asked for. Add-ons sometimes answer with a neighbouring
//! episode's file, and a show asked for by two ids (IMDb's season and episode,
//! an anime's Kitsu number) can bring back another episode under one of them.
//! A file that names another episode goes to the bottom of the list and is
//! never picked by itself; one that says nothing about its episode (a season
//! pack's name, a film-style title) is left as it is.

use std::sync::LazyLock;

use regex::Regex;

use crate::types::Stream;

/// The episode a request was for, in every numbering it's known by.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WantedEpisode {
    /// Season and episode from an IMDb-style id (`tt…:2:5`).
    pub season: Option<u32>,
    pub episode: Option<u32>,
    /// Numbers counted without seasons: a Kitsu id's (`kitsu:N:5`) and the
    /// absolute number the app knows for an anime episode.
    pub absolute: Vec<u32>,
}

impl WantedEpisode {
    /// From the ids a stream request asked by, plus absolute numbers the app knows.
    /// `None` for a film (or anything without an episode): nothing to check.
    pub fn from_ids<'a>(ids: impl IntoIterator<Item = &'a str>, absolute: &[u32]) -> Option<Self> {
        let mut want = WantedEpisode { absolute: absolute.to_vec(), ..Default::default() };
        for id in ids {
            let parts: Vec<&str> = id.split(':').collect();
            let num = |i: usize| parts.get(i).and_then(|p| p.parse::<u32>().ok());
            match (parts.first(), parts.len()) {
                (Some(&"kitsu"), 3) => want.absolute.extend(num(2)),
                (_, n) if n >= 3 => {
                    if let (Some(s), Some(e)) = (num(n - 2), num(n - 1)) {
                        want.season.get_or_insert(s);
                        want.episode.get_or_insert(e);
                    }
                }
                _ => {}
            }
        }
        want.absolute.sort_unstable();
        want.absolute.dedup();
        (want.episode.is_some() || !want.absolute.is_empty()).then_some(want)
    }
}

/// What a file's name says it is: one episode or a run of them, with or
/// without a season.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FileEpisode {
    pub season: Option<u32>,
    pub from: u32,
    pub to: u32,
}

impl FileEpisode {
    fn has(&self, n: u32) -> bool {
        (self.from..=self.to).contains(&n)
    }

    /// Whether this file is the episode asked for. A season the request
    /// doesn't share still matches by an absolute number: anime releases
    /// count seasons their own way.
    pub fn fits(&self, want: &WantedEpisode) -> bool {
        let absolute = want.absolute.iter().any(|&n| self.has(n));
        match self.season {
            Some(s) if want.season == Some(s) => want.episode.is_some_and(|e| self.has(e)),
            Some(_) => absolute,
            None => absolute || want.episode.is_some_and(|e| self.has(e)),
        }
    }

    /// How a source list shows it: "S01E05", "S01E05–E06", "Episode 5", "Episodes 1–12".
    pub fn label(&self) -> String {
        match (self.season, self.from == self.to) {
            (Some(s), true) => format!("S{s:02}E{:02}", self.from),
            (Some(s), false) => format!("S{s:02}E{:02}–E{:02}", self.from, self.to),
            (None, true) => format!("Episode {}", self.from),
            (None, false) => format!("Episodes {}–{}", self.from, self.to),
        }
    }
}

// Season and episode: "S01E05", "s1 e5", "S01E05E06", "S01E05-E06", "S01E05-06".
static SEASON_EP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,4})(?:(?:-e?|e)(\d{1,4})\b)?").unwrap());
// "1x05", but not "1920x1080".
static CROSS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?:[^a-z0-9]|$)").unwrap());
static WORDS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bseason[ ._]?(\d{1,2})[ ._-]*(?:episode|ep)[ ._]?(\d{1,4})\b").unwrap());
// Without a season: "E05", "Ep 5", "Episode 05".
static EP_ONLY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|[^a-z0-9])(?:episode|ep|e)[ ._]?(\d{1,4})(?:v\d)?(?:[^a-z0-9]|$)").unwrap());
// Anime style: "[Group] Show - 05 (1080p).mkv", "Show - 05v2 [x]", batches "Show - 01-12", "01 ~ 12".
static DASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s-\s(\d{1,4})(?:v\d)?(?:\s?[~-]\s?(\d{1,4})(?:v\d)?)?(?:[\s\[(]|\.[a-z0-9]{2,4}$|$)").unwrap()
});

/// What one line of text says about its episode, if anything.
fn read_season(text: &str) -> Option<FileEpisode> {
    let n = |m: Option<regex::Match>| m.and_then(|m| m.as_str().parse::<u32>().ok());
    if let Some(c) = SEASON_EP.captures(text) {
        let (from, to) = (n(c.get(2))?, n(c.get(3)));
        return Some(FileEpisode { season: n(c.get(1)), from, to: to.filter(|&t| t > from).unwrap_or(from) });
    }
    [&*CROSS, &*WORDS].iter().find_map(|re| {
        let c = re.captures(text)?;
        let e = n(c.get(2))?;
        Some(FileEpisode { season: n(c.get(1)), from: e, to: e })
    })
}

fn read_number(text: &str) -> Option<FileEpisode> {
    let n = |m: Option<regex::Match>| m.and_then(|m| m.as_str().parse::<u32>().ok());
    // A year after the dash is a title's, not an episode.
    let year = |v: &u32| (1900..2100).contains(v);
    if let Some(c) = DASH.captures(text) {
        let from = n(c.get(1)).filter(|v| !year(v))?;
        let to = n(c.get(2)).filter(|&t| t > from).unwrap_or(from);
        return Some(FileEpisode { season: None, from, to });
    }
    let e = n(EP_ONLY.captures(text)?.get(1))?;
    Some(FileEpisode { season: None, from: e, to: e })
}

/// The episode a stream's file names: `behaviorHints.filename` first, else the
/// rows the add-on wrote. A season and episode anywhere in them counts; a bare
/// number only in the file's name or the first line (the release), where it
/// can't be a size or a count.
pub fn file_episode(stream: &Stream) -> Option<FileEpisode> {
    let file = stream.behavior_hints.as_ref().and_then(|h| h.get("filename")).and_then(|f| f.as_str());
    if let Some(found) = file.and_then(|f| read_season(f).or_else(|| read_number(f))) {
        return Some(found);
    }
    let rows: Vec<&str> =
        [stream.title.as_deref(), stream.description.as_deref()].into_iter().flatten().flat_map(str::lines).collect();
    rows.iter().find_map(|l| read_season(l)).or_else(|| rows.first().and_then(|l| read_number(l)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn named(title: &str) -> Stream {
        Stream { title: Some(title.into()), ..Default::default() }
    }

    fn file(name: &str) -> Stream {
        Stream {
            title: Some("Addon row".into()),
            behavior_hints: Some(json!({ "filename": name })),
            ..Default::default()
        }
    }

    fn read(title: &str) -> Option<(Option<u32>, u32, u32)> {
        file_episode(&named(title)).map(|f| (f.season, f.from, f.to))
    }

    #[test]
    fn reads_season_and_episode_in_the_usual_spellings() {
        assert_eq!(read("Made.Up.Show.S01E05.1080p.WEB.x264"), Some((Some(1), 5, 5)));
        assert_eq!(read("Made Up Show s2 e7 720p"), Some((Some(2), 7, 7)));
        assert_eq!(read("Made.Up.Show.S01E05E06.1080p"), Some((Some(1), 5, 6)));
        assert_eq!(read("Made.Up.Show.S01E05-E06.mkv"), Some((Some(1), 5, 6)));
        assert_eq!(read("Made.Up.Show.S01E05-06.mkv"), Some((Some(1), 5, 6)));
        assert_eq!(read("Made Up Show 1x05 HDTV"), Some((Some(1), 5, 5)));
        assert_eq!(read("Made Up Show Season 2 Episode 3"), Some((Some(2), 3, 3)));
        // A resolution after the number isn't the end of a run.
        assert_eq!(read("Made.Up.Show.S01E05-1080p"), Some((Some(1), 5, 5)));
    }

    #[test]
    fn reads_numbers_without_a_season() {
        assert_eq!(read("[Group] Made Up Show - 05 (1080p) [ABCD1234].mkv"), Some((None, 5, 5)));
        assert_eq!(read("[Group] Made Up Show - 05v2 [1080p]"), Some((None, 5, 5)));
        assert_eq!(read("[Group] Made Up Show - 01-12 [Batch]"), Some((None, 1, 12)));
        assert_eq!(read("Made Up Show E05 1080p"), Some((None, 5, 5)));
        assert_eq!(read("Made Up Show Ep 112"), Some((None, 112, 112)));
        assert_eq!(read("Made Up Show - 05.mkv"), Some((None, 5, 5)));
    }

    #[test]
    fn says_nothing_for_packs_films_and_noise() {
        assert_eq!(read("Made.Up.Show.S01.1080p.WEB.x264"), None);
        assert_eq!(read("Made Up Show Season 1 Complete 1080p"), None);
        assert_eq!(read("Public Domain Film (1927) 1920x1080 H.264 5.1"), None);
        assert_eq!(read("Made Up Film - 2024 [1080p]"), None);
        assert_eq!(read("Made.Up.Film.2010.2160p.WEB-DL.DDP5.1.HEVC"), None);
    }

    #[test]
    fn the_file_name_comes_before_the_rows_and_a_bare_number_only_from_the_first_line() {
        let mut s = file("Made.Up.Show.S01E06.mkv");
        s.title = Some("Made.Up.Show.S01E05.1080p".into());
        assert_eq!(file_episode(&s).map(|f| f.from), Some(6));
        // A pack's name, then the file inside it on the next line.
        assert_eq!(read("Made.Up.Show.S01.1080p\nMade.Up.Show.S01E04.mkv"), Some((Some(1), 4, 4)));
        // " - 12 " further down is a count, not an episode.
        assert_eq!(read("Made Up Show 1080p\nsize 1.2 GB - 12 files"), None);
    }

    fn want(ids: &[&str], absolute: &[u32]) -> WantedEpisode {
        WantedEpisode::from_ids(ids.iter().copied(), absolute).unwrap()
    }

    fn fits(title: &str, w: &WantedEpisode) -> Option<bool> {
        file_episode(&named(title)).map(|f| f.fits(w))
    }

    #[test]
    fn wanted_episode_from_the_ids_asked() {
        assert_eq!(WantedEpisode::from_ids(["tt0000001"], &[]), None);
        assert_eq!(WantedEpisode::from_ids(["kitsu:12"], &[]), None);
        let w = want(&["tt0000001:2:5", "kitsu:12:17"], &[29]);
        assert_eq!((w.season, w.episode, w.absolute), (Some(2), Some(5), vec![17, 29]));
        assert_eq!(want(&["kitsu:12:3"], &[]).absolute, vec![3]);
    }

    #[test]
    fn season_numbering_against_the_request() {
        let w = want(&["tt0000001:1:5"], &[]);
        assert_eq!(fits("Made.Up.Show.S01E05.1080p", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S01E06.1080p", &w), Some(false));
        assert_eq!(fits("Made.Up.Show.S02E05.1080p", &w), Some(false));
        assert_eq!(fits("Made.Up.Show.S01E04E05.1080p", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 05 [1080p]", &w), Some(true));
        assert_eq!(fits("Made Up Show E05", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 06 [1080p]", &w), Some(false));
        assert_eq!(fits("[Group] Made Up Show - 01-12 [Batch]", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S01.1080p", &w), None);
    }

    #[test]
    fn absolute_numbering_against_season_numbering() {
        // IMDb's season 2 episode 5 is the anime's episode 17 overall, and its Kitsu entry's episode 5.
        let w = want(&["tt0000001:2:5", "kitsu:12:5"], &[17]);
        assert_eq!(fits("[Group] Made Up Show - 17 (1080p)", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show S2 - 05 (1080p)", &w), Some(true));
        assert_eq!(fits("Made.Up.Show.S02E05.1080p", &w), Some(true));
        // The release counts the second cour as its own season.
        assert_eq!(fits("Made.Up.Show.S03E05.1080p", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 18 (1080p)", &w), Some(false));
        assert_eq!(fits("Made.Up.Show.S02E06.1080p", &w), Some(false));
    }

    #[test]
    fn a_kitsu_request_matches_by_its_number_whatever_the_season() {
        let w = want(&["kitsu:12:5"], &[]);
        assert_eq!(fits("Made.Up.Show.S02E05", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 05", &w), Some(true));
        assert_eq!(fits("[Group] Made Up Show - 06", &w), Some(false));
    }

    #[test]
    fn labels() {
        let f = |season, from, to| FileEpisode { season, from, to }.label();
        assert_eq!(f(Some(1), 5, 5), "S01E05");
        assert_eq!(f(Some(1), 5, 6), "S01E05–E06");
        assert_eq!(f(None, 5, 5), "Episode 5");
        assert_eq!(f(None, 1, 12), "Episodes 1–12");
    }
}
