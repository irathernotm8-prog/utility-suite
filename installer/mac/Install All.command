#!/bin/bash
# Installs every app in this folder into /Applications and clears the
# "downloaded from the internet" flag so macOS lets them open.
cd "$(dirname "$0")" || exit 1
echo ""
echo "Installing apps into /Applications…"
echo ""
shopt -s nullglob
count=0
for app in *.app; do
  name="${app%.app}"
  if pgrep -xq "$name"; then
    echo "  Closing $name…"
    osascript -e "quit app \"$name\"" >/dev/null 2>&1
    sleep 2
  fi
  rm -rf "/Applications/$app"
  if ditto "$app" "/Applications/$app"; then
    xattr -dr com.apple.quarantine "/Applications/$app" 2>/dev/null
    echo "  ✓ $name"
    count=$((count + 1))
  else
    echo "  ✗ $name — couldn't copy (are you an administrator on this Mac?)"
  fi
done
echo ""
echo "Done — $count app(s) installed. Find them in Launchpad or the Applications folder."
echo "Your settings and data on this Mac were left untouched."
echo ""
read -n 1 -s -r -p "Press any key to close."
echo ""
