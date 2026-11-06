//! The sign-in session, API keys and add-on links in the system's keychain: Keychain on macOS,
//! Credential Manager on Windows, the Secret Service on Linux. The web view's auth client
//! stores its session through these commands (src/lib/platform/keychain.ts); where there is no
//! keychain, or it refuses, the commands fail and the web view keeps the session itself, as
//! before. Keys and links are taken out of polarity.json by the saver ([`open_vault`],
//! [`take_secrets`], laid out by `polar_library::vault`); the web view can't read them here.
//!
//! How a value is split to fit is `polar_library::keychain`; this file only talks to the
//! `keyring` crate. Phone builds have no `keyring` here yet: every command says unavailable.

use std::sync::Mutex;

use polar_library::keychain::{Chunked, SecretStore, StoreError};
use polar_library::vault::{self, Place, Secrets};
use tauri::State;

use crate::commands::{CmdError, Result};
use crate::locks::Locked;
use crate::AppState;

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

pub struct System;

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

/// The keychain side of `polarity.json` for this run.
pub type Vault = vault::Vault<System>;

/// Reads the keychain's secrets when `data`'s file says they are there; returns them to fill in.
/// Blocks: called once at start-up, before anything needs a key.
pub fn open_vault(data: &crate::store::Data) -> (Vault, Secrets) {
    let file = serde_json::to_value(data).unwrap_or_default();
    let _one = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (vault, fill) = Vault::open(Chunked::new(System, MAX_ENTRY), &file);
    match vault.place() {
        Place::Unreadable => {
            tracing::warn!("the keychain couldn't be read: keys and add-on links kept there aren't loaded")
        }
        Place::Keychain => tracing::info!("keys and add-on links read from the keychain"),
        Place::File => {}
    }
    (vault, fill)
}

/// Moves `file`'s secrets into the keychain before the saver writes it (on the saver's thread).
pub fn take_secrets(vault: &Mutex<Vault>, file: &mut serde_json::Value) {
    let _one = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Err(e) = vault.locked().take(file) {
        // Says which kind of failure, never a value.
        tracing::warn!("keys and add-on links stay in polarity.json: {e}");
    }
}

/// Where this device keeps its keys and add-on links: `keychain`, `file` or `unreadable`.
#[tauri::command]
pub fn secrets_place(state: State<'_, AppState>) -> Place {
    state.vault.locked().place()
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
        assert!(!allowed(polar_library::vault::NAME));
        assert!(!allowed("tmdb"));
        assert!(!allowed("polar.auth\u{0}x"));
        assert!(!allowed("polar.auth/../x"));
        assert!(!allowed(&format!("polar.auth{}", "x".repeat(60))));
    }
}
