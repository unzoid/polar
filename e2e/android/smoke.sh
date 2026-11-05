#!/bin/sh
# Android emulator smoke test (e2e-app.yml, job android): install the debug APK, start it, and check
# that it is still running with no crash after the web view has loaded; then Back must leave it running
# or close it cleanly, never crash it. An APK that carries libmpv must have it loaded by then (the app
# loads it at start, src-tauri/src/player/android.rs). Logcat and a screenshot go to e2e/android/out.
# Usage: e2e/android/smoke.sh <apk>   (with an emulator or device on adb)
set -eu
apk="$1"
pkg=app.getpolar.desktop
out="$(dirname "$0")/out"
mkdir -p "$out"

adb wait-for-device
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n "$pkg/.MainActivity"
sleep 30

shot() { adb exec-out screencap -p > "$out/$1.png" || true; }
crashed() { adb logcat -d -b crash | grep -q "$pkg"; }
alive() { [ -n "$(adb shell pidof "$pkg" | tr -d '\r')" ]; }

shot started
adb logcat -d > "$out/logcat-started.txt"
if crashed || ! alive; then
  echo "The app crashed or stopped after starting (logcat in $out)." >&2
  exit 1
fi
if unzip -l "$apk" | grep -q 'lib/x86_64/libmpv.so'; then
  if ! adb shell cat "/proc/$(adb shell pidof "$pkg" | tr -d '\r')/maps" | grep -q libmpv.so; then
    echo "The APK carries libmpv but the app didn't load it (logcat in $out)." >&2
    exit 1
  fi
  echo "libmpv loaded."
fi

# Back, as the button or gesture sends it (KEYCODE_BACK): handled by the page (src/lib/ui/systemBack.ts).
adb shell input keyevent 4
sleep 5
shot after-back
adb logcat -d > "$out/logcat-after-back.txt"
if crashed; then
  echo "The app crashed on Back (logcat in $out)." >&2
  exit 1
fi
echo "Started, ran 30 s, took Back without a crash."
