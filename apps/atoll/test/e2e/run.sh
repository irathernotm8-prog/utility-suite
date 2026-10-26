#!/usr/bin/env bash
# Atoll — end-to-end run with screenshots. Linux: needs xvfb-run. On a Mac, run the electron line without xvfb-run.
set -e
cd "$(dirname "$0")/../.."
rm -rf test/e2e/out /tmp/atoll-e2e
ATOLL_E2E=1 ATOLL_DEMO=1 ATOLL_DEMO_SEED=1 ATOLL_FAKE_NOTCH=1 ATOLL_FIXTURES="$PWD/test/fixtures" ATOLL_USER_DATA=/tmp/atoll-e2e \
  xvfb-run -a -s "-screen 0 1512x982x24" ./node_modules/.bin/electron . --no-sandbox --disable-gpu "$@" > /dev/null 2>&1 || true
cat test/e2e/out/log.txt
