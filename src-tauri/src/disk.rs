//! Free space on the disk that holds a folder (the Downloads page's "112 GB free", #15). The
//! standard library can't ask, so this calls the OS: `statvfs` (libc) everywhere but Windows,
//! `GetDiskFreeSpaceExW` (windows-sys) there. Any failure is `None`, and the page leaves the
//! figure out.

use std::path::Path;

/// Bytes free to this user on the disk holding `dir`, or on its nearest existing parent (the
/// downloads folder is only made with the first download).
pub fn free_bytes(dir: &Path) -> Option<u64> {
    let existing = dir.ancestors().find(|p| p.is_dir())?;
    free(existing)
}

#[cfg(unix)]
fn free(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is a NUL-terminated string and `stat` is written by statvfs before it's read.
    if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return None;
    }
    let stat = unsafe { stat.assume_init() };
    #[allow(clippy::unnecessary_cast)] // the field types differ between platforms
    (stat.f_bavail as u64).checked_mul(stat.f_frsize as u64)
}

#[cfg(windows)]
fn free(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let path: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    // SAFETY: `path` is NUL-terminated UTF-16; the two counts we don't need may be null.
    let ok = unsafe { GetDiskFreeSpaceExW(path.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
    (ok != 0).then_some(available)
}

#[cfg(not(any(unix, windows)))]
fn free(_: &Path) -> Option<u64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_folder_has_some_space_and_a_missing_one_asks_its_parent() {
        let here = std::env::temp_dir();
        assert!(free_bytes(&here).is_some_and(|b| b > 0));
        assert!(free_bytes(&here.join("polar-not-made-yet/deeper")).is_some());
    }
}
