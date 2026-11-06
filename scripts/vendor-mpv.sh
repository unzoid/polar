#!/usr/bin/env bash
# Puts a scripts/windows-mpv.sh build (its out folder) into src-tauri/vendor: mpv.exe and its
# licence texts in vendor/mpv, which the Windows bundle takes (tauri.windows.conf.json), and the
# sources archive in vendor/mpv-sources, which release.ts attaches. CI's Windows test builds use it.
#
#   scripts/vendor-mpv.sh <out dir>
#
# With no build there (CI jobs that run before windows-mpv has built this version): empty
# stand-ins without a VERSION, enough for tauri-build, which release.ts refuses. Such an app
# can't play video.
set -euo pipefail

from=${1:?usage: vendor-mpv.sh <out dir>}
vendor="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src-tauri/vendor"
rm -rf "$vendor/mpv" "$vendor/mpv-sources"
mkdir -p "$vendor/mpv"
if [ -f "$from/mpv/mpv.exe" ]; then
	cp "$from"/mpv/* "$vendor/mpv/"
	mkdir -p "$vendor/mpv-sources"
	cp "$from/polarity-windows-mpv-sources.tar" "$vendor/mpv-sources/"
else
	echo "vendor-mpv.sh: no mpv build in $from, so empty stand-ins" >&2
	for f in mpv.exe d3dcompiler_43.dll LICENSE.GPL.txt COPYRIGHT.txt FFmpeg-COPYING.GPLv3.txt FFmpeg-LICENSE.md BUNDLED.txt; do
		: >"$vendor/mpv/$f"
	done
fi
