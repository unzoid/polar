#!/bin/sh
# Installs Ubuntu packages on a CI runner without hanging on a stalled package mirror: each
# attempt (update, then install) gets five minutes and apt's own network timeouts, and a stalled
# or failed attempt is tried again, up to three times.
#   scripts/ci-apt.sh [APT-GET INSTALL OPTION...] PACKAGE...
opts="-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30"
for attempt in 1 2 3; do
  if timeout 300 sudo apt-get $opts update && timeout 300 sudo apt-get $opts install -y "$@"; then
    exit 0
  fi
  echo "::warning::Installing Ubuntu packages failed or stalled (attempt $attempt of 3)"
done
exit 1
