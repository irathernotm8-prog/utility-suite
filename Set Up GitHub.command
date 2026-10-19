#!/bin/bash
# Double-click to connect the Utility Package to GitHub (one time).
cd "$(dirname "$0")" || exit 1
export PATH="$PWD/tools/bin:$PATH"
xattr -dr com.apple.quarantine tools/bin 2>/dev/null
pause() { echo ""; read -n 1 -s -r -p "$1"; echo ""; }

echo ""
echo "  Connecting the Utility Package to GitHub"
echo "  ----------------------------------------"
echo ""

# git comes with Apple's free command line tools
if ! xcode-select -p >/dev/null 2>&1; then
  echo "  macOS first needs Apple's free command line tools (they include git)."
  echo "  A window will open: click Install and wait for it to finish (a few minutes)."
  echo "  Then double-click \"Set Up GitHub\" again."
  xcode-select --install >/dev/null 2>&1
  pause "Press any key to close."
  exit 0
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "  Step 1 of 2: sign in to GitHub"
  echo ""
  echo "  Below you'll see a one-time code (like ABCD-1234)."
  echo "  Press Enter, and GitHub opens in your browser. Type in the code, then click Authorize."
  echo ""
  if ! gh auth login --hostname github.com --git-protocol https --web; then
    echo ""
    echo "  Sign-in didn't finish. Double-click \"Set Up GitHub\" to try again."
    pause "Press any key to close."
    exit 1
  fi
fi
gh auth setup-git >/dev/null 2>&1
echo ""
echo "  Signed in as: $(gh api user -q .login 2>/dev/null)"
echo ""
echo "  Step 2 of 2: creating your repo and uploading the source"
echo ""
./utility github utility-suite
echo ""
pause "All set. Press any key to close."
