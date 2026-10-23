#!/bin/sh
# Linux only: runs Scene under Xvfb on the pretend computer (two displays, a dozen apps, see src/platform/demo.js)
# with a throwaway profile, drives every page and a real switch, and saves screenshots to test/e2e/out.
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
SCENE_DEMO=1 SCENE_USER_DATA="$TMP" SCENE_E2E="$(pwd)/test/e2e/drive.js" SCENE_SHOTS="$(pwd)/test/e2e/out" xvfb-run -a -s "-screen 0 1440x920x24" \
  ./node_modules/.bin/electron . --no-sandbox --disable-gpu --force-device-scale-factor=1 2>&1 | grep -v -E "dbus|Gtk|libva|viz_main|gpu_init|ERROR:bus|Fontconfig|NODE_OPTION|StatusNotifier|libappindicator"
