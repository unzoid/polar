#!/usr/bin/env bash
# Builds libmpv and FFmpeg for the Android app the way mpv-android builds them (GPL build,
# docs/plan-mobile.md §7), and packs the exact sources that went into them.
#
#   scripts/android-mpv.sh <work dir> <arch>...      arch: arm64, x86_64
#
# Needs: ANDROID_HOME (an Android SDK the script may install into), a JDK, and
# autoconf, pkg-config, libtool, ninja, meson, gperf, nasm, wget, sha256sum.
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

# Pinned versions. mpv-android's own scripts name the rest (buildscripts/include/depinfo.sh) and,
# for CI builds, FFmpeg (v_ci_ffmpeg), but fetch them without checks; this script fetches everything
# itself instead: each git source at its tag, which must be the commit below, and each archive with
# its SHA-256. A new mpv-android commit means checking these against its depinfo.sh again.
MPV_ANDROID_REPO=https://github.com/mpv-android/mpv-android
MPV_ANDROID_COMMIT=255901dd586fa750000fa0075f69d6ffdd26cd9c
MPV_TAG=v0.42.0 MPV_COMMIT=b0841e8c4d156b8403dc1876c4cbd9011eb583f3
DAV1D_TAG=1.5.4 DAV1D_COMMIT=54706fc6bc0cdecab7e9593974a4039cc038fca7
LIBASS_TAG=0.17.5 LIBASS_COMMIT=4a05d8127f525943ebf45fdc6497c9e665947f0d
LIBPLACEBO_TAG=v7.387.0 LIBPLACEBO_COMMIT=275f7dea27924cdd34ab2e6c20e448b6bc4fab65
FFMPEG_TAG=n9.0.2 FFMPEG_COMMIT=946fcce07b6dcd0331c8cc609192aeff5e1924f8
FREETYPE_TAG=VER-2-15-0 FREETYPE_COMMIT=37515cf56ba3349656049edbed89ffc6f6466f2d
LIBXML2_TAG=v2.15.4 LIBXML2_COMMIT=96498992efa48d52b0e8b83058bd88dbdaf153c1
FONTCONFIG_TAG=2.18.3 FONTCONFIG_COMMIT=FONTCONFIG_COMMIT_UNKNOWN
MBEDTLS_SHA256=a7e8bcbec0e6f761b4af24f25677626b35f762f68eef79c08677a363212d11f6
FRIBIDI_SHA256=6949dcde27d41cebad1fd741fcafc36d55a1020d2d872d4a6eb3914caabbada2
HARFBUZZ_SHA256=968536e9abd782f07f7954044c0c4020199fcdd39b41d221ec42d2a3be4a44df
UNIBREAK_SHA256=9c4fad6e517338a098373acc9f35579ae2c325e6446666fb9ac2666ba15ceba4
LUA_SHA256=b9e2e4aad6789b3b63a056d442f7b39f0ecfca3ae0f1fc0ae4e9614401b69f4b
CURL_SHA256=e3de77cfa6367083c776a26647fc9f633b538c06c3baa73d931a252ac8f72b49
# FFmpeg's gas-preprocessor (ARM assembly), which mpv-android takes from its newest commit.
GAS_PREPROCESSOR_COMMIT=ac1836309c2e77023c228b7184485597286289d3
GAS_PREPROCESSOR_SHA256=7124d70cdecba7c5612f9a71fbf3f28514dd9c2ca3022f58ad793f88bb925fcf

mkdir -p "$work"
cd "$work"
if [ ! -d mpv-android ]; then
	git init -q mpv-android
	git -C mpv-android fetch -q --depth 1 "$MPV_ANDROID_REPO" "$MPV_ANDROID_COMMIT"
	git -C mpv-android checkout -q FETCH_HEAD
fi
cd mpv-android/buildscripts

. ./include/depinfo.sh
# The versions above are the ones this commit of mpv-android names.
[ "$v_ci_ffmpeg" = "$FFMPEG_TAG" ] && [ "VER-${v_freetype//./-}" = "$FREETYPE_TAG" ] &&
	[ "v$v_libxml2" = "$LIBXML2_TAG" ] && [ "$v_fontconfig" = "$FONTCONFIG_TAG" ] ||
	{ echo "mpv-android's depinfo.sh names other versions than this script pins" >&2; exit 1; }

# The NDK, through the SDK's own sdkmanager (it checks what it downloads), in the SDK the runner
# already has; mpv-android's scripts look for it in sdk/.
[ -n "${ANDROID_HOME:-}" ] || { echo "ANDROID_HOME isn't set" >&2; exit 1; }
sdkmanager=$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager
[ -x "$sdkmanager" ] || sdkmanager=$ANDROID_HOME/cmdline-tools/bin/sdkmanager
mkdir -p sdk/bin
[ -e sdk/android-sdk-linux ] || ln -s "$ANDROID_HOME" sdk/android-sdk-linux
[ -d "$ANDROID_HOME/ndk/$v_ndk_n" ] || echo y | "$sdkmanager" --sdk_root="$ANDROID_HOME" "ndk;$v_ndk_n" >/dev/null
[ -e "sdk/android-ndk-$v_ndk" ] || ln -s "$ANDROID_HOME/ndk/$v_ndk_n" "sdk/android-ndk-$v_ndk"
grep -qF "$v_ndk_n" "sdk/android-ndk-$v_ndk/source.properties" ||
	{ echo "the NDK in sdk/android-ndk-$v_ndk isn't $v_ndk_n" >&2; exit 1; }

sha256() { # file sha256
	echo "$2  $1" | sha256sum -c --quiet - || { echo "$1 isn't the file this script pins" >&2; exit 1; }
}
if [ ! -x sdk/bin/gas-preprocessor.pl ]; then
	wget -q -O sdk/bin/gas-preprocessor.part \
		"https://raw.githubusercontent.com/FFmpeg/gas-preprocessor/$GAS_PREPROCESSOR_COMMIT/gas-preprocessor.pl"
	sha256 sdk/bin/gas-preprocessor.part "$GAS_PREPROCESSOR_SHA256"
	chmod +x sdk/bin/gas-preprocessor.part
	mv sdk/bin/gas-preprocessor.part sdk/bin/gas-preprocessor.pl
fi

mkdir -p deps
# Each source goes to deps/<name>.part first and gets its name once it's whole and checked.
clone() { # dir url tag commit [git options]
	if [ ! -d "deps/$1" ]; then
		rm -rf "deps/$1.part"
		git clone -q --depth 1 -b "$3" "${@:5}" "$2" "deps/$1.part"
		[ "$(git -C "deps/$1.part" rev-parse HEAD)" = "$4" ] ||
			{ echo "$1's tag $3 isn't commit $4 any more" >&2; exit 1; }
		mv "deps/$1.part" "deps/$1"
	fi
}
unpack() { # dir url sha256
	if [ ! -d "deps/$1" ]; then
		rm -rf "deps/$1.part" "deps/$1.archive"
		wget -q -O "deps/$1.archive" "$2"
		sha256 "deps/$1.archive" "$3"
		mkdir "deps/$1.part"
		tar -xf "deps/$1.archive" -C "deps/$1.part" --strip-components=1
		rm "deps/$1.archive"
		mv "deps/$1.part" "deps/$1"
	fi
}
clone mpv https://github.com/mpv-player/mpv "$MPV_TAG" "$MPV_COMMIT"
clone dav1d https://github.com/videolan/dav1d "$DAV1D_TAG" "$DAV1D_COMMIT"
clone libass https://github.com/libass/libass "$LIBASS_TAG" "$LIBASS_COMMIT"
clone libplacebo https://github.com/haasn/libplacebo "$LIBPLACEBO_TAG" "$LIBPLACEBO_COMMIT" --recurse-submodules --shallow-submodules
clone ffmpeg https://github.com/FFmpeg/FFmpeg "$FFMPEG_TAG" "$FFMPEG_COMMIT"
clone freetype2 https://github.com/freetype/freetype "$FREETYPE_TAG" "$FREETYPE_COMMIT" --recurse-submodules --shallow-submodules
clone libxml2 https://github.com/GNOME/libxml2 "$LIBXML2_TAG" "$LIBXML2_COMMIT"
clone fontconfig https://gitlab.freedesktop.org/fontconfig/fontconfig.git "$FONTCONFIG_TAG" "$FONTCONFIG_COMMIT"
unpack mbedtls "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-$v_mbedtls/mbedtls-$v_mbedtls.tar.bz2" "$MBEDTLS_SHA256"
unpack fribidi "https://github.com/fribidi/fribidi/releases/download/v$v_fribidi/fribidi-$v_fribidi.tar.xz" "$FRIBIDI_SHA256"
unpack harfbuzz "https://github.com/harfbuzz/harfbuzz/releases/download/$v_harfbuzz/harfbuzz-$v_harfbuzz.tar.xz" "$HARFBUZZ_SHA256"
unpack unibreak "https://github.com/adah1972/libunibreak/releases/download/libunibreak_${v_unibreak//./_}/libunibreak-$v_unibreak.tar.gz" "$UNIBREAK_SHA256"
unpack lua "https://www.lua.org/ftp/lua-$v_lua.tar.gz" "$LUA_SHA256"
unpack curl "https://curl.se/download/curl-$v_curl.tar.gz" "$CURL_SHA256"
# Every library mpv-android builds is here now (its download-deps.sh isn't run).
for dep in ${!dep_*}; do
	dep=${dep#dep_}
	[ "$dep" = mpv_android ] || [ -d "deps/$dep" ] || { echo "no source for $dep" >&2; exit 1; }
done

# What each library is, before anything is built (the archive holds sources only).
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
	echo "the NDK $v_ndk_n in sdk/android-ndk-$v_ndk, then buildall.sh --arch <arch> mpv."
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
