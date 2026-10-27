#!/usr/bin/env bash
# Dev loop for Make editable (see test/layerize-dev.js). Needs RO2_MODELS with ocr/, slimsam/, lama/.
cd "$(dirname "$0")/.."
UD=$(mktemp -d)
RO2_E2E=test/layerize-dev.js RO2_USER_DATA="$UD" RO2_DESIGNS="$UD/designs" RO2_MODELS="${RO2_MODELS:-$UD/models}" \
  xvfb-run -a -s "-screen 0 1440x900x24" ./node_modules/.bin/electron . --no-sandbox > /dev/null 2>&1 || true
cat test/layerize-out/log.txt
