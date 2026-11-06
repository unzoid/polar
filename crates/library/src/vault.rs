//! API keys and add-on links kept in the system's keychain instead of the data file (#195).
//!
//! `polarity.json` is readable by every program the user runs. Where there is a keychain, the
//! secrets in it (the settings' API keys and every installed add-on's link) go into one keychain
//! entry, [`NAME`], and the file keeps the rest with those fields emptied and
//! `secretsInKeychain: true`. Where there is none (a Linux desktop without a Secret Service, phone
//! builds for now) or it refuses, they stay in the file, as before.
//!
//! The file is written after the keychain, so a crash between the two leaves a file whose secrets
//! are older than the keychain's; at start-up a secret in the file wins over the keychain's (it was
//! written while the keychain refused, or by an older build), and the keychain fills only what the
//! file left empty. When the keychain can't be read at start-up the file says nothing about what
//! is in it, so it is never written over in that run: secrets entered meanwhile stay in the file
//! and move into the keychain at a later start.
//!
//! An add-on's link is filed under its manifest id (`id#n` for the n-th add-on with the same id):
//! links don't change once installed, and the id is in the file next to the emptied link.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::keychain::{Chunked, SecretStore, StoreError};

/// The keychain entry holding them.
pub const NAME: &str = "polar.vault";

/// The settings fields holding an API key, as `polarity.json` names them.
pub const KEY_FIELDS: [&str; 4] = ["tmdbKey", "seekrKey", "mdblistKey", "omdbKey"];

/// The file's flag: its secrets are in the keychain.
pub const FLAG: &str = "secretsInKeychain";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Secrets {
    /// Settings field -> key, only the ones set.
    pub keys: BTreeMap<String, String>,
    /// `id#n` -> link.
    pub addons: BTreeMap<String, String>,
}

impl Secrets {
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty() && self.addons.is_empty()
    }

    /// What `file` (the data file as JSON) holds.
    pub fn of(file: &Value) -> Self {
        let mut secrets = Secrets::default();
        for field in KEY_FIELDS {
            if let Some(key) = file.pointer(&format!("/settings/{field}")).and_then(Value::as_str) {
                if !key.is_empty() {
                    secrets.keys.insert(field.into(), key.into());
                }
            }
        }
        for_each_addon(file, |slot, url| {
            if !url.is_empty() {
                secrets.addons.insert(slot, url.into());
            }
        });
        secrets
    }

    /// The link filed for the add-on at `slot` (see [`slots`]).
    pub fn addon(&self, slot: &str) -> Option<&str> {
        self.addons.get(slot).map(String::as_str)
    }

    pub fn key(&self, field: &str) -> Option<&str> {
        self.keys.get(field).map(String::as_str)
    }
}

/// The `id#n` slot of each add-on, in order, given their manifest ids in order.
pub fn slots<'a>(ids: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut seen: BTreeMap<&str, usize> = BTreeMap::new();
    ids.into_iter()
        .map(|id| {
            let n = seen.entry(id).or_default();
            *n += 1;
            format!("{id}#{}", *n - 1)
        })
        .collect()
}

fn for_each_addon(file: &Value, mut f: impl FnMut(String, &str)) {
    let Some(addons) = file.get("addons").and_then(Value::as_array) else { return };
    let ids = addons.iter().map(|a| a.pointer("/manifest/id").and_then(Value::as_str).unwrap_or(""));
    for (slot, addon) in slots(ids).into_iter().zip(addons) {
        f(slot, addon.get("manifestUrl").and_then(Value::as_str).unwrap_or(""));
    }
}

/// Empties every secret field of `file` and sets its flag.
fn strip(file: &mut Value) {
    if let Some(settings) = file.get_mut("settings").and_then(Value::as_object_mut) {
        for field in KEY_FIELDS {
            if settings.contains_key(field) {
                settings.insert(field.into(), Value::Null);
            }
        }
    }
    if let Some(addons) = file.get_mut("addons").and_then(Value::as_array_mut) {
        for addon in addons {
            if let Some(addon) = addon.as_object_mut() {
                addon.insert("manifestUrl".into(), Value::String(String::new()));
            }
        }
    }
    set_flag(file, true);
}

fn set_flag(file: &mut Value, on: bool) {
    if let Some(file) = file.as_object_mut() {
        file.insert(FLAG.into(), Value::Bool(on));
    }
}

/// Where this device's secrets are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Place {
    Keychain,
    /// In the data file: there is no keychain, or it refused.
    File,
    /// The file says the keychain has them, but it couldn't be read this run.
    Unreadable,
}

/// The keychain side of the data file, for one run.
pub struct Vault<S> {
    keys: Chunked<S>,
    place: Place,
    /// The secrets last put in the keychain, or last refused by it; `None` = try at the next save.
    last: Option<Secrets>,
}

impl<S: SecretStore> Vault<S> {
    /// Reads the keychain when the file's flag says to and returns what to fill in: the keychain's
    /// secrets the file doesn't have itself. `file` is the data file as read.
    pub fn open(keys: Chunked<S>, file: &Value) -> (Self, Secrets) {
        let in_file = Secrets::of(file);
        let flagged = file.get(FLAG).and_then(Value::as_bool).unwrap_or(false);
        if !flagged {
            return (Vault { keys, place: Place::File, last: None }, Secrets::default());
        }
        match read(&keys) {
            Ok(stored) => {
                let stored = stored.unwrap_or_default();
                let mut missing = Secrets::default();
                for (field, key) in &stored.keys {
                    if !in_file.keys.contains_key(field) {
                        missing.keys.insert(field.clone(), key.clone());
                    }
                }
                for (slot, url) in &stored.addons {
                    if !in_file.addons.contains_key(slot) {
                        missing.addons.insert(slot.clone(), url.clone());
                    }
                }
                // Secrets the file still holds aren't in the keychain yet: the next save writes them.
                let last = in_file.is_empty().then_some(stored);
                (Vault { keys, place: Place::Keychain, last }, missing)
            }
            Err(_) => (Vault { keys, place: Place::Unreadable, last: None }, Secrets::default()),
        }
    }

    pub fn place(&self) -> Place {
        self.place
    }

    /// Before `file` (the data file about to be written) is saved: its secrets go into the
    /// keychain when it takes them, and out of `file`. On a keychain error `file` keeps them and
    /// the error is returned for the log; the keychain isn't tried again until they change, so a
    /// system without one isn't asked on every save.
    pub fn take(&mut self, file: &mut Value) -> Result<(), StoreError> {
        if self.place == Place::Unreadable {
            set_flag(file, true);
            return Ok(());
        }
        let secrets = Secrets::of(file);
        // Nobody with nothing to keep is asked for the keychain.
        if self.place == Place::File && secrets.is_empty() {
            set_flag(file, false);
            return Ok(());
        }
        if self.last.as_ref() != Some(&secrets) {
            self.last = Some(secrets.clone());
            if let Err(e) = write(&self.keys, &secrets) {
                // The keychain may still hold older ones: the file no longer points at them.
                self.place = Place::File;
                set_flag(file, false);
                return Err(e);
            }
            self.place = Place::Keychain;
        }
        match self.place {
            Place::Keychain => strip(file),
            _ => set_flag(file, false),
        }
        Ok(())
    }
}

fn read<S: SecretStore>(keys: &Chunked<S>) -> Result<Option<Secrets>, StoreError> {
    // A value this module didn't write holds nothing it can use.
    Ok(keys.get(NAME)?.and_then(|bytes| serde_json::from_slice(&bytes).ok()))
}

fn write<S: SecretStore>(keys: &Chunked<S>, secrets: &Secrets) -> Result<(), StoreError> {
    if secrets.is_empty() {
        return keys.delete(NAME);
    }
    let bytes = serde_json::to_vec(secrets).map_err(|e| StoreError::Failed(e.to_string()))?;
    keys.set(NAME, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;
    use std::rc::Rc;

    /// A keychain in memory, shared with the test, that can be told to be missing or to refuse.
    #[derive(Clone, Default)]
    struct Memory {
        entries: Rc<RefCell<BTreeMap<String, Vec<u8>>>>,
        broken: Rc<Cell<Option<bool>>>,
        calls: Rc<Cell<usize>>,
    }

    impl Memory {
        fn check(&self) -> Result<(), StoreError> {
            self.calls.set(self.calls.get() + 1);
            match self.broken.get() {
                Some(true) => Err(StoreError::Unavailable("no service".into())),
                Some(false) => Err(StoreError::Failed("locked".into())),
                None => Ok(()),
            }
        }
        fn vault(&self) -> Option<Secrets> {
            self.entries.borrow().get(NAME).map(|bytes| serde_json::from_slice(&bytes[1..]).unwrap())
        }
    }

    impl SecretStore for Memory {
        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
            self.check()?;
            Ok(self.entries.borrow().get(name).cloned())
        }
        fn set(&self, name: &str, value: &[u8]) -> Result<(), StoreError> {
            self.check()?;
            self.entries.borrow_mut().insert(name.into(), value.to_vec());
            Ok(())
        }
        fn delete(&self, name: &str) -> Result<(), StoreError> {
            self.check()?;
            self.entries.borrow_mut().remove(name);
            Ok(())
        }
    }

    fn open(mem: &Memory, file: &Value) -> (Vault<Memory>, Secrets) {
        Vault::open(Chunked::new(mem.clone(), 1 << 20), file)
    }

    fn file(key: Option<&str>, links: &[(&str, &str)]) -> Value {
        json!({
            "version": 1,
            "settings": { "tmdbKey": key, "language": "en-US", "seekrKey": null },
            "addons": links.iter().map(|(id, url)| json!({ "manifestUrl": url, "manifest": { "id": id, "name": "A" } })).collect::<Vec<_>>(),
        })
    }

    const LINK: &str = "https://addon.example.com/TOKEN/manifest.json";

    #[test]
    fn secrets_move_out_of_the_file_into_the_keychain() {
        let mem = Memory::default();
        let mut f =
            file(Some("KEY"), &[("org.example.a", LINK), ("org.example.b", "https://b.example.org/manifest.json")]);
        let (mut vault, fill) = open(&mem, &f);
        assert!(fill.is_empty());
        assert_eq!(vault.place(), Place::File);
        vault.take(&mut f).unwrap();
        assert_eq!(vault.place(), Place::Keychain);
        assert_eq!(f["settings"]["tmdbKey"], Value::Null);
        assert_eq!(f["settings"]["language"], "en-US");
        assert_eq!(f["addons"][0]["manifestUrl"], "");
        assert_eq!(f["addons"][1]["manifest"]["id"], "org.example.b");
        assert_eq!(f[FLAG], true);
        assert!(!f.to_string().contains("KEY") && !f.to_string().contains("example.com"));
        let stored = mem.vault().unwrap();
        assert_eq!(stored.key("tmdbKey"), Some("KEY"));
        assert_eq!(stored.addon("org.example.a#0"), Some(LINK));
    }

    #[test]
    fn the_next_start_fills_them_back_in() {
        let mem = Memory::default();
        let mut f = file(Some("KEY"), &[("org.example.a", LINK)]);
        open(&mem, &f).0.take(&mut f).unwrap();
        let (mut vault, fill) = open(&mem, &f);
        assert_eq!(vault.place(), Place::Keychain);
        assert_eq!(fill.key("tmdbKey"), Some("KEY"));
        assert_eq!(fill.addon("org.example.a#0"), Some(LINK));
        // Filled in and saved again unchanged: the keychain isn't written again.
        let mut again = file(Some("KEY"), &[("org.example.a", LINK)]);
        let calls = mem.calls.get();
        vault.take(&mut again).unwrap();
        assert_eq!(mem.calls.get(), calls);
        assert_eq!(again, f);
    }

    #[test]
    fn a_secret_in_the_file_wins_over_the_keychains() {
        let mem = Memory::default();
        let mut f = file(Some("OLD"), &[("org.example.a", LINK)]);
        open(&mem, &f).0.take(&mut f).unwrap();
        // An older build, or a run whose keychain refused, wrote a new key into the file.
        f["settings"]["tmdbKey"] = json!("NEW");
        let (mut vault, fill) = open(&mem, &f);
        assert_eq!(fill.key("tmdbKey"), None);
        assert_eq!(fill.addon("org.example.a#0"), Some(LINK));
        let mut saved = file(Some("NEW"), &[("org.example.a", LINK)]);
        vault.take(&mut saved).unwrap();
        assert_eq!(mem.vault().unwrap().key("tmdbKey"), Some("NEW"));
    }

    #[test]
    fn without_a_keychain_they_stay_in_the_file_and_it_is_asked_once() {
        let mem = Memory::default();
        mem.broken.set(Some(true));
        let mut f = file(Some("KEY"), &[]);
        let (mut vault, _) = open(&mem, &f);
        assert!(vault.take(&mut f).is_err());
        assert_eq!(vault.place(), Place::File);
        assert_eq!(f["settings"]["tmdbKey"], "KEY");
        assert_eq!(f[FLAG], false);
        let calls = mem.calls.get();
        let mut again = file(Some("KEY"), &[]);
        vault.take(&mut again).unwrap();
        assert_eq!(mem.calls.get(), calls);
        assert_eq!(again["settings"]["tmdbKey"], "KEY");
    }

    #[test]
    fn nothing_to_keep_never_touches_the_keychain() {
        let mem = Memory::default();
        let mut f = file(None, &[]);
        let (mut vault, _) = open(&mem, &f);
        vault.take(&mut f).unwrap();
        assert_eq!(mem.calls.get(), 0);
        assert_eq!(f[FLAG], false);
    }

    #[test]
    fn an_unreadable_keychain_is_never_written_over() {
        let mem = Memory::default();
        let mut f = file(Some("KEY"), &[("org.example.a", LINK)]);
        open(&mem, &f).0.take(&mut f).unwrap();
        mem.broken.set(Some(false));
        let (mut vault, fill) = open(&mem, &f);
        assert_eq!(vault.place(), Place::Unreadable);
        assert!(fill.is_empty());
        // A key entered meanwhile stays in the file, which still points at the keychain.
        let mut saved = file(Some("OTHER"), &[("org.example.a", "")]);
        mem.broken.set(None);
        let calls = mem.calls.get();
        vault.take(&mut saved).unwrap();
        assert_eq!(mem.calls.get(), calls);
        assert_eq!(saved["settings"]["tmdbKey"], "OTHER");
        assert_eq!(saved[FLAG], true);
        // The next start: the file's key wins, the keychain fills the link.
        let (_, fill) = open(&mem, &saved);
        assert_eq!(fill.key("tmdbKey"), None);
        assert_eq!(fill.addon("org.example.a#0"), Some(LINK));
    }

    #[test]
    fn a_refused_write_leaves_them_in_the_file_and_unflags_it() {
        let mem = Memory::default();
        let mut f = file(Some("KEY"), &[]);
        let (mut vault, _) = open(&mem, &f);
        vault.take(&mut f).unwrap();
        mem.broken.set(Some(false));
        let mut changed = file(Some("NEWER"), &[]);
        assert!(vault.take(&mut changed).is_err());
        assert_eq!(changed["settings"]["tmdbKey"], "NEWER");
        assert_eq!(changed[FLAG], false);
        // Unflagged, the keychain's older key is ignored at the next start.
        mem.broken.set(None);
        let (_, fill) = open(&mem, &changed);
        assert!(fill.is_empty());
    }

    #[test]
    fn removing_every_secret_empties_the_keychain() {
        let mem = Memory::default();
        let mut f = file(Some("KEY"), &[]);
        let (mut vault, _) = open(&mem, &f);
        vault.take(&mut f).unwrap();
        let mut none = file(None, &[]);
        vault.take(&mut none).unwrap();
        assert!(mem.entries.borrow().is_empty());
    }

    #[test]
    fn add_ons_with_the_same_id_get_their_own_slots() {
        assert_eq!(slots(["a", "b", "a", "a"]), ["a#0", "b#0", "a#1", "a#2"]);
        let f = file(None, &[("a", "https://one.example.com/"), ("a", "https://two.example.com/")]);
        let s = Secrets::of(&f);
        assert_eq!(s.addon("a#1"), Some("https://two.example.com/"));
    }
}
