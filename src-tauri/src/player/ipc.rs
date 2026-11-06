//! mpv's IPC transport: a named pipe on Windows, a Unix socket elsewhere.

#[cfg(windows)]
pub type Stream = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(unix)]
pub type Stream = tokio::net::UnixStream;

/// Where this app instance's mpv listens.
pub fn endpoint() -> String {
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\polar-mpv-{}", std::process::id())
    }
    #[cfg(unix)]
    {
        let path = super::scratch_dir().join(format!("polar-mpv-{}.sock", std::process::id()));
        // A socket left by an earlier run with this pid would refuse mpv's bind.
        let _ = std::fs::remove_file(&path);
        path.to_string_lossy().into_owned()
    }
}

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
