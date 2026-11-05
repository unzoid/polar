//! Secrets kept in the system's keychain, whatever its size limit.
//!
//! The sign-in session lives in the OS credential store (Keychain on macOS, Credential
//! Manager on Windows, the Secret Service on Linux). `src-tauri` implements [`SecretStore`]
//! over the `keyring` crate; this module only decides how a value is laid out in it, so it
//! is tested here with a store in memory.
//!
//! Windows refuses a credential over 2,560 bytes and a session is larger, so [`Chunked`]
//! splits a value the store can't hold in one entry:
//!
//! - `name` holds the value itself after a `0` byte when it fits in one entry,
//! - or `1` then `<generation> <count>`, the value then being in `name.<generation>.<i>`.
//!
//! A new value goes into a new generation of chunks before the head points at it, so a
//! write that fails halfway leaves the old value readable. Chunks of the old generation
//! are deleted after; one left behind by a failure is only a few bytes of dead entry.

use std::fmt;

/// Why the store couldn't do what was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    /// No keychain on this system or none running (no Secret Service, a phone build): the
    /// caller falls back to its own storage.
    Unavailable(String),
    /// The keychain is there but refused or failed (locked, access denied, too long).
    Failed(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Unavailable(why) => write!(f, "no keychain: {why}"),
            StoreError::Failed(why) => write!(f, "keychain: {why}"),
        }
    }
}

impl std::error::Error for StoreError {}

/// One entry per name, bytes in and out.
pub trait SecretStore {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError>;
    fn set(&self, name: &str, value: &[u8]) -> Result<(), StoreError>;
    /// Deleting what isn't there is not an error.
    fn delete(&self, name: &str) -> Result<(), StoreError>;
}

const WHOLE: u8 = 0;
const SPLIT: u8 = 1;

/// Values of any size over a store whose entries hold at most `max` bytes.
pub struct Chunked<S> {
    store: S,
    max: usize,
}

/// Where a head says the value is.
enum Head {
    Whole(Vec<u8>),
    Split { generation: u64, count: usize },
}

impl<S: SecretStore> Chunked<S> {
    /// `max` is the largest entry `store` takes (at least 32 bytes).
    pub fn new(store: S, max: usize) -> Self {
        Chunked { store, max: max.max(32) }
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    /// The value under `name`; `None` when there is none or its chunks are gone.
    pub fn get(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
        match self.head(name)? {
            None => Ok(None),
            Some(Head::Whole(value)) => Ok(Some(value)),
            Some(Head::Split { generation, count }) => {
                let mut value = Vec::new();
                for i in 0..count {
                    match self.store.get(&chunk(name, generation, i))? {
                        Some(part) => value.extend_from_slice(&part),
                        None => return Ok(None),
                    }
                }
                Ok(Some(value))
            }
        }
    }

    pub fn set(&self, name: &str, value: &[u8]) -> Result<(), StoreError> {
        let old = self.head(name).unwrap_or(None);
        if value.len() < self.max {
            let mut head = Vec::with_capacity(value.len() + 1);
            head.push(WHOLE);
            head.extend_from_slice(value);
            self.store.set(name, &head)?;
        } else {
            let generation = match old {
                Some(Head::Split { generation, .. }) => generation.wrapping_add(1),
                _ => 0,
            };
            let parts: Vec<&[u8]> = value.chunks(self.max).collect();
            for (i, part) in parts.iter().enumerate() {
                self.store.set(&chunk(name, generation, i), part)?;
            }
            let mut head = vec![SPLIT];
            head.extend_from_slice(format!("{generation} {}", parts.len()).as_bytes());
            self.store.set(name, &head)?;
        }
        if let Some(Head::Split { generation, count }) = old {
            // The new head no longer points at them; a failure here only leaves dead entries.
            let _ = self.delete_chunks(name, generation, count);
        }
        Ok(())
    }

    pub fn delete(&self, name: &str) -> Result<(), StoreError> {
        if let Some(Head::Split { generation, count }) = self.head(name).unwrap_or(None) {
            self.delete_chunks(name, generation, count)?;
        }
        self.store.delete(name)
    }

    fn head(&self, name: &str) -> Result<Option<Head>, StoreError> {
        let Some(bytes) = self.store.get(name)? else { return Ok(None) };
        Ok(match bytes.split_first() {
            Some((&WHOLE, rest)) => Some(Head::Whole(rest.to_vec())),
            Some((&SPLIT, rest)) => {
                let text = std::str::from_utf8(rest).unwrap_or("");
                let mut words = text.split(' ').map(str::parse::<u64>);
                match (words.next(), words.next(), words.next()) {
                    (Some(Ok(generation)), Some(Ok(count)), None) if count > 0 && count <= 1024 => {
                        Some(Head::Split { generation, count: count as usize })
                    }
                    _ => None,
                }
            }
            // Not written by this module: nothing it can read.
            _ => None,
        })
    }

    fn delete_chunks(&self, name: &str, generation: u64, count: usize) -> Result<(), StoreError> {
        for i in 0..count {
            self.store.delete(&chunk(name, generation, i))?;
        }
        Ok(())
    }
}

fn chunk(name: &str, generation: u64, i: usize) -> String {
    format!("{name}.{generation}.{i}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;

    /// A store in memory that refuses entries over `max` and can be told to fail after `n` writes.
    #[derive(Default)]
    struct Memory {
        entries: RefCell<BTreeMap<String, Vec<u8>>>,
        max: usize,
        writes_left: Cell<Option<usize>>,
    }

    impl Memory {
        fn new(max: usize) -> Self {
            Memory { max, ..Default::default() }
        }
        fn names(&self) -> Vec<String> {
            self.entries.borrow().keys().cloned().collect()
        }
    }

    impl SecretStore for &Memory {
        fn get(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
            Ok(self.entries.borrow().get(name).cloned())
        }
        fn set(&self, name: &str, value: &[u8]) -> Result<(), StoreError> {
            if value.len() > self.max {
                return Err(StoreError::Failed("too long".into()));
            }
            if let Some(n) = self.writes_left.get() {
                if n == 0 {
                    return Err(StoreError::Failed("locked".into()));
                }
                self.writes_left.set(Some(n - 1));
            }
            self.entries.borrow_mut().insert(name.into(), value.to_vec());
            Ok(())
        }
        fn delete(&self, name: &str) -> Result<(), StoreError> {
            self.entries.borrow_mut().remove(name);
            Ok(())
        }
    }

    fn session(len: usize) -> Vec<u8> {
        (0..len).map(|i| b'a' + (i % 26) as u8).collect()
    }

    #[test]
    fn a_small_value_is_one_entry() {
        let mem = Memory::new(2560);
        let keys = Chunked::new(&mem, 2560);
        keys.set("polar.auth", b"{\"a\":1}").unwrap();
        assert_eq!(mem.names(), ["polar.auth"]);
        assert_eq!(keys.get("polar.auth").unwrap().unwrap(), b"{\"a\":1}");
    }

    #[test]
    fn a_large_value_is_split_and_read_back() {
        let mem = Memory::new(2560);
        let keys = Chunked::new(&mem, 2560);
        let value = session(6000);
        keys.set("polar.auth", &value).unwrap();
        assert_eq!(mem.names(), ["polar.auth", "polar.auth.0.0", "polar.auth.0.1", "polar.auth.0.2"]);
        assert_eq!(keys.get("polar.auth").unwrap().unwrap(), value);
    }

    #[test]
    fn a_value_exactly_one_entry_long_is_split() {
        // The head's marker byte makes it one byte too long for a single entry.
        let mem = Memory::new(100);
        let keys = Chunked::new(&mem, 100);
        let value = session(100);
        keys.set("k", &value).unwrap();
        assert_eq!(keys.get("k").unwrap().unwrap(), value);
        keys.set("k", &session(99)).unwrap();
        assert_eq!(mem.names(), ["k"]);
    }

    #[test]
    fn rewriting_moves_to_a_new_generation_and_drops_the_old_chunks() {
        let mem = Memory::new(100);
        let keys = Chunked::new(&mem, 100);
        keys.set("k", &session(250)).unwrap();
        keys.set("k", &session(150)).unwrap();
        assert_eq!(mem.names(), ["k", "k.1.0", "k.1.1"]);
        assert_eq!(keys.get("k").unwrap().unwrap(), session(150));
        keys.set("k", b"short").unwrap();
        assert_eq!(mem.names(), ["k"]);
        assert_eq!(keys.get("k").unwrap().unwrap(), b"short");
    }

    #[test]
    fn a_write_that_fails_halfway_keeps_the_old_value() {
        let mem = Memory::new(100);
        let keys = Chunked::new(&mem, 100);
        keys.set("k", &session(250)).unwrap();
        mem.writes_left.set(Some(1));
        let mut newer = session(250);
        newer.reverse();
        assert!(keys.set("k", &newer).is_err());
        assert_eq!(keys.get("k").unwrap().unwrap(), session(250));
        mem.writes_left.set(None);
        keys.set("k", &newer).unwrap();
        assert_eq!(keys.get("k").unwrap().unwrap(), newer);
    }

    #[test]
    fn delete_removes_every_entry_and_missing_reads_as_none() {
        let mem = Memory::new(100);
        let keys = Chunked::new(&mem, 100);
        assert_eq!(keys.get("k").unwrap(), None);
        keys.set("k", &session(300)).unwrap();
        keys.set("other", b"x").unwrap();
        keys.delete("k").unwrap();
        assert_eq!(mem.names(), ["other"]);
        assert_eq!(keys.get("k").unwrap(), None);
        keys.delete("k").unwrap();
    }

    #[test]
    fn a_lost_chunk_or_a_foreign_head_reads_as_none() {
        let mem = Memory::new(100);
        let keys = Chunked::new(&mem, 100);
        keys.set("k", &session(250)).unwrap();
        mem.entries.borrow_mut().remove("k.0.1");
        assert_eq!(keys.get("k").unwrap(), None);
        mem.entries.borrow_mut().insert("j".into(), b"{plain}".to_vec());
        assert_eq!(keys.get("j").unwrap(), None);
        mem.entries.borrow_mut().insert("j".into(), vec![SPLIT, b'x']);
        assert_eq!(keys.get("j").unwrap(), None);
        // and it can be written over.
        keys.set("j", b"ok").unwrap();
        assert_eq!(keys.get("j").unwrap().unwrap(), b"ok");
    }
}
