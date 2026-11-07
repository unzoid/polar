//! The sign-in session, API keys and add-on links in the system's keychain: Keychain on macOS
//! and iOS, Credential Manager on Windows, the Secret Service on Linux, values sealed with an
//! Android Keystore key on Android (`PolarKeys.kt`). The web view's auth client stores its
//! session through these commands (src/lib/platform/keychain.ts); where there is no keychain, or
//! it refuses, the commands fail and the web view keeps the session itself, as before; settings
//! sync keeps its copy of the keys the same way (`polar.sync.<profile>`). Keys and links are
//! taken out of polarity.json by the saver ([`open_vault`], [`take_secrets`], laid out by
//! `polar_library::vault`); the web view can't read them here.
//!
//! How a value is split to fit is `polar_library::keychain`; this file only talks to the
//! `keyring` crate on desktops, to `src/ios/keys.m` on iOS and to `PolarKeys` over JNI on Android.

use std::sync::Mutex;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use polar_library::keychain::SecretStore;
use polar_library::keychain::{Chunked, StoreError};
use polar_library::vault::{self, Place, Secrets};
use tauri::State;

use crate::commands::{CmdError, Result};
use crate::locks::Locked;
use crate::AppState;

/// The service every entry is filed under: the app id, so it stays when the name changes
/// (`src/ios/keys.m` files its entries under the same one).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const SERVICE: &str = "app.getpolar.desktop";

/// What the web view may keep here: the auth client's own keys, settings sync's copy of the
/// keys and passphrase (src/lib/account/localSecrets.ts) and the sign-ins of linked list
/// services per profile (`polar.link.<service>.<profile>`, src/lib/lists/linkStore.ts), nothing
/// else; never [`vault::NAME`].
fn allowed(name: &str) -> bool {
    (name.starts_with("polar.auth") || name.starts_with("polar.sync.") || name.starts_with("polar.link."))
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

#[cfg(target_os = "ios")]
mod ios {
    use std::ffi::{c_char, c_int, CString};

    use polar_library::keychain::{SecretStore, StoreError};

    extern "C" {
        fn polar_keys_get(name: *const c_char, out: *mut *mut u8, len: *mut usize) -> c_int;
        fn polar_keys_free(bytes: *mut u8);
        fn polar_keys_set(name: *const c_char, value: *const u8, len: usize) -> c_int;
        fn polar_keys_delete(name: *const c_char) -> c_int;
    }

    /// errSecItemNotFound, Security/SecBase.h.
    const NOT_FOUND: c_int = -25300;
    /// errSecInteractionNotAllowed: asked before the first unlock since the phone started.
    const LOCKED: c_int = -25308;

    fn c_name(name: &str) -> Result<CString, StoreError> {
        CString::new(name).map_err(|_| StoreError::Failed("not a key name".into()))
    }

    fn failed(status: c_int) -> StoreError {
        if status == LOCKED {
            StoreError::Failed("the keychain is locked until the phone is unlocked".into())
        } else {
            StoreError::Failed(format!("the keychain answered {status}"))
        }
    }

    impl SecretStore for super::System {
        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
            let name = c_name(name)?;
            let (mut out, mut len) = (std::ptr::null_mut(), 0usize);
            // SAFETY: keys.m fills `out`/`len` only when it returns 0, with a malloc'd buffer
            // of `len` bytes that polar_keys_free releases.
            let status = unsafe { polar_keys_get(name.as_ptr(), &mut out, &mut len) };
            match status {
                0 => {
                    let bytes = unsafe { std::slice::from_raw_parts(out, len) }.to_vec();
                    unsafe { polar_keys_free(out) };
                    Ok(Some(bytes))
                }
                NOT_FOUND => Ok(None),
                other => Err(failed(other)),
            }
        }
        fn set(&self, name: &str, value: &[u8]) -> Result<(), StoreError> {
            let name = c_name(name)?;
            // SAFETY: keys.m copies the bytes before returning.
            match unsafe { polar_keys_set(name.as_ptr(), value.as_ptr(), value.len()) } {
                0 => Ok(()),
                other => Err(failed(other)),
            }
        }
        fn delete(&self, name: &str) -> Result<(), StoreError> {
            let name = c_name(name)?;
            match unsafe { polar_keys_delete(name.as_ptr()) } {
                0 => Ok(()),
                other => Err(failed(other)),
            }
        }
    }
}

#[cfg(target_os = "android")]
mod android {
    use jni::objects::{JByteArray, JClass, JObject, JValue};
    use jni::JNIEnv;
    use polar_library::keychain::{SecretStore, StoreError};

    /// Calls `PolarKeys.<method>(context, name, …)` (PolarKeys.kt) on this thread, attached to
    /// the app's VM for the call. The class comes from the app's class loader: a thread Rust
    /// started can't find it by name. An exception reads as a failure, with no detail: it may
    /// name the value's file.
    fn call<T>(
        f: impl for<'l> FnOnce(&mut JNIEnv<'l>, &JClass<'l>, &JObject<'l>) -> jni::errors::Result<T>,
    ) -> Result<T, StoreError> {
        let ctx = ndk_context::android_context();
        // SAFETY: the VM and the activity Tauri recorded in ndk_context live as long as the app.
        let vm =
            unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| StoreError::Unavailable(e.to_string()))?;
        let mut env = vm.attach_current_thread().map_err(|e| StoreError::Unavailable(e.to_string()))?;
        let found = env.with_local_frame(16, |env| -> jni::errors::Result<std::result::Result<T, bool>> {
            let context = unsafe { JObject::from_raw(ctx.context().cast()) };
            let loader = env.call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
            let class_name = env.new_string("app.getpolar.desktop.PolarKeys")?;
            let class = match env.call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&class_name)],
            ) {
                Ok(c) => JClass::from(c.l()?),
                Err(jni::errors::Error::JavaException) => return Ok(Err(false)),
                Err(e) => return Err(e),
            };
            match f(env, &class, &context) {
                Ok(v) => Ok(Ok(v)),
                Err(jni::errors::Error::JavaException) => Ok(Err(true)),
                Err(e) => Err(e),
            }
        });
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        match found {
            Ok(Ok(v)) => Ok(v),
            // An APK without PolarKeys: no keychain, as before it.
            Ok(Err(false)) => Err(StoreError::Unavailable("no keychain in this build".into())),
            Ok(Err(true)) => Err(StoreError::Failed("the Android keystore refused".into())),
            Err(e) => Err(StoreError::Failed(e.to_string())),
        }
    }

    impl SecretStore for super::System {
        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
            call(|env, class, context| {
                let name = env.new_string(name)?;
                let sig = "(Landroid/content/Context;Ljava/lang/String;)[B";
                let got = env
                    .call_static_method(class, "get", sig, &[JValue::Object(context), JValue::Object(&name)])?
                    .l()?;
                if got.is_null() {
                    return Ok(None);
                }
                env.convert_byte_array(JByteArray::from(got)).map(Some)
            })
        }
        fn set(&self, name: &str, value: &[u8]) -> Result<(), StoreError> {
            call(|env, class, context| {
                let name = env.new_string(name)?;
                let bytes = env.byte_array_from_slice(value)?;
                let sig = "(Landroid/content/Context;Ljava/lang/String;[B)V";
                let args = [JValue::Object(context), JValue::Object(&name), JValue::Object(&bytes)];
                env.call_static_method(class, "set", sig, &args).map(drop)
            })
        }
        fn delete(&self, name: &str) -> Result<(), StoreError> {
            call(|env, class, context| {
                let name = env.new_string(name)?;
                let sig = "(Landroid/content/Context;Ljava/lang/String;)V";
                env.call_static_method(class, "delete", sig, &[JValue::Object(context), JValue::Object(&name)])
                    .map(drop)
            })
        }
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
    fn only_the_web_views_own_names() {
        assert!(allowed("polar.auth"));
        assert!(allowed("polar.auth-code-verifier"));
        assert!(allowed("polar.auth-user"));
        assert!(!allowed("polar.settings"));
        assert!(!allowed(polar_library::vault::NAME));
        assert!(allowed("polar.sync.local"));
        assert!(allowed("polar.sync.00000000-0000-4000-8000-000000000000"));
        assert!(!allowed("polar.syncx"));
        assert!(allowed("polar.link.anilist.00000000-0000-4000-8000-000000000000"));
        assert!(allowed("polar.link.anilist.local"));
        assert!(!allowed("polar.linkx"));
        assert!(!allowed("tmdb"));
        assert!(!allowed("polar.auth\u{0}x"));
        assert!(!allowed("polar.auth/../x"));
        assert!(!allowed(&format!("polar.auth{}", "x".repeat(60))));
    }
}
