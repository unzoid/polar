#!/usr/bin/env bash
# Builds the mpv.exe the Windows app bundles with shinchiro's mpv-winbuild-cmake (GPL build, the
# same scripts as the mpv builds Windows used before), every library at the git commit
# scripts/windows-mpv.lock pins, and packs the exact sources that went into it.
#
#   scripts/windows-mpv.sh <work dir> [toolchain]
#
# With `toolchain` it stops once the toolchain is built, so CI can keep the work dir before the
# long part; run again on the same work dir to go on.
# Runs in mpv-winbuild-cmake's own build image (Arch Linux with cmake, ninja, meson, nasm, ...;
# CI pins it). The first build also builds the MinGW GCC toolchain: a few hours.
#
# Writes into <work dir>/out:
#   mpv/                                  mpv.exe, d3dcompiler_43.dll, licence texts, BUNDLED.txt and
#                                         VERSION (this script's and the lock's hash, as CI and
#                                         scripts/fetch-mpv.ts compute it): src-tauri/vendor/mpv
#   polarity-windows-mpv-sources.tar      every source, the build scripts, SOURCES.txt
#   windows-mpv.lock                      the commits this build cloned, in the lock's format
# A library the lock doesn't pin, or pins at another repository, stops the build after the
# download; out/windows-mpv.lock then holds what was cloned, to review and copy over the lock.
# The sources archive goes with every release that carries this mpv.exe.
set -euo pipefail
export LC_ALL=C

work=$(realpath -m "${1:?usage: windows-mpv.sh <work dir> [toolchain]}")
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
lock="$root/scripts/windows-mpv.lock"
out="$work/out"

# Pinned versions. The lock pins every git repository the scripts clone; tarballs are pinned by
# the scripts' own hashes; the Rust toolchain (for subrandr) is pinned here.
WINBUILD_REPO=https://github.com/shinchiro/mpv-winbuild-cmake
WINBUILD_COMMIT=bda10a2816ce9908d419b3f4b564227330457e76
RUST_TOOLCHAIN=nightly-2026-11-05
ARCH=x86_64-w64-mingw32

mkdir -p "$work" "$out"
cd "$work"
if [ ! -d winbuild ]; then
	git init -q winbuild
	git -C winbuild fetch -q --depth 1 "$WINBUILD_REPO" "$WINBUILD_COMMIT"
	git -C winbuild checkout -q FETCH_HEAD
fi

# Every ExternalProject with a git repository gets GIT_TAG <commit> and no remote name, which the
# scripts take as a fixed commit (never reset to the branch's newest commit): the lock's commit, or
# for a repository the lock doesn't have yet, the commit the scripts hold it at (GIT_RESET), if any.
pins=$(grep -v '^\s*\(#\|$\)' "$lock")
for f in winbuild/packages/*.cmake winbuild/toolchain/*.cmake winbuild/toolchain/*/*.cmake; do
	awk -v pins="$pins" '
		BEGIN { n = split(pins, l, "\n"); for (i = 1; i <= n; i++) { split(l[i], p, " "); commit[p[1]] = p[2]; repo[p[1]] = p[3] } }
		FNR == 1 { name = "" }
		match($0, /ExternalProject_Add\([^ )]+/) { name = substr($0, RSTART + 20, RLENGTH - 20) }
		NR == FNR { if ($1 == "GIT_RESET") reset[name] = $2; next }
		name in commit || name in reset {
			if (/^[ \t]*(GIT_TAG|GIT_REMOTE_NAME|GIT_RESET)[ \t]/) next
			if (/^[ \t]*GIT_REPOSITORY[ \t]/) {
				print
				if (!(name in commit)) { print "    GIT_TAG " reset[name]; next }
				if ($2 != repo[name]) { print "windows-mpv.sh: " name " is now cloned from " $2 ", the lock has " repo[name] > "/dev/stderr"; exit 1 }
				if (name in reset && reset[name] != commit[name]) { print "windows-mpv.sh: the scripts hold " name " at " reset[name] ", the lock has " commit[name] > "/dev/stderr"; exit 1 }
				print "    GIT_TAG " commit[name]
				next
			}
		}
		{ print }
	' "$f" "$f" >"$f.pinned"
	mv "$f.pinned" "$f"
done
sed -i -e "s/--default-toolchain nightly/--default-toolchain $RUST_TOOLCHAIN --component rust-src/" \
	-e 's/BUILD_COMMAND ${EXEC} rustup update/BUILD_COMMAND ${EXEC} rustup --version/' winbuild/toolchain/rustup.cmake
grep -q -- "--default-toolchain $RUST_TOOLCHAIN" winbuild/toolchain/rustup.cmake || {
	echo "windows-mpv.sh: couldn't pin the Rust toolchain in toolchain/rustup.cmake" >&2
	exit 1
}

cmake -DTARGET_ARCH=$ARCH -DSINGLE_SOURCE_LOCATION="$work/src" -DRUSTUP_LOCATION="$work/rustup" \
	-G Ninja -B build -S winbuild
ninja -C build download
# The toolchain's sources too (GCC, binutils, MinGW-w64), before anything is built.
targets=$(ninja -C build -t targets all | sed -n 's/^\(gcc[^:]*-download\|mingw-w64[^:]*-download\|cppwinrt-download\|gendef-download\|widl-download\|winpthreads-download\): phony$/\1/p')
[ -n "$targets" ] && ninja -C build $targets

# Every clone at the commit the lock pins, checked before any patch is applied.
: >"$out/windows-mpv.lock"
bad=0
for d in src/*/; do
	d=${d%/}
	name=${d#src/}
	[ -d "$d/.git" ] || continue
	head=$(git -C "$d" rev-parse HEAD)
	url=$(git -C "$d" remote get-url origin)
	echo "$name $head $url" >>"$out/windows-mpv.lock"
	want=$(awk -v n="$name" '$1 == n { print $2 }' <<<"$pins")
	if [ "$want" != "$head" ]; then
		echo "windows-mpv.sh: $name is at $head, the lock has ${want:-nothing}" >&2
		bad=1
	fi
done
[ $bad -eq 0 ] || {
	echo "windows-mpv.sh: compare $out/windows-mpv.lock with scripts/windows-mpv.lock" >&2
	exit 1
}

if [ "${2:-}" = toolchain ]; then
	ninja -C build gcc
	exit 0
fi

# The sources as downloaded: pinned commits (sparse where the scripts check out part of a
# repository) and tarballs as unpacked, before any patch; the patches are in winbuild/packages.
mkdir -p stage
tar -cf - --exclude=.git -C "$work" src | xz -T0 >stage/sources.tar.xz
ls src >stage/packed.txt

ninja -C build gcc
ninja -C build mpv mpv-packaging

# Anything downloaded during the build isn't in the sources archive.
late=$(ls src | comm -13 stage/packed.txt -)
[ -z "$late" ] || {
	echo "windows-mpv.sh: downloaded during the build, so not in the sources: $late" >&2
	exit 1
}

# subrandr's crates as cargo fetched them, and the Rust standard library linked into mpv.exe.
export RUSTUP_HOME="$work/rustup/.rustup" CARGO_HOME="$work/rustup/.cargo"
rustc="$CARGO_HOME/bin/rustc"
sysroot=$("$rustc" +"$RUST_TOOLCHAIN" --print sysroot)
tar -cf - -C "$CARGO_HOME/registry" cache -C "$sysroot/lib/rustlib/src/rust" library |
	xz -T0 >stage/rust.tar.xz

{
	echo "Sources of mpv.exe in Polarity for Windows"
	echo
	echo "Built for $ARCH with shinchiro's mpv-winbuild-cmake ($WINBUILD_REPO, commit"
	echo "$WINBUILD_COMMIT), included under winbuild/ with Polarity's pins applied, by Polarity's"
	echo "scripts/windows-mpv.sh and scripts/windows-mpv.lock (both included)."
	echo
	echo "sources.tar.xz: src/<package>, each as downloaded, before the patches in winbuild/packages/:"
	while read -r name commit url; do
		echo "  $name: $(git -C "src/$name" describe --tags --always "$commit" 2>/dev/null) ($commit), $url"
	done <"$out/windows-mpv.lock"
	for d in src/*/; do
		d=${d%/}
		[ -d "$d/.git" ] || echo "  ${d#src/}: tarball, URL and hash in winbuild/packages/ or winbuild/toolchain/"
	done
	echo
	echo "rust.tar.xz: the crates subrandr was built with (cache/) and the standard library of Rust"
	echo "$RUST_TOOLCHAIN ($("$rustc" +"$RUST_TOOLCHAIN" --version))."
	echo
	echo "How each is configured: winbuild/packages/<package>.cmake (FFmpeg: ffmpeg.cmake, with"
	echo "--enable-gpl --enable-version3; mpv: mpv.cmake). To rebuild: scripts/windows-mpv.sh <dir>"
	echo "in mpv-winbuild-cmake's build image, with the lock beside it."
} >"$work/SOURCES.txt"

tar -cf "$out/polarity-windows-mpv-sources.tar" --exclude=winbuild/.git --transform 's,^,polarity-windows-mpv-sources/,' \
	-C "$work" SOURCES.txt winbuild \
	-C "$work/stage" sources.tar.xz rust.tar.xz -C "$root/scripts" windows-mpv.sh windows-mpv.lock

package=$(echo build/mpv-x86_64-*-git-*/)
mpv="$out/mpv"
mkdir -p "$mpv"
cp "$package/mpv.exe" "$package/d3dcompiler_43.dll" "$mpv/"
cp src/mpv/LICENSE.GPL "$mpv/LICENSE.GPL.txt"
cp src/mpv/Copyright "$mpv/COPYRIGHT.txt"
cp src/ffmpeg/COPYING.GPLv3 "$mpv/FFmpeg-COPYING.GPLv3.txt"
cp src/ffmpeg/LICENSE.md "$mpv/FFmpeg-LICENSE.md"
{
	echo "mpv.exe (mpv and FFmpeg, GPL, with the libraries listed below linked in) is built from the"
	echo "sources in polarity-windows-mpv-sources.tar, published with each release of the app."
	echo "d3dcompiler_43.dll is Microsoft's DirectX shader compiler, as mpv's Windows builds ship it."
	echo
	sed -n '/^sources.tar.xz/,/^$/p' "$work/SOURCES.txt"
} >"$mpv/BUNDLED.txt"
cat "$root/scripts/windows-mpv.sh" "$lock" | tr -d '\r' | sha256sum | cut -c1-16 >"$mpv/VERSION"
echo "mpv.exe is in $mpv; sources: $out/polarity-windows-mpv-sources.tar"
