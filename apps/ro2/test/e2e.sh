#!/usr/bin/env bash
# RO2 end-to-end run with screenshots (test/e2e-out). Linux needs xvfb-run; on a Mac run the electron line without it.
# AI checks need the models: point RO2_MODELS at a folder with ormbg/, lama/, slimsam/ (as RO2 downloads them).
set -e
cd "$(dirname "$0")/.."
mkdir -p test/fixtures
[ -f test/fixtures/person.jpg ] || curl -sL -o test/fixtures/person.jpg https://huggingface.co/Carve/LaMa-ONNX/resolve/main/image.jpg
UD=$(mktemp -d)
RO2_E2E=test/e2e.js RO2_USER_DATA="$UD" RO2_DESIGNS="$UD/designs" RO2_MODELS="${RO2_MODELS:-$UD/models}" \
  xvfb-run -a -s "-screen 0 1440x900x24" ./node_modules/.bin/electron . --no-sandbox > /dev/null 2>&1 || true
cat test/e2e-out/log.txt
