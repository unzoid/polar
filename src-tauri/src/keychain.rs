//! The sign-in session in the system's keychain: Keychain on macOS,
//! Credential Manager on Windows, the Secret Service on Linux. The web view's auth client
//! stores its session through these commands (src/lib/platform/keychain.ts); where there is no
//! keychain, or it refuses, the commands fail and the web view keeps the session itself, as
//! before. API keys stay in polarity.json (I-008).
//!
//! How a value is split to fit is `polar_library::keychain`; this file only talks to the
//! `keyring` crate. Phone builds have no `keyring` here yet: every command says unavailable.

use std::sync::Mutex;

use polar_library::keychain::{Chunked, SecretStore, StoreError};

use crate::commands::{CmdError, Result};

/// The service every entry is filed under: the app id, so it stays when the name changes.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const SERVICE: &str = "app.getpolar.desktop";

/// What the web view may keep here: the auth client's own keys, nothing else.
fn allowed(name: &str) -> bool {
    name.starts_with("polar.auth")
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}

/// Windows refuses a credential over 2,560 bytes; the others take far more than a session.
#[cfg(windows)]
const MAX_ENTRY: usize = 2048;
#[cfg(not(windows))]
const MAX_ENTRY: usize = 1 << 20;

/// One at a time: a split value is several entries, and two writes must not interleave.
static LOCK: Mutex<()> = Mutex::new(());

struct System;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl System {
    fn entry(name: &str) -> std::result::Result<keyring::Entry, StoreError> {
        keyring::Entry::new(SERVICE, name).map_err(to_store_error)
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn to_store_error(e: keyring::Error) -> StoreError {
    use keyring::Error;
    match e {
        Error::NoDefaultStore | Error::NotSupportedByStore(_) | Error::NoStorageAccess(_) => {
            StoreError::Unavailable(e.to_string())
        }
        // Linux without a running Secret Service fails here, at the first call.
        Error::PlatformFailure(_) => StoreError::Unavailable(e.to_string()),
        other => StoreError::Failed(other.to_string()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl SecretStore for System {
    fn get(&self, name: &str) -> std::result::Result<Option<Vec<u8>>, StoreError> {
        match Self::entry(name)?.get_secret() {
            Ok(bytes) => Ok(Some(bytes)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(to_store_error(e)),
        }
    }
    fn set(&self, name: &str, value: &[u8]) -> std::result::Result<(), StoreError> {
        Self::entry(name)?.set_secret(value).map_err(to_store_error)
    }
    fn delete(&self, name: &str) -> std::result::Result<(), StoreError> {
        match Self::entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(to_store_error(e)),
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
impl SecretStore for System {
    fn get(&self, _: &str) -> std::result::Result<Option<Vec<u8>>, StoreError> {
        Err(StoreError::Unavailable("not built for this system yet".into()))
    }
    fn set(&self, _: &str, _: &[u8]) -> std::result::Result<(), StoreError> {
        Err(StoreError::Unavailable("not built for this system yet".into()))
    }
    fn delete(&self, _: &str) -> std::result::Result<(), StoreError> {
        Err(StoreError::Unavailable("not built for this system yet".into()))
    }
}

/// Runs `f` on the keychain off the async runtime: a keychain call can wait on a prompt or D-Bus.
async fn with_keychain<T: Send + 'static>(
    name: String,
    f: impl FnOnce(&Chunked<System>, &str) -> std::result::Result<T, StoreError> + Send + 'static,
) -> Result<T> {
    if !allowed(&name) {
        return Err(CmdError::Unsupported("not a name kept in the keychain".into()));
    }
    let done = tauri::async_runtime::spawn_blocking(move || {
        let _one = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&Chunked::new(System, MAX_ENTRY), &name)
    })
    .await
    .map_err(|e| CmdError::Other(e.to_string()))?;
    done.map_err(|e| {
        // Says which kind of failure, never the value.
        tracing::warn!("{e}");
        match e {
            StoreError::Unavailable(why) => CmdError::Unsupported(why),
            StoreError::Failed(why) => CmdError::Other(why),
        }
    })
}

/// The value under `name`, or null when there is none.
#[tauri::command]
pub async fn keychain_get(name: String) -> Result<Option<String>> {
    // A value that isn't text wasn't written by the auth client: none.
    with_keychain(name, |keys, name| Ok(keys.get(name)?.and_then(|bytes| String::from_utf8(bytes).ok()))).await
}

#[tauri::command]
pub async fn keychain_set(name: String, value: String) -> Result<()> {
    with_keychain(name, move |keys, name| keys.set(name, value.as_bytes())).await
}

#[tauri::command]
pub async fn keychain_delete(name: String) -> Result<()> {
    with_keychain(name, |keys, name| keys.delete(name)).await
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn only_the_auth_clients_names() {
        assert!(allowed("polar.auth"));
        assert!(allowed("polar.auth-code-verifier"));
        assert!(allowed("polar.auth-user"));
        assert!(!allowed("polar.settings"));
        assert!(!allowed("tmdb"));
        assert!(!allowed("polar.auth\u{0}x"));
        assert!(!allowed("polar.auth/../x"));
        assert!(!allowed(&format!("polar.auth{}", "x".repeat(60))));
    }
}
