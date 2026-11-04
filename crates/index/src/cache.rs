use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Small TTL cache. Metadata changes slowly; the point is that revisiting a
/// title or scrolling back up a catalog never waits on the network.
pub struct TtlCache<K, V> {
    ttl: Duration,
    capacity: usize,
    entries: Mutex<HashMap<K, (Instant, V)>>,
}

impl<K: Eq + Hash + Clone, V: Clone> TtlCache<K, V> {
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        Self { ttl, capacity, entries: Mutex::new(HashMap::new()) }
    }

    pub fn get(&self, key: &K) -> Option<V> {
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        let (at, value) = entries.get(key)?;
        (at.elapsed() < self.ttl).then(|| value.clone())
    }

    pub fn insert(&self, key: K, value: V) {
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        if entries.len() >= self.capacity {
            // Drop expired entries first, then the oldest if still full.
            let ttl = self.ttl;
            entries.retain(|_, (at, _)| at.elapsed() < ttl);
            if entries.len() >= self.capacity {
                if let Some(oldest) = entries.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone()) {
                    entries.remove(&oldest);
                }
            }
        }
        entries.insert(key, (Instant::now(), value));
    }
}
