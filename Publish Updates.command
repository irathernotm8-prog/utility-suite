#!/bin/bash
# Double-click to publish every app whose version went up (Mac + Windows) to GitHub.
cd "$(dirname "$0")" || exit 1
export PATH="$PWD/tools/bin:$PATH"
echo ""
echo "  Publishing updates"
echo "  ------------------"
echo "  Builds every app whose version went up, for Mac and Windows, and posts it to GitHub."
echo "  Keep the Mac awake and plugged in; the first publish (every app) can take a while."
echo ""
./utility publish
echo ""
read -n 1 -s -r -p "  Finished. Press any key to close."
echo ""
