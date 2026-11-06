#!/usr/bin/env bash
# Builds libmpv and FFmpeg for the iOS app as LGPL builds (mpv -Dgpl=false, FFmpeg without
# --enable-gpl or --enable-version3; docs/plan-mobile.md §7), and packs the exact sources that
# went into them. Runs on macOS with Xcode.
#
#   scripts/ios-mpv.sh <work dir> [device] [simulator]      default: device
#
# Needs: Xcode (xcrun, xcodebuild), meson, ninja, pkg-config, git, python3.
#
# Each LGPL library (mpv, FFmpeg's libraries, libplacebo, FriBidi) is a dynamic library of its
# own, wrapped as a framework the app embeds (Libmpv.framework, Libavcodec.framework, ...), so
# anyone can replace it with one built from the sources archive; the app loads libmpv at run
# time (player/apple.rs) and libmpv loads the rest. The others (dav1d, FreeType, HarfBuzz,
# libass; BSD, FTL, MIT, ISC) are linked statically into the library that uses them.
# Writes into <work dir>/out:
#   frameworks/<Name>.xcframework       each framework, for each platform built
#   licenses/                           licence texts and BUNDLED.txt
#   polarity-ios-mpv-sources.tar.xz     every source, this script, SOURCES.txt (versions, how
#                                       each is configured)
# and copies the frameworks and licences into src-tauri/vendor/ios, where tauri.ios.conf.json
# takes them from (its list must name every framework in FRAMEWORKS below). The sources archive goes with every release that carries an iOS build.
#
# Written for the bash 3.2 macOS ships, too.
set -euo pipefail

work=$(cd "$(dirname "${1:?usage: ios-mpv.sh <work dir> [device] [simulator]}")" && pwd)/$(basename "$1")
shift
platforms=("$@")
[ ${#platforms[@]} -gt 0 ] || platforms=(device)

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
out="$work/out"
src="$work/src"

# The oldest iOS the app runs on (tauri.ios.conf.json, bundle.iOS.minimumSystemVersion).
IOS_MIN=17.0

# The frameworks this build makes, as tauri.ios.conf.json lists them; the build stops if it made
# others.
FRAMEWORKS="Libavcodec Libavfilter Libavformat Libavutil Libfribidi Libmpv Libplacebo Libswresample Libswscale"

# Pinned versions: the same as the Android build's where both have the library.
FFMPEG_TAG=n9.0.2
MPV_TAG=v0.42.0
DAV1D_TAG=1.5.4
LIBASS_TAG=0.17.5
LIBPLACEBO_TAG=v7.387.0
FREETYPE_TAG=VER-2-15-0
HARFBUZZ_TAG=15.0.0
FRIBIDI_TAG=v1.0.17

mkdir -p "$src" "$out"
clone() { # dir url tag [git options]
	[ -d "$src/$1" ] || git clone -q --depth 1 -b "$3" "${@:4}" "$2" "$src/$1"
}
clone ffmpeg https://github.com/FFmpeg/FFmpeg "$FFMPEG_TAG"
clone mpv https://github.com/mpv-player/mpv "$MPV_TAG"
clone dav1d https://github.com/videolan/dav1d "$DAV1D_TAG"
clone libass https://github.com/libass/libass "$LIBASS_TAG"
clone libplacebo https://github.com/haasn/libplacebo "$LIBPLACEBO_TAG" --recurse-submodules --shallow-submodules
clone freetype https://github.com/freetype/freetype "$FREETYPE_TAG"
clone harfbuzz https://github.com/harfbuzz/harfbuzz "$HARFBUZZ_TAG"
clone fribidi https://github.com/fribidi/fribidi "$FRIBIDI_TAG"

# How each library is configured, the same for every platform (meson options, FFmpeg's flags).
DAV1D_OPTS="-Denable_tools=false -Denable_tests=false"
FREETYPE_OPTS="-Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled -Dpng=disabled -Dzlib=disabled"
FRIBIDI_OPTS="-Ddocs=false -Dbin=false -Dtests=false"
HARFBUZZ_OPTS="-Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dicu=disabled -Dcoretext=disabled -Dtests=disabled -Ddocs=disabled -Dutilities=disabled -Dintrospection=disabled"
LIBASS_OPTS="-Dfontconfig=disabled -Dcoretext=enabled -Ddirectwrite=disabled -Dlibunibreak=disabled -Dtest=disabled -Dcompare=disabled -Dprofile=disabled -Dfuzz=disabled -Dcheckasm=disabled"
LIBPLACEBO_OPTS="-Dvulkan=disabled -Dopengl=enabled -Dd3d11=disabled -Dglslang=disabled -Dshaderc=disabled -Dlcms=disabled -Ddovi=disabled -Dlibdovi=disabled -Ddemos=false -Dtests=false -Dbench=false -Dfuzz=false -Dunwind=disabled -Dxxhash=disabled"
FFMPEG_OPTS="--disable-programs --disable-doc --disable-debug --disable-avdevice --disable-indevs --disable-outdevs --disable-sdl2 --disable-xlib --disable-libxcb --enable-network --enable-securetransport --enable-videotoolbox --enable-audiotoolbox --enable-libdav1d --disable-metal"
MPV_OPTS="-Dlibmpv=true -Dcplayer=false -Dgpl=false -Dtests=false -Dmanpage-build=disabled -Dhtml-build=disabled -Dpdf-build=disabled \
-Dlua=disabled -Djavascript=disabled -Dlibarchive=disabled -Duchardet=disabled -Drubberband=disabled -Dzimg=disabled -Dlcms2=disabled \
-Dvapoursynth=disabled -Dlibbluray=disabled -Ddvdnav=disabled -Dcdda=disabled -Dsdl2-audio=disabled -Dsdl2-video=disabled -Dsdl2-gamepad=disabled \
-Dcocoa=disabled -Dcoreaudio=disabled -Davfoundation=disabled -Daudiounit=enabled -Dswift-build=disabled -Dmacos-cocoa-cb=disabled \
-Dmacos-media-player=disabled -Dmacos-touchbar=disabled -Dgl-cocoa=disabled -Dvulkan=disabled -Dgl=enabled -Dplain-gl=enabled \
-Dios-gl=enabled -Dvideotoolbox-gl=disabled -Dvideotoolbox-pl=disabled -Dlibcurl=disabled"

# What each library is, before anything is built (the archive holds sources only).
{
	echo "Sources of libmpv and FFmpeg in Polarity's iOS app"
	echo
	echo "Built by Polarity's scripts/ios-mpv.sh (included) for iOS $IOS_MIN and later (${platforms[*]}),"
	echo "mpv, FFmpeg's libraries, libplacebo and FriBidi as dynamic libraries (one framework each);"
	echo "dav1d, FreeType, HarfBuzz and libass static, inside the libraries that use them."
	echo "Both mpv and FFmpeg are built under the LGPL, version 2.1 or later."
	echo
	echo "Libraries (folder: version, git commit, origin):"
	for d in "$src"/*/; do
		d=${d%/}
		echo "  $(basename "$d"): $(git -C "$d" describe --tags --always 2>/dev/null) ($(git -C "$d" rev-parse HEAD)), $(git -C "$d" remote get-url origin)"
	done
	echo
	echo "How each is configured (meson options; FFmpeg's configure flags), the same for every platform:"
	echo "  dav1d: $DAV1D_OPTS"
	echo "  freetype: $FREETYPE_OPTS"
	echo "  fribidi: $FRIBIDI_OPTS"
	echo "  harfbuzz: $HARFBUZZ_OPTS"
	echo "  libass: $LIBASS_OPTS"
	echo "  libplacebo: $LIBPLACEBO_OPTS"
	echo "  ffmpeg: $FFMPEG_OPTS"
	echo "  mpv: $MPV_OPTS"
	echo
	echo "To rebuild on a Mac with Xcode: scripts/ios-mpv.sh <work dir> device simulator (it clones the"
	echo "same versions; or put the folders above under <work dir>/src first to build these copies)."
} >"$work/SOURCES.txt"

tar -cf - --exclude=.git -C "$work" SOURCES.txt src -C "$root/scripts" ios-mpv.sh |
	xz -T0 >"$work/sources.tar.xz"
mv "$work/sources.tar.xz" "$out/polarity-ios-mpv-sources.tar.xz"

# Libraries and frameworks every iOS device has; libmpv may link nothing else.
system_lib() {
	case "$1" in
		/usr/lib/* | /System/Library/*) return 0 ;;
		*) return 1 ;;
	esac
}

for platform in "${platforms[@]}"; do
	case $platform in
		device) sdk=iphoneos target="arm64-apple-ios$IOS_MIN" subsystem=ios plist_platform=iPhoneOS ;;
		simulator) sdk=iphonesimulator target="arm64-apple-ios$IOS_MIN-simulator" subsystem=ios-simulator plist_platform=iPhoneSimulator ;;
		*) echo "unknown platform $platform (device, simulator)" >&2; exit 1 ;;
	esac
	sysroot=$(xcrun --sdk "$sdk" --show-sdk-path)
	cc=$(xcrun --sdk "$sdk" --find clang)
	cxx=$(xcrun --sdk "$sdk" --find clang++)
	prefix="$work/prefix/$platform"
	build="$work/build/$platform"
	mkdir -p "$prefix" "$build"
	flags="-target $target -isysroot $sysroot"

	cross="$build/cross.txt"
	cat >"$cross" <<-EOF
		[binaries]
		c = ['$cc', '-target', '$target', '-isysroot', '$sysroot']
		cpp = ['$cxx', '-target', '$target', '-isysroot', '$sysroot']
		objc = ['$cc', '-target', '$target', '-isysroot', '$sysroot']
		ar = '$(xcrun --sdk "$sdk" --find ar)'
		strip = '$(xcrun --sdk "$sdk" --find strip)'
		pkg-config = 'pkg-config'

		[properties]
		needs_exe_wrapper = true

		[host_machine]
		system = 'darwin'
		subsystem = '$subsystem'
		kernel = 'xnu'
		cpu_family = 'aarch64'
		cpu = 'arm64'
		endian = 'little'
	EOF
	# Only this build's own libraries, never the Mac's.
	export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
	unset PKG_CONFIG_PATH

	meson_build() { # name [meson options...]; static unless library=shared
		local name=$1
		shift
		rm -rf "$build/$name"
		meson setup "$build/$name" "$src/$name" --cross-file "$cross" --prefix "$prefix" --libdir lib \
			--buildtype release -Ddefault_library="${library:-static}" -Db_pie=true "$@"
		ninja -C "$build/$name" install
	}

	# shellcheck disable=SC2086 # the option lists split into words on purpose
	meson_build dav1d $DAV1D_OPTS
	# shellcheck disable=SC2086
	meson_build freetype $FREETYPE_OPTS
	# shellcheck disable=SC2086
	library=shared meson_build fribidi $FRIBIDI_OPTS
	# shellcheck disable=SC2086
	meson_build harfbuzz $HARFBUZZ_OPTS
	# shellcheck disable=SC2086
	meson_build libass $LIBASS_OPTS
	# shellcheck disable=SC2086
	library=shared meson_build libplacebo $LIBPLACEBO_OPTS

	rm -rf "$build/ffmpeg"
	mkdir -p "$build/ffmpeg"
	# shellcheck disable=SC2086
	(cd "$build/ffmpeg" && "$src/ffmpeg/configure" --prefix="$prefix" \
		--enable-cross-compile --target-os=darwin --arch=aarch64 --cc="$cc" --cxx="$cxx" --sysroot="$sysroot" \
		--extra-cflags="$flags" --extra-ldflags="$flags" --pkg-config=pkg-config --pkg-config-flags=--static \
		--enable-shared --disable-static --enable-pic $FFMPEG_OPTS | tee "$build/ffmpeg-configure.txt")
	# An LGPLv2.1 build only: stop if an option above ever pulled FFmpeg up to GPL or (L)GPLv3.
	if ! grep -q '^License: LGPL version 2.1 or later' "$build/ffmpeg-configure.txt"; then
		echo "FFmpeg isn't configured as LGPL version 2.1 or later:" >&2
		grep '^License' "$build/ffmpeg-configure.txt" >&2 || true
		exit 1
	fi
	make -C "$build/ffmpeg" -j"$(sysctl -n hw.ncpu)" install

	# mpv itself, as the one shared library. Its Darwin checks look for a macOS SDK; they get
	# this platform's instead. Static HarfBuzz carries C++, so libc++ is linked; mpv's meson doesn't
	# link the frameworks its iOS GL interop (EAGLContext) and audio output (AVAudioSession) use.
	# shellcheck disable=SC2086
	library=shared MACOS_SDK="$sysroot" MACOS_SDK_VERSION="$(xcrun --sdk "$sdk" --show-sdk-version)" \
		meson_build mpv $MPV_OPTS -Dprefer_static=true \
		-Dc_link_args="-lc++ -framework OpenGLES -framework AVFoundation -framework CoreVideo" \
		-Dobjc_link_args="-lc++ -framework OpenGLES -framework AVFoundation -framework CoreVideo"

	# Each dynamic library as a framework: lib<name>.<version>.dylib becomes Lib<name>.framework/Lib<name>,
	# found through @rpath (the app's Frameworks folder), and the libraries refer to each other that way.
	mkdir -p "$out/$platform"
	names="$build/install-names.txt"
	: >"$names"
	made=""
	for lib in "$prefix"/lib/*.dylib; do
		[ -L "$lib" ] && continue
		stem=$(basename "$lib")
		stem=${stem%%.*}
		name="$(echo "${stem:0:1}" | tr '[:lower:]' '[:upper:]')${stem:1}"
		fw="$out/$platform/$name.framework"
		rm -rf "$fw"
		mkdir -p "$fw"
		cp "$lib" "$fw/$name"
		echo "$(otool -D "$lib" | tail -n 1) @rpath/$name.framework/$name" >>"$names"
		made="$made $name"
		# The version of the source it came from: its own folder (libplacebo, fribidi, mpv), else FFmpeg's.
		for dir in "$src/$stem" "$src/${stem#lib}" "$src/ffmpeg"; do
			[ -d "$dir" ] && break
		done
		version=$(git -C "$dir" describe --tags | sed 's/^[vn]//; s/[^0-9.].*//')
		cat >"$fw/Info.plist" <<-EOF
			<?xml version="1.0" encoding="UTF-8"?>
			<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
			<plist version="1.0">
			<dict>
				<key>CFBundleDevelopmentRegion</key><string>en</string>
				<key>CFBundleExecutable</key><string>$name</string>
				<key>CFBundleIdentifier</key><string>app.getpolar.desktop.$(echo "$stem" | tr '[:upper:]' '[:lower:]')</string>
				<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
				<key>CFBundleName</key><string>$name</string>
				<key>CFBundlePackageType</key><string>FMWK</string>
				<key>CFBundleShortVersionString</key><string>$version</string>
				<key>CFBundleVersion</key><string>$version</string>
				<key>CFBundleSupportedPlatforms</key><array><string>$plist_platform</string></array>
				<key>MinimumOSVersion</key><string>$IOS_MIN</string>
			</dict>
			</plist>
		EOF
	done
	if [ "$(echo $made | tr ' ' '\n' | sort | tr '\n' ' ')" != "$(echo $FRAMEWORKS | tr ' ' '\n' | sort | tr '\n' ' ')" ]; then
		echo "made the frameworks$made, not the expected $FRAMEWORKS (update FRAMEWORKS and tauri.ios.conf.json)" >&2
		exit 1
	fi
	missing=0
	for name in $FRAMEWORKS; do
		bin="$out/$platform/$name.framework/$name"
		install_name_tool -id "@rpath/$name.framework/$name" "$bin"
		while read -r old new; do
			install_name_tool -change "$old" "$new" "$bin"
		done <"$names"
		# Next to each other in the app's Frameworks folder.
		install_name_tool -add_rpath @loader_path/.. "$bin"
		for need in $(otool -L "$bin" | tail -n +2 | awk '{print $1}'); do
			case "$need" in
				@rpath/*.framework/*) [ -d "$out/$platform/$(basename "$need").framework" ] && continue ;;
			esac
			if ! system_lib "$need"; then
				echo "$name needs $need, which isn't part of iOS or this build" >&2
				missing=1
			fi
		done
	done
	[ $missing -eq 0 ] || exit 1
done


rm -rf "$out/frameworks"
mkdir -p "$out/frameworks"
for name in $FRAMEWORKS; do
	args=()
	for platform in "${platforms[@]}"; do
		args+=(-framework "$out/$platform/$name.framework")
	done
	xcodebuild -create-xcframework "${args[@]}" -output "$out/frameworks/$name.xcframework"
done

licenses="$out/licenses"
rm -rf "$licenses"
mkdir -p "$licenses"
cp "$src/mpv/LICENSE.LGPL" "$licenses/mpv-LICENSE.LGPL.txt"
cp "$src/mpv/Copyright" "$licenses/mpv-COPYRIGHT.txt"
cp "$src/ffmpeg/COPYING.LGPLv2.1" "$licenses/FFmpeg-COPYING.LGPLv2.1.txt"
cp "$src/ffmpeg/LICENSE.md" "$licenses/FFmpeg-LICENSE.md"
cp "$src/dav1d/COPYING" "$licenses/dav1d-COPYING.txt"
cp "$src/libass/COPYING" "$licenses/libass-COPYING.txt"
cp "$src/libplacebo/LICENSE" "$licenses/libplacebo-LICENSE.txt"
cp "$src/freetype/LICENSE.TXT" "$licenses/FreeType-LICENSE.txt"
cp "$src/freetype/docs/FTL.TXT" "$licenses/FreeType-FTL.txt"
cp "$src/harfbuzz/COPYING" "$licenses/HarfBuzz-COPYING.txt"
cp "$src/fribidi/COPYING" "$licenses/FriBidi-COPYING.txt"
{
	echo "This app carries libmpv and FFmpeg (LGPL version 2.1 or later), with the libraries they use,"
	echo "built for iOS from the sources in polarity-ios-mpv-sources.tar.xz, published with each release"
	echo "of the app. Each LGPL library is a framework of its own in the app (Libmpv, Libavcodec,"
	echo "Libavfilter, Libavformat, Libavutil, Libswresample, Libswscale, Libplacebo, Libfribidi), loaded"
	echo "at run time, and can be replaced with one built from those sources (scripts/ios-mpv.sh in the"
	echo "archive). dav1d, FreeType, HarfBuzz and libass are linked into them."
	echo
	sed -n '/^Libraries/,/^$/p' "$work/SOURCES.txt"
} >"$licenses/BUNDLED.txt"

vendor="$root/src-tauri/vendor/ios"
rm -rf "$vendor"
mkdir -p "$vendor"
cp -R "$out/frameworks" "$out/licenses" "$vendor/"
echo "The frameworks for ${platforms[*]} are in $vendor/frameworks; sources: $out/polarity-ios-mpv-sources.tar.xz"
