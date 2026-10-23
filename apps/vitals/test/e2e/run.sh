#!/bin/sh
# Linux only: runs Vitals under Xvfb with a throwaway profile and drives every page (see drive.js).
# VITALS_DEMO=1 pretends to be a Mac with sensors, a battery, apps, startup items and permissions (see demo.js).
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
if [ -n "$VITALS_DEMO" ]; then HOOK=demo; OUT=out-demo; else HOOK=drive; OUT=out; fi
VITALS_USER_DATA="$TMP" VITALS_E2E="$(pwd)/test/e2e/$HOOK.js" VITALS_SHOTS="$(pwd)/test/e2e/$OUT" xvfb-run -a -s "-screen 0 1440x920x24" \
  ./node_modules/.bin/electron . --no-sandbox --disable-gpu --force-device-scale-factor=1 2>&1 | grep -v -E "dbus|Gtk|libva|viz_main|gpu_init|ERROR:bus|Fontconfig|NODE_OPTION"
