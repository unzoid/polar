//! Names for downloaded files (test report 1, item 29): what a person sees in their Videos folder,
//! `Late Edition 720p.mkv` or `Show - S01E02 - Title.mkv`, not `tt0000113-1793862913460.mkv`. Made safe
//! for every desktop file system; the title's id stays in `downloads.json`.

/// Longest name kept (before the extension); Windows paths have a 260-character limit by default.
const MAX_CHARS: usize = 120;
/// And in bytes: folders hold names of 255 bytes at most, which leaves room for ` (2).webm.part`.
const MAX_BYTES: usize = 200;

/// What a download's file is called, without its extension.
pub fn download_stem(
    name: &str,
    season: Option<u32>,
    episode: Option<u32>,
    episode_title: Option<&str>,
    quality: &str,
) -> String {
    let base = match (season, episode) {
        (Some(s), Some(e)) => {
            let mut n = format!("{name} - S{s:02}E{e:02}");
            if let Some(t) = episode_title.map(str::trim).filter(|t| !t.is_empty() && !is_bare_episode(t)) {
                n.push_str(" - ");
                n.push_str(t);
            }
            n
        }
        _ => {
            // "1080p · HEVC" → "1080p": the picture, which is what tells two copies apart.
            let picture = quality.split('·').next().unwrap_or("").trim();
            if picture.is_empty() {
                name.to_owned()
            } else {
                format!("{name} {picture}")
            }
        }
    };
    let safe = safe_name(&base);
    if safe.is_empty() {
        "Download".to_owned()
    } else {
        safe
    }
}

/// "Episode 4" says nothing the S01E04 doesn't.
fn is_bare_episode(t: &str) -> bool {
    t.strip_prefix("Episode ").is_some_and(|n| n.chars().all(|c| c.is_ascii_digit()))
}

/// `name` as a file name anywhere: no characters Windows, macOS or Linux refuse, no trailing dots
/// or spaces, not a reserved device name, at most [`MAX_CHARS`] characters and [`MAX_BYTES`] bytes.
pub fn safe_name(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    // One space where characters were taken out.
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    let mut bytes = 0;
    let mut out: String = out
        .trim()
        .chars()
        .take(MAX_CHARS)
        .take_while(|c| {
            bytes += c.len_utf8();
            bytes <= MAX_BYTES
        })
        .collect();
    while out.ends_with(['.', ' ']) {
        out.pop();
    }
    const RESERVED: [&str; 24] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1",
        "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "CONIN$", "CONOUT$",
    ];
    // Windows takes the part before the first dot ("NUL.mkv", "aux .x") as the device name too.
    let base = out.split('.').next().unwrap_or_default().trim_end_matches(' ');
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(base)) {
        out.insert(base.len(), '_');
    }
    out
}

/// `stem.ext`, or `stem (2).ext` and on while `taken` says a name is in use (a file there, or
/// another download's), so a new download never writes into one an older transfer still holds.
pub fn free_name(stem: &str, ext: &str, taken: impl Fn(&str) -> bool) -> String {
    let first = format!("{stem}.{ext}");
    if !taken(&first) {
        return first;
    }
    (2..).map(|n| format!("{stem} ({n}).{ext}")).find(|f| !taken(f)).expect("some number is free")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movies_and_episodes_get_names_people_read() {
        assert_eq!(download_stem("Late Edition", None, None, None, "720p · HEVC"), "Late Edition 720p");
        assert_eq!(
            download_stem("Harbor Watch: Return", Some(1), Some(2), Some("Paper Lanterns"), "1080p"),
            "Harbor Watch Return - S01E02 - Paper Lanterns"
        );
        assert_eq!(download_stem("Elsewind", Some(1), Some(4), Some("Episode 4"), ""), "Elsewind - S01E04");
        assert_eq!(download_stem("???", None, None, None, ""), "Download");
    }

    #[test]
    fn names_are_safe_everywhere() {
        assert_eq!(safe_name("AC/DC: Live at <River> Plate?"), "AC DC Live at River Plate");
        assert_eq!(safe_name("Ends with dots..."), "Ends with dots");
        assert_eq!(safe_name("con"), "con_");
        assert_eq!(safe_name(&"x".repeat(300)).chars().count(), MAX_CHARS);
        // Windows takes "NUL.anything" as the device too, and CONIN$ / CONOUT$.
        assert_eq!(safe_name("Nul. The Sequel"), "Nul_. The Sequel");
        assert_eq!(safe_name("aux .x"), "aux_ .x");
        assert_eq!(safe_name("conout$"), "conout$_");
        assert_eq!(safe_name("Connections"), "Connections");
        // Folders hold names of 255 bytes at most, whatever the script.
        assert!(safe_name(&"字".repeat(300)).len() <= MAX_BYTES);
    }

    #[test]
    fn a_name_in_use_gets_a_number() {
        let used = ["Show - S01E01.mkv", "Show - S01E01 (2).mkv"];
        assert_eq!(free_name("Show - S01E01", "mkv", |f| used.contains(&f)), "Show - S01E01 (3).mkv");
        assert_eq!(free_name("Other", "mp4", |f| used.contains(&f)), "Other.mp4");
    }
}
