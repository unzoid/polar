#!/usr/bin/env bash
# Builds libmpv and FFmpeg for the Android app the way mpv-android builds them (GPL build,
# docs/plan-mobile.md §7), and packs the exact sources that went into them.
#
#   scripts/android-mpv.sh <work dir> <arch>...      arch: arm64, x86_64
#
# Needs: ANDROID_HOME (an Android SDK the script may install into), a JDK, and
# autoconf, pkg-config, libtool, ninja, meson, gperf, nasm, wget.
#
# Writes into <work dir>/out:
#   jniLibs/<abi>/*.so                      libmpv, FFmpeg and what they link
#   assets/licenses/mpv/                    licence texts and BUNDLED.txt
#   polarity-android-mpv-sources.tar.xz     every source, the build scripts, SOURCES.txt
#                                           (versions, how each is configured)
# and copies jniLibs and assets into the app (src-tauri/gen/android/app/src/main).
# The sources archive goes with every release that carries an APK built from these libraries.
set -euo pipefail

work=$(realpath -m "${1:?usage: android-mpv.sh <work dir> <arch>...}")
shift
archs=("$@")
[ ${#archs[@]} -gt 0 ] || { echo "no architecture given" >&2; exit 1; }

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
app="$root/src-tauri/gen/android/app/src/main"
out="$work/out"

# Pinned versions. mpv-android's own scripts pin the rest (buildscripts/include/depinfo.sh) and,
# for CI builds, FFmpeg (v_ci_ffmpeg); the libraries they take from git's newest commit are pinned here.
MPV_ANDROID_REPO=https://github.com/mpv-android/mpv-android
MPV_ANDROID_COMMIT=255901dd586fa750000fa0075f69d6ffdd26cd9c
MPV_TAG=v0.42.0
DAV1D_TAG=1.5.4
LIBASS_TAG=0.17.5
LIBPLACEBO_TAG=v7.387.0

mkdir -p "$work"
cd "$work"
if [ ! -d mpv-android ]; then
	git init -q mpv-android
	git -C mpv-android fetch -q --depth 1 "$MPV_ANDROID_REPO" "$MPV_ANDROID_COMMIT"
	git -C mpv-android checkout -q FETCH_HEAD
fi
cd mpv-android/buildscripts

# The SDK the runner already has; mpv-android's script adds its platform, build tools and NDK.
if [ -n "${ANDROID_HOME:-}" ] && [ ! -e sdk/android-sdk-linux ]; then
	mkdir -p sdk
	ln -s "$ANDROID_HOME" sdk/android-sdk-linux
fi
IN_CI=1 WGET="wget -q" ./include/download-sdk.sh

mkdir -p deps
clone() { # dir url tag [git options]
	[ -d "deps/$1" ] || git clone -q --depth 1 -b "$3" "${@:4}" "$2" "deps/$1"
}
clone mpv https://github.com/mpv-player/mpv "$MPV_TAG"
clone dav1d https://github.com/videolan/dav1d "$DAV1D_TAG"
clone libass https://github.com/libass/libass "$LIBASS_TAG"
clone libplacebo https://github.com/haasn/libplacebo "$LIBPLACEBO_TAG" --recurse-submodules --shallow-submodules
IN_CI=1 WGET="wget -q" ./include/download-deps.sh

# What each library is, before anything is built (the archive holds sources only).
. ./include/depinfo.sh
{
	echo "Sources of libmpv and FFmpeg in Polarity's Android app"
	echo
	echo "Built with mpv-android's build scripts ($MPV_ANDROID_REPO, commit $MPV_ANDROID_COMMIT),"
	echo "included under mpv-android/, by Polarity's scripts/android-mpv.sh (included) for: ${archs[*]}"
	echo "Android NDK $v_ndk ($v_ndk_n), minimum API level 23."
	echo
	echo "Libraries (folder in mpv-android/buildscripts/deps/: version or git commit, origin):"
	for d in deps/*/; do
		d=${d%/}
		name=${d#deps/}
		if [ -d "$d/.git" ]; then
			echo "  $name: $(git -C "$d" describe --tags --always 2>/dev/null) ($(git -C "$d" rev-parse HEAD)), $(git -C "$d" remote get-url origin)"
		else
			var="v_${name//-/_}"
			echo "  $name: ${!var:-see the folder}"
		fi
	done
	echo
	echo "How each is configured: mpv-android/buildscripts/scripts/<name>.sh (FFmpeg: ffmpeg.sh,"
	echo "with --enable-gpl --enable-version3; mpv: mpv.sh). To rebuild, in mpv-android/buildscripts:"
	echo "include/download-sdk.sh (SDK and NDK), then buildall.sh --arch <arch> mpv."
} >"$work/SOURCES.txt"

tar -cf - --exclude=.git --exclude='_build*' \
	--exclude=mpv-android/buildscripts/sdk --exclude=mpv-android/buildscripts/prefix \
	--transform 's,^,polarity-android-mpv-sources/,' \
	-C "$work" SOURCES.txt mpv-android -C "$root/scripts" android-mpv.sh |
	xz -T0 >"$work/sources.tar.xz"
mkdir -p "$out"
mv "$work/sources.tar.xz" "$out/polarity-android-mpv-sources.tar.xz"

ndk=$(realpath "sdk/android-ndk-$v_ndk")
readelf=$(echo "$ndk"/toolchains/llvm/prebuilt/*/bin/llvm-readelf)
# Libraries every Android device has; anything else a bundled library needs must be bundled too.
system=" libc.so libm.so libdl.so liblog.so libandroid.so libEGL.so libGLESv2.so libGLESv3.so libOpenSLES.so libmediandk.so libz.so libvulkan.so libaaudio.so libnativewindow.so "

for arch in "${archs[@]}"; do
	./buildall.sh --arch "$arch" mpv
	case $arch in
		arm64) abi=arm64-v8a triple=aarch64-linux-android ;;
		x86_64) abi=x86_64 triple=x86_64-linux-android ;;
		*) echo "unsupported architecture $arch" >&2; exit 1 ;;
	esac
	libs="$out/jniLibs/$abi"
	mkdir -p "$libs"
	for lib in prefix/"$arch"/lib/*.so; do
		cp -L "$lib" "$libs/"
	done
	# The NDK's shared C++ runtime, when something links it. (Not `readelf | grep -q`: grep quits at
	# the first match, readelf dies of SIGPIPE, and pipefail turns the match into a failure.)
	needed=$("$readelf" -d "$libs"/*.so)
	if [[ $needed == *"[libc++_shared.so]"* ]]; then
		cp "$(echo "$ndk"/toolchains/llvm/prebuilt/*/sysroot/usr/lib/"$triple"/libc++_shared.so)" "$libs/"
	fi
	missing=0
	for lib in "$libs"/*.so; do
		for need in $("$readelf" -d "$lib" | sed -n 's/.*NEEDED.*\[\(.*\)\]/\1/p'); do
			if [[ "$system" != *" $need "* && ! -f "$libs/$need" ]]; then
				echo "$(basename "$lib") needs $need, which isn't bundled" >&2
				missing=1
			fi
		done
	done
	[ $missing -eq 0 ] || exit 1
done

licenses="$out/assets/licenses/mpv"
mkdir -p "$licenses"
cp deps/mpv/LICENSE.GPL "$licenses/LICENSE.GPL.txt"
cp deps/mpv/Copyright "$licenses/COPYRIGHT.txt"
cp deps/ffmpeg/COPYING.GPLv3 "$licenses/FFmpeg-COPYING.GPLv3.txt"
cp deps/ffmpeg/LICENSE.md "$licenses/FFmpeg-LICENSE.md"
cxx=$(ls "$out"/jniLibs/*/libc++_shared.so 2>/dev/null || true)
[ -z "$cxx" ] || cp "$ndk/NOTICE.toolchain" "$licenses/libc++-NOTICE.txt"
{
	echo "This app carries libmpv and FFmpeg (GPL), built for Android from the sources in"
	echo "polarity-android-mpv-sources.tar.xz, published with each release of the app."
	echo
	sed -n '/^Libraries/,/^$/p' "$work/SOURCES.txt"
	if [ -n "$cxx" ]; then
		echo "libc++_shared.so: LLVM's C++ runtime from Android NDK $v_ndk ($v_ndk_n), which libmpv"
		echo "and its libraries link; Apache-2.0 WITH LLVM-exception, notices in libc++-NOTICE.txt."
	fi
} >"$licenses/BUNDLED.txt"

mkdir -p "$app"
cp -R "$out/jniLibs" "$out/assets" "$app/"
echo "libmpv for ${archs[*]} is in $app/jniLibs; sources: $out/polarity-android-mpv-sources.tar.xz"
