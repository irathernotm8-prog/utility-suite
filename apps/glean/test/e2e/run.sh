#!/bin/sh
# End-to-end: mock sites + the real app under Xvfb. Linux only (needs root for port 443). Screenshots land in $GLEAN_SHOTS.
cd "$(dirname "$0")/../.."
T=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -keyout $T/key.pem -out $T/cert.pem -days 2 -subj "/CN=localhost" 2>/dev/null
MOCK_KEY=$T/key.pem MOCK_CERT=$T/cert.pem node test/e2e/mock-server.js & M=$!
sleep 1
GLEAN_SHOTS=${GLEAN_SHOTS:-$T/shots} GLEAN_TEST_RESOLVE=1 GLEAN_E2E="$PWD/test/e2e/drive.js" GLEAN_USER_DATA=$T/ud GLEAN_FOLDER=$T/Glean \
GLEAN_START_URL=https://www.instagram.com/clientbrand/ \
  xvfb-run -a -s "-screen 0 1600x1000x24" npx electron . --no-sandbox --disable-gpu 2>&1 | grep -v -E "dbus|Fontconfig|viz_main|gpu_init|ERROR:.*(bus|gl_|angle)" 
R=$?
kill $M
echo "files in $T/Glean"
exit $R
