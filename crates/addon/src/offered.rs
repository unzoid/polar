//! URLs an addon offered, so a command that fetches by URL for the web view
//! (subtitles) fetches only those and can't be pointed at the LAN or this
//! machine by the page.

use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};

/// Forgets everything once it holds this many, rather than growing for ever;
/// a player asks for its subtitle list again when it opens.
const MAX: usize = 4096;

#[derive(Default)]
pub struct Offered {
    urls: Mutex<HashSet<String>>,
}

impl Offered {
    pub fn offer<'a>(&self, urls: impl IntoIterator<Item = &'a str>) {
        let mut set = self.urls.lock().unwrap_or_else(PoisonError::into_inner);
        for url in urls {
            if set.len() >= MAX {
                set.clear();
            }
            set.insert(url.to_owned());
        }
    }

    pub fn was_offered(&self, url: &str) -> bool {
        self.urls.lock().unwrap_or_else(PoisonError::into_inner).contains(url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_what_was_offered() {
        let offered = Offered::default();
        offered.offer(["https://subs.example/a.srt"]);
        assert!(offered.was_offered("https://subs.example/a.srt"));
        assert!(!offered.was_offered("http://127.0.0.1:8080/admin"));
        assert!(!offered.was_offered("https://subs.example/a.srt?x"));
    }

    #[test]
    fn stays_bounded() {
        let offered = Offered::default();
        let urls: Vec<String> = (0..MAX + 10).map(|i| format!("https://s/{i}")).collect();
        offered.offer(urls.iter().map(String::as_str));
        assert!(offered.urls.lock().unwrap().len() <= MAX);
        assert!(offered.was_offered(&urls[MAX + 9]));
    }
}
