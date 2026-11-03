//! Turning raw upstream lists into shelves worth browsing.
//!
//! Cinemeta only really knows one ordering — what's popular on IMDb right now —
//! so every shelf built straight from it shows the same few dozen titles. Here
//! a wide pool of candidates (several pages, popularity order) is re-ranked per
//! shelf: popular-but-not-the-obvious, best rated, new, hidden gems, classics,
//! and "more like this". A small per-day jitter reshuffles near-ties so the
//! shelves change from day to day but hold still within one.

use std::time::{SystemTime, UNIX_EPOCH};

use polar_addon::MetaPreview;

/// Days since the Unix epoch (UTC). The rotation seed.
pub fn today() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() / 86_400).unwrap_or(0)
}

/// Civil date for a day number (Howard Hinnant's `civil_from_days`).
pub fn ymd(day: u64) -> (i32, u32, u32) {
    let z = day as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (yoe + era * 400 + i64::from(m <= 2)) as i32;
    (y, m, d)
}

/// `YYYY-MM-DD` for a day number.
pub fn date(day: u64) -> String {
    let (y, m, d) = ymd(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// A stable pseudo-random number in `[0, 1)` for (day, key). FNV-1a.
pub fn noise(day: u64, key: &str) -> f64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in day.to_le_bytes().iter().chain(key.as_bytes()) {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    (h % 1_000_000) as f64 / 1_000_000.0
}

fn rating(m: &MetaPreview) -> Option<f64> {
    m.imdb_rating.as_deref()?.parse().ok().filter(|r: &f64| *r > 0.0)
}

fn year(m: &MetaPreview) -> Option<i32> {
    m.release_info.as_deref()?.get(..4)?.parse().ok()
}

/// 0..1, where 1 is a great rating. Unrated titles count as middling.
fn quality(m: &MetaPreview) -> f64 {
    rating(m).map_or(0.35, |r| ((r - 5.0) / 4.0).clamp(0.0, 1.0))
}

/// Drop repeats, keeping the first (most popular) occurrence.
pub fn dedupe(items: impl IntoIterator<Item = MetaPreview>) -> Vec<MetaPreview> {
    let mut seen = std::collections::HashSet::new();
    items.into_iter().filter(|m| seen.insert(m.id.clone())).collect()
}

/// Catalog ids built by re-ranking a popularity-ordered pool.
pub fn is_curated(id: &str) -> bool {
    matches!(id, "popular" | "top_rated" | "new" | "gems")
}

/// Rank `pool` (most popular first) for the shelf `id`.
pub fn curate(id: &str, pool: &[MetaPreview], day: u64) -> Vec<MetaPreview> {
    let n = pool.len().max(1) as f64;
    let this_year = ymd(day).0;
    let mut scored: Vec<(f64, &MetaPreview)> = pool
        .iter()
        .enumerate()
        .filter_map(|(rank, m)| {
            let pop = 1.0 - rank as f64 / n;
            let jitter = noise(day, &m.id) - 0.5;
            let score = match id {
                // Well liked and widely watched — minus the top of the
                // trending list, which already has its own shelf.
                "popular" => {
                    if rank < 15 || rating(m).is_some_and(|r| r < 6.0) {
                        return None;
                    }
                    // Lean towards the last decade; all-time favourites have Top Rated.
                    let recency = year(m).map_or(0.3, |y| (1.0 - f64::from(this_year - y) / 12.0).clamp(0.0, 1.0));
                    0.45 * pop + 0.35 * quality(m) + 0.35 * recency + 0.3 * jitter
                }
                "top_rated" => rating(m).filter(|r| *r >= 7.5)? + 0.2 * pop + 0.15 * jitter,
                "new" => {
                    if year(m)? < this_year - 1 {
                        return None;
                    }
                    pop + 0.25 * quality(m) + 0.25 * jitter
                }
                // Very good, but neither chart-toppers nor the canon (8.5+,
                // which is what Top Rated is made of).
                "gems" => {
                    if rank < 80 {
                        return None;
                    }
                    rating(m).filter(|r| (7.2..8.5).contains(r))? + 0.6 * jitter
                }
                _ => return None,
            };
            Some((score, m))
        })
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().map(|(_, m)| m.clone()).collect()
}

/// Genres whose pools feed one day's "Classics" (when no genre is asked for).
pub fn classic_genres(ty: &str, day: u64, count: usize) -> Vec<&'static str> {
    let mut genres: Vec<&'static str> = if ty == "series" {
        vec!["Drama", "Comedy", "Crime", "Sci-Fi", "Animation", "Mystery", "Fantasy", "Adventure"]
    } else {
        vec![
            "Crime",
            "Drama",
            "Comedy",
            "Sci-Fi",
            "Thriller",
            "Adventure",
            "Romance",
            "Western",
            "War",
            "Mystery",
            "Horror",
            "Animation",
            "Fantasy",
        ]
    };
    genres.sort_by(|a, b| noise(day, a).total_cmp(&noise(day, b)));
    genres.truncate(count);
    genres
}

/// Well-loved titles from before 2010, from genre pools (so they're titles
/// people still watch, not just old ones), rotating daily.
pub fn classics(lists: &[Vec<MetaPreview>], day: u64) -> Vec<MetaPreview> {
    let mut scored: Vec<(f64, &MetaPreview)> = lists
        .iter()
        .flatten()
        .filter(|m| year(m).is_some_and(|y| y < 2010))
        // Below the all-time canon (Top Rated already leads with it).
        .filter_map(|m| Some((rating(m).filter(|r| (7.4..8.7).contains(r))? + 0.7 * (noise(day, &m.id) - 0.5), m)))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    dedupe(scored.into_iter().map(|(_, m)| m.clone()))
}

/// "More like this": candidates sharing the seed's genres, nudged towards good
/// ratings, similar eras and (a little) popularity. Each candidate list is in
/// popularity order.
pub fn similar(seed: &MetaPreview, lists: &[Vec<MetaPreview>], day: u64) -> Vec<MetaPreview> {
    let want: Vec<&str> = seed.genres.iter().take(3).map(String::as_str).collect();
    if want.is_empty() {
        return Vec::new();
    }
    let seed_year = year(seed);
    let mut best: std::collections::HashMap<&str, (f64, &MetaPreview)> = std::collections::HashMap::new();
    for list in lists {
        let n = list.len().max(1) as f64;
        for (rank, m) in list.iter().enumerate() {
            if m.id == seed.id {
                continue;
            }
            let shared = m.genres.iter().filter(|g| want.iter().any(|w| w.eq_ignore_ascii_case(g))).count();
            if shared == 0 || (want.len() >= 2 && shared < 2 && want[0] != m.genres.first().map_or("", String::as_str))
            {
                continue;
            }
            let overlap = shared as f64 / want.len() as f64;
            let era = match (seed_year, year(m)) {
                (Some(a), Some(b)) if (a - b).abs() <= 8 => 0.15,
                _ => 0.0,
            };
            let pop = 1.0 - rank as f64 / n;
            let score = overlap + 0.5 * quality(m) + 0.25 * pop + era + 0.2 * (noise(day, &m.id) - 0.5);
            let entry = best.entry(m.id.as_str()).or_insert((score, m));
            if score > entry.0 {
                *entry = (score, m);
            }
        }
    }
    let mut scored: Vec<(f64, &MetaPreview)> = best.into_values().collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().map(|(_, m)| m.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(ymd(0), (1970, 1, 1));
        assert_eq!(date(20_757), "2026-10-31");
    }

    #[test]
    fn classic_genres_rotate_but_hold_within_a_day() {
        assert_eq!(classic_genres("movie", 100, 3), classic_genres("movie", 100, 3));
        assert!((100..110).any(|d| classic_genres("movie", d, 3) != classic_genres("movie", 100, 3)));
    }
}
