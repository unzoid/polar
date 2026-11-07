//! What the webview may ask of mpv.
//!
//! mpv's IPC is all-powerful: `run` starts any program, `load-script` runs Lua,
//! and some properties write files. The webview renders data from third-party
//! addons, so it only gets the handful of commands and properties the player
//! UI actually uses — a script injected into the page can't turn the player
//! into a way to run code on the machine.

use serde_json::Value;

/// Commands the UI sends through `mpv_command`.
pub const ALLOWED_COMMANDS: &[&str] = &["seek", "set", "get_property", "sub-add", "frame-step", "frame-back-step"];

/// Properties the UI reads or writes (`mpv_set`, `set`, `get_property`).
pub const ALLOWED_PROPERTIES: &[&str] = &[
    "pause",
    "volume",
    "mute",
    "speed",
    "aid",
    "sid",
    "sub-text",
    "sub-ass-override",
    "sub-font",
    "sub-scale",
    "sub-pos",
    "sub-color",
    "sub-border-size",
    "sub-border-color",
    "sub-border-style",
    "sub-shadow-offset",
    "sub-back-color",
    "sub-delay",
];

/// Properties the UI only reads (`get_property`): what the subtitle preview
/// needs to size itself as mpv sizes subtitles.
pub const READ_ONLY_PROPERTIES: &[&str] = &[
    "osd-dimensions",
    "sub-font-size",
    "sub-margin-x",
    "sub-margin-y",
    "sub-scale-by-window",
    "sub-scale-with-window",
    "sub-use-margins",
    // Frame stepping: where a step landed (time reports are throttled) and the frame rate it counts frames in.
    "time-pos",
    "container-fps",
    "estimated-vf-fps",
    // The source info panel: what the playing file is (container-fps above is read too).
    "file-format",
    "video-codec",
    "video-params",
    "video-bitrate",
    "audio-bitrate",
    // Best Match (#230): what the connection carries while the cache fills, in bytes per second.
    "cache-speed",
];

/// Media and subtitles only ever come from the network (addons, or a server
/// on this machine); never local files or mpv's special protocols.
pub fn is_web_url(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

pub fn check_command(args: &[Value]) -> Result<(), String> {
    let name = args.first().and_then(Value::as_str).ok_or("missing mpv command")?;
    if !ALLOWED_COMMANDS.contains(&name) {
        return Err(format!("mpv command `{name}` isn't allowed"));
    }
    match name {
        "set" => check_property(args.get(1).and_then(Value::as_str).unwrap_or_default()),
        "get_property" => check_readable(args.get(1).and_then(Value::as_str).unwrap_or_default()),
        "sub-add" => match args.get(1).and_then(Value::as_str) {
            Some(url) if is_web_url(url) => Ok(()),
            _ => Err("subtitles must be an http(s) URL".into()),
        },
        // One frame either way, by an exact seek or (older mpv) mpv's own step: never a long run of frames.
        "frame-step" => match &args[1..] {
            [] => Ok(()),
            [n, flag] if matches!(n.as_i64(), Some(-1 | 1)) && flag.as_str() == Some("seek") => Ok(()),
            _ => Err("frame-step takes one frame, by seek".into()),
        },
        "frame-back-step" if args.len() == 1 => Ok(()),
        "frame-back-step" => Err("frame-back-step takes no arguments".into()),
        _ => Ok(()),
    }
}

pub fn check_property(name: &str) -> Result<(), String> {
    if ALLOWED_PROPERTIES.contains(&name) {
        Ok(())
    } else {
        Err(format!("mpv property `{name}` isn't allowed"))
    }
}

/// A property the UI may read: any it may set, and the read-only ones.
pub fn check_readable(name: &str) -> Result<(), String> {
    if READ_ONLY_PROPERTIES.contains(&name) {
        Ok(())
    } else {
        check_property(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_player_commands_pass() {
        assert!(check_command(&[json!("seek"), json!(10), json!("absolute+keyframes")]).is_ok());
        assert!(check_command(&[json!("set"), json!("sub-border-style"), json!("opaque-box")]).is_ok());
        assert!(check_command(&[json!("sub-add"), json!("https://x/s.srt"), json!("select")]).is_ok());
        assert!(check_command(&[json!("run"), json!("cmd.exe")]).is_err());
        assert!(check_command(&[json!("load-script"), json!("C:/x.lua")]).is_err());
        assert!(check_command(&[json!("set"), json!("input-ipc-server"), json!("x")]).is_err());
        assert!(check_command(&[json!("sub-add"), json!("C:/secret.txt")]).is_err());
        assert!(check_command(&[]).is_err());
        assert!(check_property("screenshot-directory").is_err());
        assert!(check_command(&[json!("get_property"), json!("osd-dimensions")]).is_ok());
        assert!(check_command(&[json!("get_property"), json!("sub-margin-y")]).is_ok());
        assert!(check_command(&[json!("set"), json!("sub-margin-y"), json!(0)]).is_err());
        assert!(check_command(&[json!("get_property"), json!("screenshot-directory")]).is_err());
        assert!(check_command(&[json!("frame-step"), json!(1), json!("seek")]).is_ok());
        assert!(check_command(&[json!("frame-step"), json!(-1), json!("seek")]).is_ok());
        assert!(check_command(&[json!("frame-step")]).is_ok());
        assert!(check_command(&[json!("frame-back-step")]).is_ok());
        assert!(check_command(&[json!("frame-step"), json!(100000), json!("play")]).is_err());
        assert!(check_command(&[json!("frame-back-step"), json!(5)]).is_err());
        assert!(check_command(&[json!("get_property"), json!("container-fps")]).is_ok());
        assert!(check_command(&[json!("get_property"), json!("cache-speed")]).is_ok());
        assert!(check_command(&[json!("set"), json!("cache-speed"), json!(0)]).is_err());
        assert!(check_command(&[json!("set"), json!("time-pos"), json!(0)]).is_err());
        for prop in ["file-format", "video-codec", "video-params", "video-bitrate", "audio-bitrate"] {
            assert!(check_command(&[json!("get_property"), json!(prop)]).is_ok(), "{prop} is readable");
            assert!(check_command(&[json!("set"), json!(prop), json!("x")]).is_err(), "{prop} isn't settable");
            assert!(check_property(prop).is_err(), "{prop} isn't settable through mpv_set");
        }
        assert!(!is_web_url("file:///C:/x.mkv") && is_web_url("HTTP://127.0.0.1:8080/a.mkv"));
    }
}
