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
# Whether libmpv is loaded, from inside the app: `run-as` (the APK is a debug build) runs as the app's own
# user, which may read its memory map and log; plain `adb shell` may not read another app's
# /proc/<pid>/maps on current emulator images. The app's log says either "libmpv loaded" or why not
# (player/android.rs); the map shows the library itself, unless the APK keeps it uncompressed and the
# linker maps it straight from base.apk. Both go to $out.
if unzip -l "$apk" | grep -q 'lib/x86_64/libmpv.so'; then
  pid="$(adb shell pidof "$pkg" | tr -d '\r')"
  # One string, so the device's shell hands the inner command to run-as whole (it runs in the app's folder).
  adb shell "run-as $pkg sh -c 'cat \"\$(find . -name polar.log | head -n 1)\"'" > "$out/polar.log" 2>&1 || true
  if adb shell run-as "$pkg" cat "/proc/$pid/maps" > "$out/maps.txt" 2>&1 && grep -q '^[0-9a-f]' "$out/maps.txt"; then
    maps=read
  else
    maps=unreadable
  fi
  if grep -q 'libmpv loaded' "$out/polar.log"; then
    echo "libmpv loaded (the app's log says so)."
  elif [ "$maps" = read ] && grep -q 'libmpv\.so' "$out/maps.txt"; then
    echo "libmpv loaded (it is in the app's memory map)."
  elif grep -q 'no libmpv' "$out/polar.log"; then
    echo "The APK carries libmpv but the app couldn't load it; its log says:" >&2
    grep 'no libmpv' "$out/polar.log" >&2
    exit 1
  elif [ "$maps" = read ]; then
    echo "The APK carries libmpv but the app didn't load it: not in its memory map, nothing in its log ($out)." >&2
    exit 1
  else
    echo "Couldn't check whether the app loaded libmpv: neither its log nor its memory map could be read ($out):" >&2
    head -n 3 "$out/maps.txt" "$out/polar.log" >&2
    exit 1
  fi
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
