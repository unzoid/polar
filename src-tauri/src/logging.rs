//! The log (critique M14): warnings and errors from every part of the app, and
//! Polar's own notes from info up, to `polar.log` in the app's log folder
//! (`polar_library::logfile`, 1 MB and one older copy). Debug builds also
//! print to the terminal. A panic is written there before the app goes down.
//!
//! What is logged names hosts, ids of downloads and plain reasons; never keys,
//! add-on or stream links, or what someone is watching.

use std::path::Path;

use polar_library::logfile::LogFile;
use tracing::Level;
use tracing_subscriber::filter::Targets;
use tracing_subscriber::fmt::writer::MakeWriterExt;
use tracing_subscriber::prelude::*;

const MAX_BYTES: u64 = 1024 * 1024;

/// Start logging to `<dir>/polar.log`. Called once, first thing at start-up.
pub fn init(dir: &Path) {
    let file = LogFile::new(dir.join("polar.log"), MAX_BYTES);
    let filter = Targets::new().with_default(Level::WARN).with_target("polar", Level::INFO);
    let to_file = tracing_subscriber::fmt::layer().with_ansi(false).with_writer(move || file.clone());
    let layer = to_file.with_filter(filter.clone());
    if cfg!(debug_assertions) {
        let to_terminal = tracing_subscriber::fmt::layer().with_writer(std::io::stderr.with_max_level(Level::INFO));
        let _ = tracing_subscriber::registry().with(layer).with(to_terminal.with_filter(filter)).try_init();
    } else {
        let _ = tracing_subscriber::registry().with(layer).try_init();
    }

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        tracing::error!("panic at {place}: {}", panic_message(info));
        previous(info);
    }));
}

fn panic_message(info: &std::panic::PanicHookInfo) -> String {
    let payload = info.payload();
    payload
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "(no message)".into())
}
