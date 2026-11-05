//! Locks that survive a panic (critique M17). A command that panics while
//! holding a std lock poisons it, and with `.lock().unwrap()` every later
//! command touching it panics too, which leaves the app dead until restarted.
//! What these locks guard (the store, caches, mpv's bookkeeping) is still
//! worth using after such a panic, so take the data and go on.

use std::sync::{Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub trait Locked<T> {
    fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T> Locked<T> for Mutex<T> {
    fn locked(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub trait ReadWrite<T> {
    fn reading(&self) -> RwLockReadGuard<'_, T>;
    fn writing(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T> ReadWrite<T> for RwLock<T> {
    fn reading(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn writing(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(PoisonError::into_inner)
    }
}
