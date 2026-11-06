# The build image of scripts/windows-mpv.sh: the packages mpv-winbuild-cmake's own image
# (ghcr.io/shinchiro/archlinux, made by shinchiro/archlinux-docker's build_docker.yml) installs,
# taken from the Arch Linux Archive as it was on one day, so this file always gives the same
# packages. Upstream's image is rebuilt from the live repositories and its old versions disappear.
# The base only brings pacman: every package is installed, upgraded or moved back to the
# archive's version (-Syyuu), so any archlinux tag would give the same result.
# CI builds it once per version of this file and keeps it in its cache.
FROM archlinux:base-devel-20261101.0.620205

RUN printf 'Server = https://archive.archlinux.org/repos/2026/11/05/$repo/os/$arch\n' >/etc/pacman.d/mirrorlist \
	&& printf '\n[multilib]\nInclude = /etc/pacman.d/mirrorlist\n' >>/etc/pacman.conf \
	&& pacman -Syyuu --noconfirm --needed \
		base base-devel jq openssh git mercurial subversion ninja cmake ragel yasm nasm asciidoc enca \
		gperf unzip p7zip gcc-multilib llvm clang lld libc++ libc++abi python-cairo python-pip curl \
		lib32-gcc-libs lib32-glib2 wget mimalloc ccache \
		meson python-mako python-jsonschema python-setuptools \
	&& pip install --no-cache-dir --break-system-packages rst2pdf==0.105 \
	&& pacman -Scc --noconfirm

ENV LANG=C.UTF-8
CMD ["/usr/bin/bash"]
