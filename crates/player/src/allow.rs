//! What the webview may ask of mpv.
//!
//! mpv's IPC is all-powerful: `run` starts any program, `load-script` runs Lua,
//! and some properties write files. The webview renders data from third-party
//! addons, so it only gets the handful of commands and properties the player
//! UI actually uses — a script injected into the page can't turn the player
//! into a way to run code on the machine.

use serde_json::Value;

/// Commands the UI sends through `mpv_command`.
pub const ALLOWED_COMMANDS: &[&str] = &["seek", "set", "get_property", "sub-add"];

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
        "set" | "get_property" => check_property(args.get(1).and_then(Value::as_str).unwrap_or_default()),
        "sub-add" => match args.get(1).and_then(Value::as_str) {
            Some(url) if is_web_url(url) => Ok(()),
            _ => Err("subtitles must be an http(s) URL".into()),
        },
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
        assert!(!is_web_url("file:///C:/x.mkv") && is_web_url("HTTP://127.0.0.1:8080/a.mkv"));
    }
}
