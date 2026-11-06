//! mpv's IPC transport: a named pipe on Windows, a Unix socket elsewhere.

#[cfg(windows)]
pub type Stream = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(unix)]
pub type Stream = tokio::net::UnixStream;

/// Where this app instance's mpv in `role` listens: `mpv` the player,
/// `probe-N` autocrop's pre-roll probes.
pub fn endpoint(role: &str) -> String {
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\polar-{role}-{}", std::process::id())
    }
    #[cfg(unix)]
    {
        let path = super::scratch_dir().join(format!("polar-{role}-{}.sock", std::process::id()));
        // A socket left by an earlier run with this pid would refuse mpv's bind.
        let _ = std::fs::remove_file(&path);
        path.to_string_lossy().into_owned()
    }
}

/// Not on iOS, where mpv is handed its end of a socket pair instead (`start_engine`).
#[cfg_attr(target_os = "ios", allow(dead_code))]
pub async fn connect(endpoint: &str) -> std::io::Result<Stream> {
    #[cfg(windows)]
    {
        tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint)
    }
    #[cfg(unix)]
    {
        tokio::net::UnixStream::connect(endpoint).await
    }
}
