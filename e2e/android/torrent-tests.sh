#!/bin/sh
# The torrent engine's tests on the Android emulator (e2e-app.yml, job android; #207): each test binary
# cargo built for x86_64-linux-android is pushed to the device and run there, the loopback test sharing
# and fetching a made-up file over the device's own loopback, its scratch folder in /data/local/tmp.
# Usage: e2e/android/torrent-tests.sh <test binary>...   (with an emulator or device on adb)
set -u
[ "$#" -gt 0 ] || { echo "no test binaries given" >&2; exit 1; }
dir=/data/local/tmp/polar-torrent
adb shell "rm -rf $dir && mkdir -p $dir/scratch" || exit 1
status=0
for bin in "$@"; do
  name="$(basename "$bin")"
  echo "+ $name" >&2
  adb push "$bin" "$dir/$name" > /dev/null || { status=1; continue; }
  # adb shell passes the test's own exit status back (Android 7 and later).
  adb shell "chmod 755 $dir/$name && cd $dir && POLAR_TORRENT_SCRATCH=$dir/scratch ./$name --test-threads=1" || status=1
done
adb shell "rm -rf $dir"
exit "$status"
