#!/bin/sh
# Installs Ubuntu packages on a CI runner without waiting on one slow or stalled package mirror.
# apt gives up on a connection that sends nothing for 30 seconds; each attempt also has an upper
# limit (five minutes to update, fifteen to install). A failed or timed-out attempt is tried
# again from another Ubuntu mirror, up to three attempts. Partial downloads are kept between
# attempts, so a retry carries on where the last one stopped.
#   scripts/ci-apt.sh [APT-GET INSTALL OPTION...] PACKAGE...
opts="-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30"
# GitHub's Ubuntu images read their mirrors from this list (mirror+file:), the Azure mirror first.
list=/etc/apt/apt-mirrors.txt
for attempt in 1 2 3; do
  case $attempt in
    2) mirror=http://archive.ubuntu.com/ubuntu/ ;;
    3) mirror=http://mirrors.edge.kernel.org/ubuntu/ ;;
    *) mirror= ;;
  esac
  if [ -n "$mirror" ] && [ -f "$list" ]; then
    echo "$mirror" | sudo tee "$list" > /dev/null
    echo "Using $mirror"
  fi
  if timeout 300 sudo apt-get $opts update && timeout 900 sudo apt-get $opts install -y "$@"; then
    exit 0
  fi
  echo "::warning::Installing Ubuntu packages failed or timed out (attempt $attempt of 3)"
done
exit 1
