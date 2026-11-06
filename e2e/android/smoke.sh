#!/bin/sh
# Android emulator smoke test (e2e-app.yml, job android): install the debug APK, start it, and check
# that it is still running with no crash after the web view has loaded; then Back must leave it running
# or close it cleanly, never crash it. An APK that carries libmpv must have it loaded by then (the app
# loads it at start, src-tauri/src/player/android.rs). Logcat, screenshots, the app's log and its memory
# map go to e2e/android/out.
# Usage: e2e/android/smoke.sh <apk>   (with an emulator or device on adb)
#
# No `set -e`: adb ends with 255 on its own errors (device offline, connection closed), which would stop
# the script without a word. Every step goes through `run`, which prints the command and, when it fails,
# its status; the checks decide from what was saved.
set -u
apk="$1"
pkg=app.getpolar.desktop
out="$(dirname "$0")/out"
mkdir -p "$out"

# run <command...>: run it, say so when it fails, return its status.
run() {
  echo "+ $*" >&2
  "$@"
  status=$?
  [ "$status" -eq 0 ] || echo "  (exit status $status)" >&2
  return "$status"
}

fail() {
  echo "$*" >&2
  run adb get-state > "$out/adb-state.txt" 2>&1
  exit 1
}

shot() { run adb exec-out screencap -p > "$out/$1.png"; }
crashed() { adb logcat -d -b crash | grep -q "$pkg"; }
pid() { adb shell pidof "$pkg" | tr -d '\r'; }

run adb wait-for-device || fail "No emulator or device on adb."
run adb install -r "$apk" || fail "Installing the APK failed."
run adb logcat -c
run adb shell am start -W -n "$pkg/.MainActivity" || fail "Starting the app failed."
sleep 30

shot started
run adb logcat -d > "$out/logcat-started.txt"
if crashed; then
  fail "The app crashed after starting (logcat in $out)."
fi
running="$(pid)"
[ -n "$running" ] || fail "The app stopped after starting: no process (logcat in $out)."
echo "Running as process $running."

# Whether the APK carries libmpv: unzip where the runner has it, Python's zipfile otherwise.
if command -v unzip > /dev/null; then
  list() { unzip -l "$apk"; }
else
  list() { python3 -m zipfile -l "$apk"; }
fi
if ! list > "$out/apk-files.txt" 2>&1; then
  fail "Couldn't list the APK's files ($out/apk-files.txt)."
fi

# Whether libmpv is loaded, from inside the app: `run-as` (the APK is a debug build) runs as the app's own
# user, which may read its memory map and log; plain `adb shell` may not read another app's
# /proc/<pid>/maps on current emulator images. The app's log says either "libmpv loaded" or why not
# (player/android.rs); the map shows the library itself, unless the APK keeps it uncompressed and the
# linker maps it straight from base.apk. Both are saved before anything is decided.
if grep -q 'lib/x86_64/libmpv.so' "$out/apk-files.txt"; then
  # One string, so the device's shell hands the inner command to run-as whole (it runs in the app's folder).
  run adb shell "run-as $pkg sh -c 'cat \"\$(find . -name polar.log | head -n 1)\"'" > "$out/polar.log" 2>&1
  run adb shell run-as "$pkg" cat "/proc/$running/maps" > "$out/maps.txt" 2>&1
  if grep -q '^[0-9a-f]' "$out/maps.txt"; then
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
    fail "(log and memory map in $out)"
  elif [ "$maps" = read ]; then
    fail "The APK carries libmpv but the app didn't load it: not in its memory map, nothing in its log ($out)."
  else
    echo "Couldn't check whether the app loaded libmpv: neither its log nor its memory map could be read ($out):" >&2
    head -n 3 "$out/maps.txt" "$out/polar.log" >&2
    fail "(see above)"
  fi
else
  echo "The APK carries no libmpv: the player uses the web view's video."
fi

# Back, as the button or gesture sends it (KEYCODE_BACK): handled by the page (src/lib/ui/systemBack.ts).
run adb shell input keyevent 4 || fail "Sending Back failed."
sleep 5
shot after-back
run adb logcat -d > "$out/logcat-after-back.txt"
if crashed; then
  fail "The app crashed on Back (logcat in $out)."
fi
echo "Started, ran 30 s, took Back without a crash."
